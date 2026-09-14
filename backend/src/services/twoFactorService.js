/**
 * twoFactorService.js
 * Logika 2FA (TOTP Google Authenticator + kode cadangan) yang dipakai login, reset password, dan pengaturan.
 */
const pool = require('../config/database');
const totp = require('../utils/totp');

const ISSUER = process.env.TOTP_ISSUER || 'JNET Monitoring';

async function getStatus(userId) {
    const [users] = await pool.query('SELECT totp_enabled FROM users WHERE id = ?', [userId]);
    const [codes] = await pool.query(
        'SELECT COUNT(*) AS remaining FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL',
        [userId]
    );
    return {
        enabled: !!users[0]?.totp_enabled,
        recoveryCodesRemaining: Number(codes[0].remaining),
    };
}

/** Membuat secret baru (belum aktif) dan mengembalikan data untuk QR code. */
async function beginSetup(user) {
    const secret = totp.generateSecret();
    const [result] = await pool.query(
        'UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ? AND totp_enabled = 0',
        [totp.encryptSecret(secret), user.id]
    );
    if (result.affectedRows === 0) return null; // sudah aktif
    return {
        secret,
        otpauthUrl: totp.buildOtpauthUrl({ secret, accountName: user.username, issuer: ISSUER }),
    };
}

async function replaceRecoveryCodes(conn, userId) {
    const codes = totp.generateRecoveryCodes();
    await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
    await conn.query(
        'INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ?',
        [codes.map(code => [userId, totp.hashRecoveryCode(code)])]
    );
    return codes;
}

/** Mengaktifkan 2FA setelah user membuktikan aplikasi Authenticator sudah terpasang. */
async function confirmSetup(userId, code) {
    const [users] = await pool.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [userId]);
    const user = users[0];
    if (!user || user.totp_enabled || !user.totp_secret) return null;

    const step = totp.verify(totp.decryptSecret(user.totp_secret), code);
    if (step === null) return null;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [step, userId]);
        const codes = await replaceRecoveryCodes(conn, userId);
        await conn.commit();
        return codes;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

/**
 * Cek kode 6 digit Authenticator atau kode cadangan (sekali pakai).
 * @returns {Promise<'totp'|'recovery'|null>}
 */
async function verifyCode(userId, code) {
    const input = String(code || '').trim();
    const [users] = await pool.query('SELECT totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?', [userId]);
    const user = users[0];
    if (!user || !user.totp_enabled || !user.totp_secret) return null;

    if (/^\d{3}\s?\d{3}$/.test(input)) {
        const lastStep = user.totp_last_step == null ? null : Number(user.totp_last_step);
        const step = totp.verify(totp.decryptSecret(user.totp_secret), input, { afterStep: lastStep });
        if (step === null) return null;
        // Update bersyarat agar kode yang sama tidak bisa dipakai dua request bersamaan
        const [result] = await pool.query(
            'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
            [step, userId, step]
        );
        return result.affectedRows === 1 ? 'totp' : null;
    }

    if (totp.normalizeRecoveryCode(input).length !== 8) return null;
    const [result] = await pool.query(
        'UPDATE user_recovery_codes SET used_at = NOW() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
        [userId, totp.hashRecoveryCode(input)]
    );
    return result.affectedRows === 1 ? 'recovery' : null;
}

async function disable(userId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?', [userId]);
        await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId]);
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function regenerateRecoveryCodes(userId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const codes = await replaceRecoveryCodes(conn, userId);
        await conn.commit();
        return codes;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = { getStatus, beginSetup, confirmSetup, verifyCode, disable, regenerateRecoveryCodes };
