const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const twoFactorService = require('../services/twoFactorService');
const { createRateLimiter, retryMessage } = require('../utils/rateLimiter');

// Percobaan kode/password salah di halaman pengaturan 2FA
const settingsLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

function rejectApiKey(req, res) {
    // Service account API key tidak punya akun user untuk 2FA
    if (!req.user || req.user.id <= 0) {
        res.status(403).json({ message: '2FA hanya untuk akun user.' });
        return true;
    }
    return false;
}

function rateLimited(req, res) {
    const status = settingsLimiter.check(`user:${req.user.id}`);
    if (status.allowed) return false;
    res.status(429).json({ message: retryMessage(status.retryAfterMs) });
    return true;
}

async function passwordMatches(userId, password) {
    if (!password) return false;
    const [users] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    return users.length > 0 && bcrypt.compare(password, users[0].password_hash);
}

exports.getStatus = async (req, res) => {
    if (rejectApiKey(req, res)) return;
    try {
        res.json(await twoFactorService.getStatus(req.user.id));
    } catch (error) {
        console.error('[2FA] getStatus error:', error);
        res.status(500).json({ message: 'Gagal mengambil status 2FA.' });
    }
};

exports.beginSetup = async (req, res) => {
    if (rejectApiKey(req, res) || rateLimited(req, res)) return;
    try {
        if (!(await passwordMatches(req.user.id, req.body.password))) {
            settingsLimiter.hit(`user:${req.user.id}`);
            return res.status(401).json({ message: 'Password salah.' });
        }
        const setup = await twoFactorService.beginSetup(req.user);
        if (!setup) return res.status(409).json({ message: '2FA sudah aktif.' });
        res.json(setup);
    } catch (error) {
        console.error('[2FA] beginSetup error:', error);
        res.status(500).json({ message: 'Gagal memulai pemasangan 2FA.' });
    }
};

exports.enable = async (req, res) => {
    if (rejectApiKey(req, res) || rateLimited(req, res)) return;
    try {
        const recoveryCodes = await twoFactorService.confirmSetup(req.user.id, req.body.code);
        if (!recoveryCodes) {
            settingsLimiter.hit(`user:${req.user.id}`);
            return res.status(400).json({ message: 'Kode tidak cocok. Pastikan jam HP akurat lalu coba kode terbaru.' });
        }
        settingsLimiter.reset(`user:${req.user.id}`);
        res.json({ message: '2FA berhasil diaktifkan.', recoveryCodes });
    } catch (error) {
        console.error('[2FA] enable error:', error);
        res.status(500).json({ message: 'Gagal mengaktifkan 2FA.' });
    }
};

exports.disable = async (req, res) => {
    if (rejectApiKey(req, res) || rateLimited(req, res)) return;
    try {
        const passwordOk = await passwordMatches(req.user.id, req.body.password);
        const method = passwordOk ? await twoFactorService.verifyCode(req.user.id, req.body.code) : null;
        if (!method) {
            settingsLimiter.hit(`user:${req.user.id}`);
            return res.status(401).json({ message: 'Password atau kode 2FA salah.' });
        }
        await twoFactorService.disable(req.user.id);
        settingsLimiter.reset(`user:${req.user.id}`);
        res.json({ message: '2FA berhasil dinonaktifkan.' });
    } catch (error) {
        console.error('[2FA] disable error:', error);
        res.status(500).json({ message: 'Gagal menonaktifkan 2FA.' });
    }
};

exports.regenerateRecoveryCodes = async (req, res) => {
    if (rejectApiKey(req, res) || rateLimited(req, res)) return;
    try {
        const method = await twoFactorService.verifyCode(req.user.id, req.body.code);
        if (!method) {
            settingsLimiter.hit(`user:${req.user.id}`);
            return res.status(401).json({ message: 'Kode 2FA salah atau sudah dipakai.' });
        }
        const recoveryCodes = await twoFactorService.regenerateRecoveryCodes(req.user.id);
        settingsLimiter.reset(`user:${req.user.id}`);
        res.json({ message: 'Kode cadangan baru dibuat. Kode lama tidak berlaku lagi.', recoveryCodes });
    } catch (error) {
        console.error('[2FA] regenerateRecoveryCodes error:', error);
        res.status(500).json({ message: 'Gagal membuat kode cadangan baru.' });
    }
};
