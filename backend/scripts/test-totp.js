// Uji util TOTP terhadap test vector RFC 6238 (SHA-1) dan enkripsi secret.
// Jalankan: node scripts/test-totp.js
process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || 'kunci-uji-totp';
const totp = require('../src/utils/totp');

let failures = 0;
function check(label, ok, extra = '') {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` (${extra})` : ''}`);
    if (!ok) failures++;
}

// Secret RFC 6238 untuk SHA-1: ASCII "12345678901234567890"
const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));
check('base32 encode sesuai RFC 4648', RFC_SECRET === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', RFC_SECRET);
check('base32 decode bolak-balik', totp.base32Decode(RFC_SECRET).toString() === '12345678901234567890');

const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
];
for (const [seconds, expected] of vectors) {
    const code8 = totp.generate(RFC_SECRET, { timestampMs: seconds * 1000, digits: 8 });
    check(`kode 8 digit T=${seconds}`, code8 === expected, code8);
}
check('kode 6 digit = 6 digit terakhir', totp.generate(RFC_SECRET, { timestampMs: 59000 }) === '287082');

// verify: toleransi ±1 langkah (30 detik) dan mengembalikan nomor langkah untuk cegah pemakaian ulang
const now = 1700000000 * 1000;
const current = totp.generate(RFC_SECRET, { timestampMs: now });
const previous = totp.generate(RFC_SECRET, { timestampMs: now - 30000 });
const tooOld = totp.generate(RFC_SECRET, { timestampMs: now - 90000 });
const step = Math.floor(now / 30000);
check('verify kode langkah sekarang', totp.verify(RFC_SECRET, current, { timestampMs: now }) === step);
check('verify kode langkah sebelumnya (clock drift)', totp.verify(RFC_SECRET, previous, { timestampMs: now }) === step - 1);
check('tolak kode 3 langkah lalu', totp.verify(RFC_SECRET, tooOld, { timestampMs: now }) === null);
check('tolak kode salah', totp.verify(RFC_SECRET, '000000', { timestampMs: now }) === null || current === '000000');
check('tolak input bukan 6 digit', totp.verify(RFC_SECRET, '12a456', { timestampMs: now }) === null);
check('kode dengan spasi tetap diterima', totp.verify(RFC_SECRET, `${current.slice(0, 3)} ${current.slice(3)}`, { timestampMs: now }) === step);
check('tolak langkah yang sudah dipakai (replay)', totp.verify(RFC_SECRET, current, { timestampMs: now, afterStep: step }) === null);

// Secret baru & URL otpauth
const secret = totp.generateSecret();
check('secret baru 32 karakter base32 (160 bit)', /^[A-Z2-7]{32}$/.test(secret), secret);
const url = totp.buildOtpauthUrl({ secret, accountName: 'budi', issuer: 'JNET Monitoring' });
check('otpauth URL berisi issuer & secret', url.startsWith('otpauth://totp/JNET%20Monitoring:budi?') && url.includes(`secret=${secret}`) && url.includes('issuer=JNET%20Monitoring'), url);

// Enkripsi secret at-rest
const encrypted = totp.encryptSecret(secret);
check('secret terenkripsi tidak berisi plaintext', !encrypted.includes(secret));
check('dekripsi mengembalikan secret', totp.decryptSecret(encrypted) === secret);
check('dua enkripsi memakai IV berbeda', totp.encryptSecret(secret) !== encrypted);
let tamperRejected = false;
const parts = encrypted.split(':');
const ct = parts[parts.length - 1];
parts[parts.length - 1] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
try { totp.decryptSecret(parts.join(':')); } catch { tamperRejected = true; }
check('ciphertext yang diubah ditolak (GCM auth tag)', tamperRejected);

// Kode cadangan
const codes = totp.generateRecoveryCodes();
check('10 kode cadangan format XXXX-XXXX', codes.length === 10 && codes.every(c => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), codes[0]);
check('kode cadangan unik', new Set(codes).size === 10);
check('hash kode cadangan tidak peka huruf/tanda hubung', totp.hashRecoveryCode(codes[0]) === totp.hashRecoveryCode(codes[0].toLowerCase().replace('-', '')));

console.log(failures ? `\n${failures} FAIL` : '\nSEMUA PASS');
process.exit(failures ? 1 : 0);
