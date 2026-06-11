/**
 * tripayService.js
 * Abstraksi payment gateway. Implementasi pertama: Tripay.
 *
 * STATUS: SCAFFOLD. Pemanggilan HTTP ke Tripay sengaja di-stub (lihat
 * createTransaction) agar fondasi aman dijalankan tanpa kredensial nyata.
 * Saat siap go-live: isi bagian bertanda `// TODO(go-live)` dengan request
 * axios ke endpoint Tripay. Tanda tangan webhook (verifyCallbackSignature)
 * SUDAH nyata (HMAC-SHA256) sehingga endpoint webhook bisa diuji end-to-end.
 *
 * Docs: https://tripay.co.id/developer
 */
const crypto = require('crypto');

const ENDPOINTS = {
    sandbox: 'https://tripay.co.id/api-sandbox',
    production: 'https://tripay.co.id/api',
};

/** Ambil konfigurasi Tripay dari row billing_settings. */
function getConfig(settings) {
    if (!settings) return null;
    return {
        merchantCode: settings.tripay_merchant_code,
        apiKey: settings.tripay_api_key,
        privateKey: settings.tripay_private_key,
        mode: settings.tripay_mode === 'production' ? 'production' : 'sandbox',
        baseUrl: ENDPOINTS[settings.tripay_mode === 'production' ? 'production' : 'sandbox'],
    };
}

function isConfigured(settings) {
    const c = getConfig(settings);
    return !!(c && c.merchantCode && c.apiKey && c.privateKey);
}

/**
 * Signature transaksi Tripay = HMAC-SHA256(merchantCode + merchantRef + amount, privateKey).
 */
function buildTransactionSignature(config, merchantRef, amount) {
    return crypto
        .createHmac('sha256', config.privateKey)
        .update(`${config.merchantCode}${merchantRef}${amount}`)
        .digest('hex');
}

/**
 * Verifikasi signature callback Tripay (header X-Callback-Signature).
 * Signature = HMAC-SHA256(rawBody, privateKey). NYATA & siap dipakai.
 */
function verifyCallbackSignature(privateKey, rawBody, signatureHeader) {
    if (!privateKey || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', privateKey).update(rawBody).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
    } catch {
        return false;
    }
}

/**
 * Buat transaksi pembayaran di gateway.
 * @returns {Promise<{merchantRef, reference, checkoutUrl, payCode, expiredAt, method, raw}>}
 *
 * SCAFFOLD: tanpa kredensial nyata, mengembalikan transaksi tiruan agar alur
 * UI/DB bisa diuji. Dengan kredensial nyata, ganti blok stub dgn request axios.
 */
async function createTransaction(settings, { merchantRef, amount, method, customer, invoice }) {
    const config = getConfig(settings);

    if (!isConfigured(settings)) {
        // Mode SCAFFOLD: gateway belum dikonfigurasi -> kembalikan tiruan deterministik.
        return {
            simulated: true,
            merchantRef,
            reference: `SIMREF-${merchantRef}`,
            checkoutUrl: `https://example.invalid/checkout/${merchantRef}`,
            payCode: null,
            method: method || 'SIMULATED',
            expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            raw: { simulated: true, note: 'Tripay belum dikonfigurasi (billing_settings kosong).' },
        };
    }

    const signature = buildTransactionSignature(config, merchantRef, amount);

    // TODO(go-live): lakukan POST ke `${config.baseUrl}/transaction/create`
    //   headers: { Authorization: `Bearer ${config.apiKey}` }
    //   body: { method, merchant_ref: merchantRef, amount, customer_name, customer_email,
    //           customer_phone, order_items: [...], callback_url, return_url, expired_time, signature }
    //   lalu map response.data.data ke bentuk return di bawah.
    void signature; void customer; void invoice;
    throw new Error('tripayService.createTransaction belum diimplementasikan (TODO go-live).');
}

module.exports = {
    getConfig,
    isConfigured,
    buildTransactionSignature,
    verifyCallbackSignature,
    createTransaction,
};
