const crypto = require('crypto');

const ENDPOINTS = {
    sandbox: 'https://tripay.co.id/api-sandbox',
    production: 'https://tripay.co.id/api',
};

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

function buildTransactionSignature(config, merchantRef, amount) {
    return crypto
        .createHmac('sha256', config.privateKey)
        .update(`${config.merchantCode}${merchantRef}${amount}`)
        .digest('hex');
}

function verifyCallbackSignature(privateKey, rawBody, signatureHeader) {
    if (!privateKey || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', privateKey).update(rawBody).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
    } catch {
        return false;
    }
}

async function createTransaction(settings, { merchantRef, amount, method, customer, invoice }) {
    const config = getConfig(settings);

    if (!isConfigured(settings)) {
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
