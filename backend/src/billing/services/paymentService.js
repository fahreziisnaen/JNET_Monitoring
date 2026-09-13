const pool = require('../../config/database');
const tripayService = require('./tripayService');

function pendingStillValid(p) {
    if (!p || !p.checkout_url) return false;
    if (!p.expired_at) return true;
    return new Date(p.expired_at).getTime() > Date.now();
}

async function createPaymentForInvoice(invoice, { method } = {}) {
    const [pendingRows] = await pool.query(
        "SELECT * FROM billing_payments WHERE invoice_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
        [invoice.id]
    );
    if (pendingRows.length > 0 && pendingStillValid(pendingRows[0])) {
        return { payment: pendingRows[0], reused: true, simulated: pendingRows[0].provider !== 'tripay' };
    }

    const [custRows] = await pool.query('SELECT * FROM billing_customers WHERE id = ?', [invoice.customer_id]);
    const customer = custRows[0] || null;

    const merchantRef = `PAY-${invoice.invoice_number}-${Date.now()}`;
    const txn = await tripayService.createTransaction({
        merchantRef,
        amount: Number(invoice.amount),
        method,
        customer,
        invoice,
    });

    const [result] = await pool.query(
        `INSERT INTO billing_payments
            (workspace_id, invoice_id, provider, merchant_ref, provider_ref, payment_method, amount, fee, status, checkout_url, pay_code, expired_at, raw_response)
         VALUES (?, ?, 'tripay', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        [
            invoice.workspace_id,
            invoice.id,
            txn.merchantRef,
            txn.reference || null,
            txn.method || null,
            invoice.amount,
            txn.fee || 0,
            txn.checkoutUrl || null,
            txn.payCode || null,
            txn.expiredAt || null,
            JSON.stringify(txn.raw || {}),
        ]
    );

    const [newRows] = await pool.query('SELECT * FROM billing_payments WHERE id = ?', [result.insertId]);
    return { payment: newRows[0], reused: false, simulated: !!txn.simulated };
}

module.exports = { createPaymentForInvoice };
