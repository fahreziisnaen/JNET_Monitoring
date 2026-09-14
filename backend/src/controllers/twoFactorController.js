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

// Kolom/tabel 2FA belum ada di database: beri tahu cara memperbaikinya, bukan error generik
function sendServerError(res, error, fallbackMessage) {
    if (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({ message: 'Fitur 2FA belum siap: migrasi database belum dijalankan. Admin server perlu menjalankan \"node migrations/run-security-migration.js\" di folder backend.' });
    }
    return res.status(500).json({ message: fallbackMessage });
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
        sendServerError(res, error, 'Gagal mengambil status 2FA.');
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
        sendServerError(res, error, 'Gagal memulai pemasangan 2FA.');
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
        sendServerError(res, error, 'Gagal mengaktifkan 2FA.');
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
        sendServerError(res, error, 'Gagal menonaktifkan 2FA.');
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
        sendServerError(res, error, 'Gagal membuat kode cadangan baru.');
    }
};
