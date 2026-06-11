/**
 * phone.js — normalisasi nomor WhatsApp ke bentuk kanonik (62...).
 * Dipakai konsisten saat MENYIMPAN pelanggan dan saat MENCARI nomor untuk OTP,
 * agar lookup selalu cocok (mis. "0823..." dan "+62823..." -> "62823...").
 */
function normalizeWa(number) {
    if (!number) return '';
    let n = String(number).replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    if (n.startsWith('620')) n = '62' + n.slice(3); // jaga-jaga "620..." -> "62..."
    return n;
}

module.exports = { normalizeWa };
