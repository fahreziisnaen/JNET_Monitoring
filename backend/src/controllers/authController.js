const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../services/whatsappService');
const crypto = require('crypto');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.requestLoginOtp = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username dan password wajib diisi.' });

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(401).json({ message: 'Username atau password salah.' });

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ message: 'Username atau password salah.' });

        if (!user.whatsapp_number) return res.status(403).json({ message: 'Akun ini tidak memiliki nomor WhatsApp terdaftar untuk OTP.' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // --- SMART BYPASS LOGIC ---
        const authPath = require('path').join(process.cwd(), 'whatsapp_auth_info');
        const hasSession = require('fs').existsSync(require('path').join(authPath, 'creds.json'));
        const isActive = isWhatsAppConnected();

        // Jika WA tidak aktif/error atau belum terdaftar (belum ada creds.json)
        // Maka bypass OTP dan langsung berikan token login
        if (!isActive || !hasSession) {
            console.log(`[Auth Bypass] Melakukan bypass OTP untuk user ${user.id} (WA Inactive/Unregistered)`);

            const tokenId = crypto.randomBytes(16).toString('hex');
            const payload = { id: user.id, username: user.username, workspace_id: user.workspace_id, jti: tokenId };
            // Gunakan X-Forwarded-For untuk mendapatkan IP asli klien (bukan IP proxy Cloudflare)
            const forwarded = req.headers['x-forwarded-for'];
            let rawIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
            let normalizedIp = rawIp.includes('::ffff:') ? rawIp.split('::ffff:')[1] : rawIp;
            if (normalizedIp === '::1') normalizedIp = '127.0.0.1';
            const userAgent = req.headers['user-agent'] || 'Unknown';

            try {
                // Hanya hapus session dari perangkat yang PERSIS sama (IP DAN User-Agent cocok)
                const [delResult] = await pool.query(
                    'DELETE FROM user_sessions WHERE user_id = ? AND user_agent = ? AND ip_address = ?',
                    [user.id, userAgent, normalizedIp]
                );
                if (delResult.affectedRows > 0) {
                    console.log(`[Auth Bypass Cleanup] Removed ${delResult.affectedRows} existing sessions for user ${user.id}.`);
                }
            } catch (delError) {
                console.error("[Auth Bypass Cleanup] Error during session cleanup:", delError);
            }

            await pool.query('INSERT INTO user_sessions (user_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)', [user.id, tokenId, userAgent, normalizedIp]);

            const token = jwt.sign(payload, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '7d' });

            const cookieOptions = {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                path: '/',
            };
            res.cookie('token', token, cookieOptions);

            const superAdminIds = process.env.SUPER_ADMIN_IDS
                ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
                : [1];

            const profilePictureUrl = user.profile_picture_url || '/public/uploads/avatars/default.jpg';
            return res.status(200).json({
                message: 'Login berhasil (OTP Bypass)!',
                otpRequired: false,
                user: {
                    id: user.id,
                    displayName: user.display_name,
                    profile_picture_url: profilePictureUrl,
                    is_super_admin: superAdminIds.includes(user.id)
                },
                token: token
            });
        }
        // --- END SMART BYPASS ---

        await pool.query(
            `INSERT INTO login_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp_code=VALUES(otp_code), expires_at=VALUES(expires_at)`,
            [user.id, otp, expiresAt]
        );

        await sendWhatsAppMessage(user.whatsapp_number, `Kode verifikasi JNET Monitoring Anda adalah: *${otp}*. Jangan berikan kode ini kepada siapapun.`);
        res.status(200).json({
            message: 'OTP telah dikirim.',
            otpRequired: true,
            userId: user.id,
            whatsappNumber: user.whatsapp_number
        });

    } catch (error) {
        console.error("REQUEST LOGIN OTP ERROR:", error);
        res.status(500).json({ message: 'Gagal memproses login. Silakan hubungi admin jika terulang.' });
    }
};

