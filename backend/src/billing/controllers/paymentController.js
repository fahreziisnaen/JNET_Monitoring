const pool = require('../../config/database');
const withTransaction = require('../../utils/withTransaction');
const tripayService = require('../services/tripayService');
const isolirService = require('../services/isolirService');

exports.tripayCallback = async (req, res) => {
    try {
        const rawBody = req.rawBody
            || (req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {}));
        let payload;
        try {
            payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) && req.rawBody
                ? req.body
                : JSON.parse(rawBody);
        } catch {
            return res.status(400).json({ success: false, message: 'Body tidak valid.' });
        }

        const merchantRef = payload.merchant_ref;
        if (!merchantRef) {
            return res.status(400).json({ success: false, message: 'merchant_ref tidak ada.' });
        }

        const [payments] = await pool.query(
            'SELECT id FROM billing_payments WHERE merchant_ref = ? LIMIT 1',
            [merchantRef]
        );
        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan.' });
        }
        const paymentId = payments[0].id;

        const signatureHeader = req.headers['x-callback-signature'];

        if (tripayService.isConfigured()) {
            const valid = tripayService.verifyCallbackSignature(rawBody, signatureHeader);
            if (!valid) {
                console.warn('[Billing][Webhook] Signature tidak valid untuk', merchantRef);
                return res.status(403).json({ success: false, message: 'Signature tidak valid.' });
            }
        }

        const gwStatus = String(payload.status || '').toUpperCase();
        const statusMap = { PAID: 'paid', EXPIRED: 'expired', FAILED: 'failed', REFUND: 'refunded' };
        const newStatus = statusMap[gwStatus] || 'pending';
        const TERMINAL = ['paid', 'expired', 'failed', 'refunded'];

        const restoreArgs = await withTransaction(async (conn) => {
            const [rows] = await conn.query(
                'SELECT * FROM billing_payments WHERE id = ? FOR UPDATE',
                [paymentId]
            );
            const payment = rows[0];

            if (payment.status === newStatus && TERMINAL.includes(newStatus)) {
                console.log(`[Billing][Webhook] Callback duplikat (${newStatus}) untuk ${merchantRef}, diabaikan.`);
                return null;
            }
            if (payment.status === 'paid' && newStatus !== 'refunded') {
                console.warn(`[Billing][Webhook] Callback ${newStatus} untuk ${merchantRef} diabaikan; pembayaran sudah lunas.`);
                return null;
            }

            await conn.query(
                'UPDATE billing_payments SET status = ?, provider_ref = COALESCE(?, provider_ref), paid_at = COALESCE(paid_at, ?), raw_response = ? WHERE id = ?',
                [newStatus, payload.reference || null, newStatus === 'paid' ? new Date() : null, JSON.stringify(payload), payment.id]
            );
            if (newStatus === 'paid') {
                return await markInvoicePaid(payment.invoice_id, conn);
            }
            return null;
        });

        if (restoreArgs) await tryRestoreCustomer(restoreArgs);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[Billing][Webhook] tripayCallback error:', error.message);
        return res.status(500).json({ success: false, message: 'Kesalahan internal.' });
    }
};

async function markInvoicePaid(invoiceId, conn) {
    const [invRows] = await conn.query('SELECT * FROM billing_invoices WHERE id = ? FOR UPDATE', [invoiceId]);
    if (invRows.length === 0) return null;
    const invoice = invRows[0];

    if (invoice.status === 'paid') return null;

    await conn.query(
        "UPDATE billing_invoices SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ?",
        [new Date(), invoiceId]
    );

    const [custRows] = await conn.query(
        'SELECT bc.*, p.pppoe_profile FROM billing_customers bc ' +
        'LEFT JOIN billing_subscriptions s ON s.id = ? ' +
        'LEFT JOIN billing_packages p ON p.id = s.package_id ' +
        'WHERE bc.id = ?',
        [invoice.subscription_id, invoice.customer_id]
    );
    const customer = custRows[0];
    if (customer && customer.pppoe_secret_name) {
        return {
            workspaceId: invoice.workspace_id,
            deviceId: customer.device_id,
            secretName: customer.pppoe_secret_name,
            targetProfile: customer.pppoe_profile || null,
        };
    }
    return null;
}

async function tryRestoreCustomer(args) {
    try {
        await isolirService.restoreCustomer(args);
    } catch (e) {
        console.error('[Billing][Webhook] restoreCustomer gagal:', e.message);
    }
}

async function handleInvoicePaid(invoiceId) {
    const restoreArgs = await withTransaction((conn) => markInvoicePaid(invoiceId, conn));
    if (restoreArgs) await tryRestoreCustomer(restoreArgs);
}

module.exports.handleInvoicePaid = handleInvoicePaid;
