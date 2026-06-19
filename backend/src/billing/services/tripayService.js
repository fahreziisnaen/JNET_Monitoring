const crypto = require('crypto');
const axios = require('axios');
const { normalizeWa } = require('../utils/phone');

const ENDPOINTS = {
    sandbox: 'https://tripay.co.id/api-sandbox',
    production: 'https://tripay.co.id/api',
};

const DEFAULT_CHANNEL = process.env.TRIPAY_DEFAULT_CHANNEL || 'QRIS';
const EXPIRY_HOURS = parseInt(process.env.TRIPAY_EXPIRY_HOURS || '24', 10);

function getConfig() {
    const mode = process.env.TRIPAY_MODE === 'production' ? 'production' : 'sandbox';
    return {
        merchantCode: process.env.TRIPAY_MERCHANT_CODE || null,
        apiKey: process.env.TRIPAY_API_KEY || null,
        privateKey: process.env.TRIPAY_PRIVATE_KEY || null,
        mode,
        baseUrl: ENDPOINTS[mode],
    };
}

function isConfigured() {
    const c = getConfig();
    return !!(c.merchantCode && c.apiKey && c.privateKey);
}

function buildTransactionSignature(config, merchantRef, amount) {
    return crypto
        .createHmac('sha256', config.privateKey)
        .update(`${config.merchantCode}${merchantRef}${amount}`)
        .digest('hex');
}

function verifyCallbackSignature(rawBody, signatureHeader) {
    const privateKey = getConfig().privateKey;
    if (!privateKey || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', privateKey).update(rawBody).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
    } catch {
        return false;
    }
}

async function createTransaction({ merchantRef, amount, method, customer, invoice }) {
    const config = getConfig();

    if (!isConfigured()) {
        return {
            simulated: true,
            merchantRef,
            reference: `SIMREF-${merchantRef}`,
            checkoutUrl: `https://example.invalid/checkout/${merchantRef}`,
            payCode: null,
            method: method || 'SIMULATED',
            fee: 0,
            expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            raw: { simulated: true, note: 'Tripay belum dikonfigurasi (.env kosong).' },
        };
    }

    const intAmount = Math.round(Number(amount));
    const signature = buildTransactionSignature(config, merchantRef, intAmount);

    const itemName = invoice ? `Tagihan ${invoice.invoice_number}` : 'Tagihan internet';
    const phone = normalizeWa(customer && customer.whatsapp_number) || undefined;

    const payload = {
        method: method || DEFAULT_CHANNEL,
        merchant_ref: merchantRef,
        amount: intAmount,
        customer_name: (customer && customer.name) || 'Pelanggan',
        customer_email: (customer && customer.email) || 'pelanggan@example.com',
        customer_phone: phone,
        order_items: [{ name: itemName, price: intAmount, quantity: 1 }],
        expired_time: Math.floor(Date.now() / 1000) + EXPIRY_HOURS * 3600,
        signature,
    };

    let resp;
    try {
        resp = await axios.post(`${config.baseUrl}/transaction/create`, payload, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: 20000,
        });
    } catch (err) {
        const msg = err.response && err.response.data && err.response.data.message
            ? err.response.data.message
            : err.message;
        throw new Error(`Tripay: ${msg}`);
    }

    const body = resp.data || {};
    if (!body.success || !body.data) {
        throw new Error(`Tripay menolak transaksi: ${body.message || 'respons tidak valid'}`);
    }
    const d = body.data;

    return {
        simulated: false,
        merchantRef: d.merchant_ref || merchantRef,
        reference: d.reference || null,
        checkoutUrl: d.checkout_url || null,
        payCode: d.pay_code || null,
        method: d.payment_method || payload.method,
        fee: d.total_fee != null ? d.total_fee : 0,
        expiredAt: d.expired_time ? new Date(d.expired_time * 1000) : null,
        raw: d,
    };
}

module.exports = {
    getConfig,
    isConfigured,
    buildTransactionSignature,
    verifyCallbackSignature,
    createTransaction,
};
