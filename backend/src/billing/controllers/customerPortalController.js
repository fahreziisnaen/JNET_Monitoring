const pool = require('../../config/database');
const tripayService = require('../services/tripayService');

exports.getMySubscription = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.status, s.start_date, s.due_day_of_month, s.next_due_date,
                    p.id AS package_id, p.name AS package_name, p.price, p.speed_mbps, p.description
             FROM billing_subscriptions s
             JOIN billing_packages p ON p.id = s.package_id
             WHERE s.customer_id = ?
             ORDER BY s.id DESC LIMIT 1`,
            [req.customer.id]
        );
        return res.status(200).json({ subscription: rows[0] || null });
    } catch (error) {
        console.error('[Billing][Portal] getMySubscription error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.getMyInvoices = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, invoice_number, period_year, period_month, amount, due_date, status, paid_at, created_at
             FROM billing_invoices
             WHERE customer_id = ?
             ORDER BY period_year DESC, period_month DESC`,
            [req.customer.id]
        );
        return res.status(200).json({ invoices: rows });
    } catch (error) {
        console.error('[Billing][Portal] getMyInvoices error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.getMyInvoice = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM billing_invoices WHERE id = ? AND customer_id = ?',
            [req.params.id, req.customer.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Invoice tidak ditemukan.' });

        const [payments] = await pool.query(
            `SELECT id, provider, status, payment_method, amount, checkout_url, pay_code, expired_at, paid_at, created_at
             FROM billing_payments WHERE invoice_id = ? ORDER BY id DESC`,
            [req.params.id]
        );
        return res.status(200).json({ invoice: rows[0], payments });
    } catch (error) {
        console.error('[Billing][Portal] getMyInvoice error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.payInvoice = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM billing_invoices WHERE id = ? AND customer_id = ?',
            [req.params.id, req.customer.id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Invoice tidak ditemukan.' });
        const invoice = rows[0];
        if (invoice.status === 'paid') {
            return res.status(400).json({ message: 'Invoice sudah lunas.' });
        }

        const [pending] = await pool.query(
            "SELECT * FROM billing_payments WHERE invoice_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
            [invoice.id]
        );
        if (pending.length > 0) {
            return res.status(200).json({ message: 'Transaksi pembayaran masih aktif.', payment: pending[0] });
        }

        const [settingsRows] = await pool.query('SELECT * FROM billing_settings WHERE workspace_id = ?', [invoice.workspace_id]);
        const settings = settingsRows[0] || null;

        const merchantRef = `PAY-${invoice.invoice_number}-${Date.now()}`;
        let txn;
        try {
            txn = await tripayService.createTransaction(settings, {
                merchantRef,
                amount: Number(invoice.amount),
                method: req.body.method,
                customer: req.customer,
                invoice,
            });
        } catch (gwErr) {
            console.error('[Billing][Portal] gateway error:', gwErr.message);
            return res.status(502).json({ message: 'Gagal membuat transaksi pembayaran. Hubungi admin.' });
        }

        const [result] = await pool.query(
            `INSERT INTO billing_payments
                (workspace_id, invoice_id, provider, merchant_ref, provider_ref, payment_method, amount, status, checkout_url, pay_code, expired_at, raw_response)
             VALUES (?, ?, 'tripay', ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
            [
                invoice.workspace_id,
                invoice.id,
                txn.merchantRef,
                txn.reference || null,
                txn.method || null,
                invoice.amount,
                txn.checkoutUrl || null,
                txn.payCode || null,
                txn.expiredAt || null,
                JSON.stringify(txn.raw || {}),
            ]
        );

        return res.status(201).json({
            message: txn.simulated
                ? 'Transaksi pembayaran dibuat (mode simulasi — gateway belum dikonfigurasi).'
                : 'Transaksi pembayaran dibuat.',
            payment: {
                id: result.insertId,
                merchant_ref: txn.merchantRef,
                checkout_url: txn.checkoutUrl || null,
                pay_code: txn.payCode || null,
                expired_at: txn.expiredAt || null,
                simulated: !!txn.simulated,
            },
        });
    } catch (error) {
        console.error('[Billing][Portal] payInvoice error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};
