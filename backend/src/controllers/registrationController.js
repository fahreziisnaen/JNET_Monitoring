const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../services/whatsappService');
const { createRateLimiter, retryMessage } = require('../utils/rateLimiter');

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// OTP registrasi bisa diminta siapa saja ke nomor apa saja; tanpa batas ini nomor bot mudah di-ban
const otpPerNumberLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 3 });
const otpPerIpLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const verifyLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

exports.requestRegisterOtp = async (req, res) => {
    const { username, displayName, password, whatsappNumber } = req.body;
    if (!username || !displayName || !password || !whatsappNumber) {
        return res.status(400).json({ message: 'Semua field harus diisi.' });
    }

    const numberLimit = otpPerNumberLimiter.check(String(whatsappNumber));
    const ipLimit = otpPerIpLimiter.check(clientIp(req));
    if (!numberLimit.allowed || !ipLimit.allowed) {
        return res.status(429).json({ message: retryMessage(Math.max(numberLimit.retryAfterMs, ipLimit.retryAfterMs)) });
    }
    otpPerIpLimiter.hit(clientIp(req));

    try {
        const [existingUser] = await pool.query('SELECT id FROM users WHERE username = ? OR whatsapp_number = ?', [username, whatsappNumber]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Username atau Nomor WhatsApp sudah terdaftar.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // --- SMART BYPASS LOGIC ---
        const authPath = require('path').join(process.cwd(), 'whatsapp_auth_info');
        const hasSession = require('fs').existsSync(require('path').join(authPath, 'creds.json'));
        const isActive = isWhatsAppConnected();

        // Jika WA tidak aktif/error atau belum terdaftar
        // Maka bypass OTP dan registrasi langsung
        if (!isActive || !hasSession) {
            console.log(`[Register Bypass] Melakukan bypass OTP untuk registrasi ${username} (WA Inactive/Unregistered)`);

            const conn = await pool.getConnection();
            await conn.beginTransaction();
            try {
                const [result] = await conn.query(
                    'INSERT INTO users (username, display_name, password_hash, whatsapp_number, profile_picture_url) VALUES (?, ?, ?, ?, ?)',
                    [username, displayName, hashedPassword, whatsappNumber, '/public/uploads/avatars/default.jpg']
                );
                const [wsResult] = await conn.query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [`${displayName}'s Workspace`, result.insertId]);
                await conn.query('UPDATE users SET workspace_id = ? WHERE id = ?', [wsResult.insertId, result.insertId]);
                await conn.commit();
                conn.release();

                return res.status(201).json({
                    message: 'Registrasi berhasil (OTP Bypass)! Silakan login.',
                    otpRequired: false
                });
            } catch (regError) {
                await conn.rollback();
                conn.release();
                throw regError;
            }
        }
        // --- END SMART BYPASS ---

        await pool.query(
            `INSERT INTO pending_registrations (whatsapp_number, username, display_name, password_hash, otp_code, expires_at) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE username=VALUES(username), display_name=VALUES(display_name), password_hash=VALUES(password_hash), otp_code=VALUES(otp_code), expires_at=VALUES(expires_at)`,
            [whatsappNumber, username, displayName, hashedPassword, otp, expiresAt]
        );

        otpPerNumberLimiter.hit(String(whatsappNumber));
        const sent = await sendWhatsAppMessage(
            whatsappNumber,
            `Halo ${displayName}! Kode verifikasi JNET Monitoring Anda adalah: *${otp}*. Kode ini berlaku selama 10 menit.`,
            { category: 'otp', waitForResult: true }
        );
        if (!sent) {
            return res.status(503).json({ message: 'Gagal mengirim OTP via WhatsApp. Pastikan nomor aktif di WhatsApp, lalu coba lagi nanti.' });
        }

        res.status(200).json({
            message: 'OTP telah dikirim ke nomor WhatsApp Anda.',
            otpRequired: true
        });

    } catch (error) {
        console.error("REQUEST REGISTER OTP ERROR:", error);
        res.status(500).json({ message: 'Gagal memproses registrasi. Silakan hubungi admin.' });
    }
};

exports.verifyAndRegister = async (req, res) => {
    const { whatsappNumber, otp } = req.body;
    if (!whatsappNumber || !otp) {
        return res.status(400).json({ message: 'Nomor WhatsApp dan OTP wajib diisi.' });
    }

    const verifyKey = String(whatsappNumber);
    const verifyLimit = verifyLimiter.check(verifyKey);
    if (!verifyLimit.allowed) {
        return res.status(429).json({ message: retryMessage(verifyLimit.retryAfterMs) });
    }

    try {
        const [pending] = await pool.query('SELECT * FROM pending_registrations WHERE whatsapp_number = ? AND otp_code = ? AND expires_at > NOW()', [whatsappNumber, otp]);
        if (pending.length === 0) {
            verifyLimiter.hit(verifyKey);
            return res.status(400).json({ message: 'OTP salah atau sudah kedaluwarsa.' });
        }
        verifyLimiter.reset(verifyKey);

        const userData = pending[0];
        const avatarUrl = '/public/uploads/avatars/default.jpg';

        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            const [result] = await conn.query(
                'INSERT INTO users (username, display_name, password_hash, whatsapp_number, profile_picture_url) VALUES (?, ?, ?, ?, ?)',
                [userData.username, userData.display_name, userData.password_hash, userData.whatsapp_number, avatarUrl]
            );

            const [wsResult] = await conn.query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [`${userData.display_name}'s Workspace`, result.insertId]);
            await conn.query('UPDATE users SET workspace_id = ? WHERE id = ?', [wsResult.insertId, result.insertId]);
            await conn.query('DELETE FROM pending_registrations WHERE whatsapp_number = ?', [whatsappNumber]);

            await conn.commit();
            conn.release();

            // Setelah registrasi berhasil, langsung login user
            const tokenId = crypto.randomBytes(16).toString('hex');
            const payload = { id: result.insertId, username: userData.username, workspace_id: wsResult.insertId, jti: tokenId };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

            // Insert session - use X-Forwarded-For for real IP behind proxy
            const forwarded = req.headers['x-forwarded-for'];
            let rawIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
            let normalizedIp = rawIp.includes('::ffff:') ? rawIp.split('::ffff:')[1] : rawIp;
            await pool.query('INSERT INTO user_sessions (user_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)', [result.insertId, tokenId, req.headers['user-agent'], normalizedIp]);

            // Set cookie dengan konfigurasi yang sama seperti login
            const cookieOptions = {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                sameSite: 'lax',
                path: '/',
            };

            res.cookie('token', token, cookieOptions);

            // Query user lengkap untuk response
            const [newUser] = await pool.query('SELECT id, username, display_name, profile_picture_url, workspace_id FROM users WHERE id = ?', [result.insertId]);
            const user = newUser[0];
            // Set default avatar jika tidak ada
            const userProfilePicture = user.profile_picture_url || '/public/uploads/avatars/default.jpg';

            res.status(201).json({
                message: 'Registrasi berhasil!',
                userId: result.insertId,
                user: {
                    id: user.id,
                    displayName: user.display_name,
                    profile_picture_url: userProfilePicture
                },
                token: token // Return token untuk fallback
            });
        } catch (error) {
            await conn.rollback();
            conn.release();
            throw error;
        }

    } catch (error) {
        console.error("VERIFY REGISTER ERROR:", error);
        res.status(500).json({ message: 'Verifikasi gagal karena server error.' });
    }
};