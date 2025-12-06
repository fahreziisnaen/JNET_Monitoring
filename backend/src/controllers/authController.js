const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWhatsAppMessage } = require('../services/whatsappService');
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

        await pool.query(
            `INSERT INTO login_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp_code=VALUES(otp_code), expires_at=VALUES(expires_at)`,
            [user.id, otp, expiresAt]
        );
        
        await sendWhatsAppMessage(user.whatsapp_number, `Kode verifikasi JNET Monitoring Anda adalah: *${otp}*. Jangan berikan kode ini kepada siapapun.`);
        res.status(200).json({ 
            message: 'OTP telah dikirim.', 
            userId: user.id,
            whatsappNumber: user.whatsapp_number 
        });

    } catch (error) {
        console.error("REQUEST LOGIN OTP ERROR:", error);
        res.status(500).json({ message: 'Gagal mengirim OTP.' });
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
        
        const tokenId = crypto.randomBytes(16).toString('hex');
        const payload = { id: user.id, username: user.username, workspace_id: user.workspace_id, jti: tokenId };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

        await pool.query('DELETE FROM login_otps WHERE user_id = ?', [userId]);
        await pool.query('INSERT INTO user_sessions (user_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)', [user.id, tokenId, req.headers['user-agent'], req.ip]);

        // Set cookie dengan konfigurasi yang lebih eksplisit
        // Untuk development, jangan gunakan secure (hanya untuk HTTPS)
        const cookieOptions = {
            httpOnly: true,
            secure: false, // Set ke false untuk development (HTTP), true untuk production (HTTPS)
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'lax', // Changed to 'none' if needed for cross-origin, but 'lax' should work for same-site
            path: '/',
            // Jangan set domain, biarkan browser yang handle
        };
        
        // Override secure untuk production
        if (process.env.NODE_ENV === 'production') {
            cookieOptions.secure = true;
        }
        
        // Set cookie dengan explicit header untuk memastikan ter-set
        res.cookie('token', token, cookieOptions);
        
        // Juga set header Set-Cookie secara eksplisit untuk memastikan
        const cookieString = `token=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
        res.setHeader('Set-Cookie', cookieString);
        
        console.log(`[Auth] Token cookie set untuk user ${user.id}`);
        console.log(`[Auth] Cookie options:`, cookieOptions);
        console.log(`[Auth] Request origin:`, req.headers.origin);
        console.log(`[Auth] Request host:`, req.headers.host);
        console.log(`[Auth] Set-Cookie header:`, cookieString);
        
        // Return token di response body juga sebagai fallback jika cookie tidak bekerja
        // Frontend bisa simpan di localStorage dan kirim sebagai Authorization header
        // Set default avatar jika tidak ada
        const profilePictureUrl = user.profile_picture_url || '/public/uploads/avatars/default.jpg';
        res.status(200).json({ 
            message: 'Login berhasil!', 
            user: { id: user.id, displayName: user.display_name, profile_picture_url: profilePictureUrl },
            token: token // Return token untuk fallback
        });

    } catch (error) {
        console.error("VERIFY LOGIN OTP ERROR:", error);
        res.status(500).json({ message: 'Verifikasi OTP gagal.' });
    }
};

exports.logout = async (req, res) => {
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0),
    });
    res.status(200).json({ message: 'Logout berhasil.' });
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
    
    res.status(200).json({ user: req.user });
};