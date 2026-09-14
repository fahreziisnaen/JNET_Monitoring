/**
 * totp.js
 * TOTP (RFC 6238, HMAC-SHA1, 30 detik, 6 digit) untuk Google Authenticator dan aplikasi sejenis,
 * plus enkripsi secret at-rest (AES-256-GCM) dan kode cadangan.
 */
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALLOWED_DRIFT_STEPS = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Tanpa 0/O/1/I agar kode cadangan tidak salah baca
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(input) {
    const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const char of clean) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) throw new Error('Secret base32 tidak valid.');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function codeForStep(secretBase32, step, digits) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(binary % 10 ** digits).padStart(digits, '0');
}

function generate(secretBase32, { timestampMs = Date.now(), digits = DIGITS } = {}) {
    return codeForStep(secretBase32, Math.floor(timestampMs / 1000 / STEP_SECONDS), digits);
}

/**
 * Cek kode TOTP dengan toleransi ±1 langkah.
 * @param {number|null} afterStep langkah terakhir yang sudah dipakai; kode di langkah itu atau sebelumnya ditolak (anti replay)
 * @returns {number|null} nomor langkah yang cocok, atau null jika tidak valid
 */
function verify(secretBase32, code, { timestampMs = Date.now(), afterStep = null } = {}) {
    const normalized = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) return null;

    const currentStep = Math.floor(timestampMs / 1000 / STEP_SECONDS);
    for (let drift = -ALLOWED_DRIFT_STEPS; drift <= ALLOWED_DRIFT_STEPS; drift++) {
        const step = currentStep + drift;
        if (afterStep != null && step <= afterStep) continue;
        const expected = Buffer.from(codeForStep(secretBase32, step, DIGITS));
        if (crypto.timingSafeEqual(expected, Buffer.from(normalized))) return step;
    }
    return null;
}

function buildOtpauthUrl({ secret, accountName, issuer }) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
    const params = `secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
    return `otpauth://totp/${label}?${params}`;
}

let warnedDerivedKey = false;
function encryptionKey() {
    if (process.env.TOTP_ENCRYPTION_KEY) {
        return crypto.createHash('sha256').update(process.env.TOTP_ENCRYPTION_KEY).digest();
    }
    if (process.env.JWT_SECRET) {
        if (!warnedDerivedKey) {
            console.error('[2FA] TOTP_ENCRYPTION_KEY belum di-set; memakai kunci turunan JWT_SECRET. Mengganti JWT_SECRET akan membuat 2FA semua user tidak bisa dipakai.');
            warnedDerivedKey = true;
        }
        return crypto.createHash('sha256').update(`totp:${process.env.JWT_SECRET}`).digest();
    }
    throw new Error('TOTP_ENCRYPTION_KEY atau JWT_SECRET wajib di-set untuk 2FA.');
}

function encryptSecret(secretBase32) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptSecret(stored) {
    const [version, iv, tag, ciphertext] = String(stored).split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Format secret 2FA tidak dikenal.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function generateRecoveryCodes(count = 10) {
    const codes = new Set();
    while (codes.size < count) {
        let raw = '';
        for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
        codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    }
    return [...codes];
}

function normalizeRecoveryCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code) {
    return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

module.exports = {
    base32Encode,
    base32Decode,
    generateSecret,
    generate,
    verify,
    buildOtpauthUrl,
    encryptSecret,
    decryptSecret,
    generateRecoveryCodes,
    normalizeRecoveryCode,
    hashRecoveryCode,
};
