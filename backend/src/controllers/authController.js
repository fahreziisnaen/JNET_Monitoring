const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { isSuperAdmin } = require('../utils/authUtils');
const { createRateLimiter, retryMessage } = require('../utils/rateLimiter');
const twoFactorService = require('../services/twoFactorService');

const TWO_FACTOR_AUDIENCE = 'jnet-2fa';
const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Batas percobaan gagal; hitungan di-reset setelah berhasil
const loginUserLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 10 });
const loginIpLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 50 });
const twoFactorLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 5 });
const resetPasswordLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 5 });

// Hash bcrypt dummy agar waktu respons sama untuk username yang tidak ada
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = forwarded ? forwarded.split(',')[0].trim() : (req.ip || 'Unknown');
    const ip = rawIp.includes('::ffff:') ? rawIp.split('::ffff:')[1] : rawIp;
    return ip === '::1' ? '127.0.0.1' : ip;
}

function blocked(res, ...checks) {
    const hit = checks.find(c => !c.allowed);
    if (!hit) return false;
    res.status(429).json({ message: retryMessage(hit.retryAfterMs) });
    return true;
}

/** Membuat sesi login, memasang cookie, dan mengirim respons login sukses. */
async function issueSession(req, res, user, extra = {}) {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = clientIp(req);

    // Hanya hapus session dari perangkat yang PERSIS sama (IP DAN User-Agent cocok)
    await pool.query(
        'DELETE FROM user_sessions WHERE user_id = ? AND user_agent = ? AND ip_address = ?',
        [user.id, userAgent, ip]
    ).catch(err => console.error('[Auth] Gagal membersihkan sesi lama:', err.message));

    const tokenId = crypto.randomBytes(16).toString('hex');
    await pool.query(
        'INSERT INTO user_sessions (user_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)',
        [user.id, tokenId, userAgent, ip]
    );

    const token = jwt.sign(
        { id: user.id, username: user.username, workspace_id: user.workspace_id, jti: tokenId },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/',
    });

    return res.status(200).json({
        message: 'Login berhasil!',
        otpRequired: false,
        twoFactorRequired: false,
        user: {
            id: user.id,
            displayName: user.display_name,
            profile_picture_url: user.profile_picture_url || '/public/uploads/avatars/default.jpg',
            is_super_admin: isSuperAdmin(user.id),
        },
        token,
        ...extra,
    });
}

exports.login = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username dan password wajib diisi.' });

    const userKey = String(username).toLowerCase();
    const ipKey = clientIp(req);
    if (blocked(res, loginUserLimiter.check(userKey), loginIpLimiter.check(ipKey))) return;

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);

        if (!user || !isMatch) {
            loginUserLimiter.hit(userKey);
            loginIpLimiter.hit(ipKey);
            return res.status(401).json({ message: 'Username atau password salah.' });
        }

        if (user.totp_enabled) {
            // Password benar; login belum selesai sampai kode Authenticator diverifikasi
            const challengeToken = jwt.sign(
                { id: user.id, purpose: 'login' },
                process.env.JWT_SECRET,
                { audience: TWO_FACTOR_AUDIENCE, expiresIn: '5m' }
            );
            return res.status(200).json({
                message: 'Masukkan kode dari aplikasi Authenticator.',
                twoFactorRequired: true,
                challengeToken,
            });
        }

        loginUserLimiter.reset(userKey);
        return await issueSession(req, res, user);
    } catch (error) {
        console.error('LOGIN ERROR:', error);
        res.status(500).json({ message: 'Gagal memproses login. Silakan hubungi admin jika terulang.' });
    }
};

exports.verifyLoginTwoFactor = async (req, res) => {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) return res.status(400).json({ message: 'Kode 2FA wajib diisi.' });

    let decoded;
    try {
        decoded = jwt.verify(challengeToken, process.env.JWT_SECRET, { audience: TWO_FACTOR_AUDIENCE });
    } catch {
        return res.status(401).json({ message: 'Sesi login kedaluwarsa. Silakan masukkan password lagi.' });
    }

    const limiterKey = `user:${decoded.id}`;
    if (blocked(res, twoFactorLimiter.check(limiterKey))) return;

    try {
        const method = await twoFactorService.verifyCode(decoded.id, code);
        if (!method) {
            twoFactorLimiter.hit(limiterKey);
            return res.status(401).json({ message: 'Kode 2FA salah atau sudah dipakai.' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
        if (users.length === 0) return res.status(401).json({ message: 'User tidak ditemukan.' });

        twoFactorLimiter.reset(limiterKey);
        loginUserLimiter.reset(String(users[0].username).toLowerCase());

        const extra = {};
        if (method === 'recovery') {
            const { recoveryCodesRemaining } = await twoFactorService.getStatus(decoded.id);
            extra.usedRecoveryCode = true;
            extra.recoveryCodesRemaining = recoveryCodesRemaining;
        }
        return await issueSession(req, res, users[0], extra);
    } catch (error) {
        console.error('VERIFY 2FA ERROR:', error);
        res.status(500).json({ message: 'Verifikasi 2FA gagal.' });
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

    res.status(200).json({
        user: {
            ...req.user,
            is_super_admin: isSuperAdmin(req.user.id)
        }
    });
};

// Lupa password: buktikan kepemilikan akun dengan kode Authenticator atau kode cadangan.
// Akun tanpa 2FA direset oleh Super Admin (scripts/reset-password.js).
exports.resetPassword = async (req, res) => {
    const { username, code, newPassword } = req.body;
    if (!username || !code || !newPassword) {
        return res.status(400).json({ message: 'Username, kode 2FA, dan password baru wajib diisi.' });
    }
    if (String(newPassword).length < 6) {
        return res.status(400).json({ message: 'Password baru minimal 6 karakter.' });
    }

    const userKey = `reset:${String(username).toLowerCase()}`;
    const ipKey = `reset-ip:${clientIp(req)}`;
    if (blocked(res, resetPasswordLimiter.check(userKey), loginIpLimiter.check(ipKey))) return;

    const genericError = 'Username atau kode 2FA salah, atau akun belum mengaktifkan 2FA. Akun tanpa 2FA hanya bisa direset oleh Super Admin.';

    try {
        const [users] = await pool.query('SELECT id, totp_enabled FROM users WHERE username = ?', [username]);
        const user = users[0];
        const method = user && user.totp_enabled ? await twoFactorService.verifyCode(user.id, code) : null;

        if (!method) {
            resetPasswordLimiter.hit(userKey);
            loginIpLimiter.hit(ipKey);
            return res.status(400).json({ message: genericError });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, user.id]);
        // Cabut semua sesi: siapa pun yang memegang sesi lama harus login ulang
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
        resetPasswordLimiter.reset(userKey);
        // Kode 2FA yang sah sudah dibuktikan, jadi kuncian percobaan login 2FA ikut dibuka
        twoFactorLimiter.reset(`user:${user.id}`);

        res.status(200).json({ message: 'Password berhasil diperbarui. Silakan login kembali.' });
    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        res.status(500).json({ message: 'Gagal mereset password.' });
    }
};