exports.verifyLoginOtp = async (req, res) => {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ message: 'User ID dan OTP wajib diisi.' });

    try {
        const [otps] = await pool.query('SELECT * FROM login_otps WHERE user_id = ? AND otp_code = ? AND expires_at > NOW()', [userId, otp]);
        if (otps.length === 0) return res.status(400).json({ message: 'OTP salah atau sudah kedaluwarsa.' });

        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        const user = users[0];

        // Gunakan X-Forwarded-For untuk IP asli di belakang Cloudflare
        const forwarded = req.headers['x-forwarded-for'];
        let rawIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
        let normalizedIp = rawIp.includes('::ffff:') ? rawIp.split('::ffff:')[1] : rawIp;
        if (normalizedIp === '::1') normalizedIp = '127.0.0.1';
        const userAgent = req.headers['user-agent'] || 'Unknown';

        try {
            // Hanya hapus session dari perangkat yang PERSIS sama (IP DAN User-Agent cocok)
            const [delResult] = await pool.query(
                'DELETE FROM user_sessions WHERE user_id = ? AND user_agent = ? AND ip_address = ?',
                [user.id, userAgent, normalizedIp]
            );
            if (delResult.affectedRows > 0) {
                console.log(`[Auth Cleanup] Removed ${delResult.affectedRows} existing sessions for user ${user.id}.`);
            }
        } catch (delError) {
            console.error("[Auth Cleanup] Error during session cleanup:", delError);
        }

        await pool.query('DELETE FROM login_otps WHERE user_id = ?', [userId]);

        const tokenId = crypto.randomBytes(16).toString('hex');
        const payload = { id: user.id, username: user.username, workspace_id: user.workspace_id, jti: tokenId };
        const token = jwt.sign(payload, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '7d' });

        console.log(`[Auth Debug] Creating new session for user ${user.id}. Token ID (jti): ${tokenId}. IP: ${normalizedIp}, UA: ${userAgent}`);

        const [insertResult] = await pool.query('INSERT INTO user_sessions (user_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)', [user.id, tokenId, userAgent, normalizedIp]);

        console.log(`[Auth Debug] Session inserted successfully with DB ID: ${insertResult.insertId}`);

        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/',
        };
        res.cookie('token', token, cookieOptions);

        const superAdminIds = process.env.SUPER_ADMIN_IDS
            ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
            : [1];

        const profilePictureUrl = user.profile_picture_url || '/public/uploads/avatars/default.jpg';
        res.status(200).json({
            message: 'Login berhasil!',
            user: {
                id: user.id,
                displayName: user.display_name,
                profile_picture_url: profilePictureUrl,
                is_super_admin: superAdminIds.includes(user.id)
            },
            token: token // Return token untuk fallback
        });

    } catch (error) {
        console.error("VERIFY LOGIN OTP ERROR:", error);
        res.status(500).json({ message: 'Verifikasi OTP gagal.' });
    }
};

exports.logout = async (req, res) => {
    try {
        const tokenId = req.user?.jti;
        if (tokenId) {
            await pool.query('DELETE FROM user_sessions WHERE token_id = ?', [tokenId]);
            console.log(`[Auth] Session ${tokenId} deleted from database on logout.`);
        }

        res.cookie('token', '', {
            httpOnly: true,
            expires: new Date(0),
        });
        res.status(200).json({ message: 'Logout berhasil.' });
    } catch (error) {
        console.error("LOGOUT ERROR:", error);
        res.status(500).json({ message: 'Gagal memproses logout.' });
    }
};

exports.getMe = (req, res) => {
    // Pastikan user object lengkap dengan workspace_id
    if (!req.user) {
        return res.status(401).json({ message: 'Tidak terotorisasi.' });
    }

    // Jika user tidak punya workspace_id, middleware seharusnya sudah membuat workspace
    // Tapi kita pastikan lagi di sini
    if (!req.user.workspace_id) {
        console.warn(`[GetMe] User ${req.user.id} tidak punya workspace_id, middleware seharusnya sudah handle ini.`);
    }

    const superAdminIds = process.env.SUPER_ADMIN_IDS
        ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
        : [1];

    res.status(200).json({
        user: {
            ...req.user,
            is_super_admin: superAdminIds.includes(req.user.id)
        }
    });
};

exports.requestPasswordReset = async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'Username wajib diisi.' });

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ message: 'Username tidak ditemukan.' });

        const user = users[0];
        if (!user.whatsapp_number) return res.status(400).json({ message: 'Akun ini tidak memiliki nomor WhatsApp terdaftar.' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // --- SMART CHECK LOGIC ---
        const authPath = require('path').join(process.cwd(), 'whatsapp_auth_info');
        const hasSession = require('fs').existsSync(require('path').join(authPath, 'creds.json'));
        const isActive = isWhatsAppConnected();

        if (!isActive || !hasSession) {
            return res.status(400).json({
                message: 'Fitur lupa password sedang tidak tersedia karena WhatsApp Bot tidak aktif. Silakan hubungi admin untuk bantuan reset password manual.'
            });
        }
        // --- END SMART CHECK ---

        await pool.query(
            `INSERT INTO login_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp_code=VALUES(otp_code), expires_at=VALUES(expires_at)`,
            [user.id, otp, expiresAt]
        );

        await sendWhatsAppMessage(user.whatsapp_number, `Kode verifikasi lupa password JNET Monitoring Anda adalah: *${otp}*. Gunakan kode ini untuk mereset password Anda.`);

        res.status(200).json({
            message: 'OTP berhasil dikirim ke WhatsApp Anda.',
            username: user.username
        });

    } catch (error) {
        console.error("REQUEST PASSWORD RESET ERROR:", error);
        res.status(500).json({ message: 'Gagal memproses lupa password.' });
    }
};

exports.resetPassword = async (req, res) => {
    const { username, otp, newPassword } = req.body;
    if (!username || !otp || !newPassword) {
        return res.status(400).json({ message: 'Username, OTP, dan password baru wajib diisi.' });
    }

    try {
        const [users] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ message: 'Username tidak ditemukan.' });

        const userId = users[0].id;

        const [otps] = await pool.query('SELECT * FROM login_otps WHERE user_id = ? AND otp_code = ? AND expires_at > NOW()', [userId, otp]);
        if (otps.length === 0) return res.status(400).json({ message: 'OTP salah atau sudah kedaluwarsa.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, userId]);
        await pool.query('DELETE FROM login_otps WHERE user_id = ?', [userId]);

        res.status(200).json({ message: 'Password berhasil diperbarui. Silakan login kembali.' });

    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        res.status(500).json({ message: 'Gagal mereset password.' });
    }
};