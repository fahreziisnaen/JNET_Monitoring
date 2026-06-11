/**
 * paymentController.js
 * Webhook callback dari payment gateway (Tripay). Saat pembayaran sukses:
 *   1. tandai billing_payments -> paid
 *   2. tandai billing_invoices -> paid
 *   3. (semi-otomatis) buka isolir pelanggan jika sebelumnya ter-isolir
 *
 * Endpoint ini TANPA auth pelanggan/admin — keamanannya dari verifikasi
 * signature HMAC. Body mentah diambil dari `req.rawBody` (ditangkap parser
 * JSON global di server.js) agar signature cocok byte-per-byte.
 */
const pool = require('../../config/database');
const tripayService = require('../services/tripayService');
const isolirService = require('../services/isolirService');

// POST /api/billing/webhook/tripay
exports.tripayCallback = async (req, res) => {
    try {
        const rawBody = req.rawBody
            || (req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {}));
        let payload;
        try {
            payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) && req.rawBody
                ? req.body              // sudah di-parse parser global; rawBody tetap utk signature
                : JSON.parse(rawBody);
        } catch {
            return res.status(400).json({ success: false, message: 'Body tidak valid.' });
        }

        const merchantRef = payload.merchant_ref;
        if (!merchantRef) {
            return res.status(400).json({ success: false, message: 'merchant_ref tidak ada.' });
        }

        // Temukan pembayaran + workspace untuk ambil private key verifikasi signature.
        const [payments] = await pool.query(
            'SELECT * FROM billing_payments WHERE merchant_ref = ? LIMIT 1',
            [merchantRef]
        );
        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        }
        const payment = payments[0];

        const [settingsRows] = await pool.query('SELECT * FROM billing_settings WHERE workspace_id = ?', [payment.workspace_id]);
        const settings = settingsRows[0];
        const signatureHeader = req.headers['x-callback-signature'];

        // Verifikasi signature (lewati hanya untuk pembayaran simulasi tanpa kredensial).
        const isSimulated = !settings || !settings.tripay_private_key;
        if (!isSimulated) {
            const valid = tripayService.verifyCallbackSignature(settings.tripay_private_key, rawBody, signatureHeader);
            if (!valid) {
                console.warn('[Billing][Webhook] Signature tidak valid untuk', merchantRef);
                return res.status(403).json({ success: false, message: 'Signature tidak valid.' });
            }
        }

        const gwStatus = String(payload.status || '').toUpperCase();
        const statusMap = { PAID: 'paid', EXPIRED: 'expired', FAILED: 'failed', REFUND: 'refunded' };
        const newStatus = statusMap[gwStatus] || 'pending';

        await pool.query(
            'UPDATE billing_payments SET status = ?, provider_ref = COALESCE(?, provider_ref), paid_at = ?, raw_response = ? WHERE id = ?',
            [newStatus, payload.reference || null, newStatus === 'paid' ? new Date() : null, JSON.stringify(payload), payment.id]
        );

        if (newStatus === 'paid') {
            await handleInvoicePaid(payment.invoice_id);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[Billing][Webhook] tripayCallback error:', error.message);
        return res.status(500).json({ success: false, message: 'Kesalahan internal.' });
    }
};

/** Tandai invoice lunas & buka isolir pelanggan terkait (semi-otomatis). */
async function handleInvoicePaid(invoiceId) {
    const [invRows] = await pool.query('SELECT * FROM billing_invoices WHERE id = ?', [invoiceId]);
    if (invRows.length === 0) return;
    const invoice = invRows[0];

    await pool.query(
        "UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
        [new Date(), invoiceId]
    );

    // Buka isolir bila pelanggan punya secret PPPoE.
    const [custRows] = await pool.query(
        'SELECT bc.*, p.pppoe_profile FROM billing_customers bc ' +
        'LEFT JOIN billing_subscriptions s ON s.id = ? ' +
        'LEFT JOIN billing_packages p ON p.id = s.package_id ' +
        'WHERE bc.id = ?',
        [invoice.subscription_id, invoice.customer_id]
    );
    const customer = custRows[0];
    if (customer && customer.pppoe_secret_name) {
        try {
            await isolirService.restoreCustomer({
                workspaceId: invoice.workspace_id,
                deviceId: customer.device_id,
                secretName: customer.pppoe_secret_name,
                targetProfile: customer.pppoe_profile || null,
            });
        } catch (e) {
            console.error('[Billing][Webhook] restoreCustomer gagal:', e.message);
        }
    }
}

module.exports.handleInvoicePaid = handleInvoicePaid;
