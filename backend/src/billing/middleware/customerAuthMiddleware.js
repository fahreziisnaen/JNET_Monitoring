/**
 * customerAuthMiddleware.js
 * Auth pelanggan billing — TERPISAH dari auth admin (authMiddleware.js).
 *
 * Token pelanggan adalah JWT dengan klaim `aud: 'billing-customer'` sehingga
 * token admin TIDAK bisa dipakai di route pelanggan dan sebaliknya. Sesi
 * dicatat di `billing_customer_sessions` agar bisa di-revoke (logout).
 *
 * React Native mengirim `Authorization: Bearer <token>`. Cookie `billing_token`
 * didukung sebagai fallback (mis. web preview).
 */
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');

const BILLING_AUDIENCE = 'billing-customer';

function signCustomerToken(payload) {
    return jwt.sign(
        { ...payload, aud: BILLING_AUDIENCE },
        process.env.JWT_SECRET || 'fallback_secret',
        { expiresIn: process.env.BILLING_JWT_EXPIRES || '30d' }
    );
}

const protectCustomer = async (req, res, next) => {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
    } else if (req.cookies && req.cookies.billing_token) {
        token = req.cookies.billing_token;
    }

    if (!token) {
        return res.status(401).json({ message: 'Tidak terotorisasi. Silakan login terlebih dahulu.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', {
            audience: BILLING_AUDIENCE,
        });

        // Pastikan sesi masih ada (belum logout / di-revoke)
        const [sessions] = await pool.query(
            'SELECT id FROM billing_customer_sessions WHERE token_id = ? AND customer_id = ?',
            [decoded.jti, decoded.id]
        );
        if (sessions.length === 0) {
            return res.status(401).json({ message: 'Sesi berakhir. Silakan login kembali.' });
        }

        const [customers] = await pool.query(
            'SELECT id, workspace_id, client_id, device_id, pppoe_secret_name, name, whatsapp_number, status FROM billing_customers WHERE id = ?',
            [decoded.id]
        );
        if (customers.length === 0) {
            return res.status(401).json({ message: 'Akun pelanggan tidak ditemukan.' });
        }
        if (customers[0].status === 'inactive') {
            return res.status(403).json({ message: 'Akun pelanggan nonaktif. Hubungi admin.' });
        }

        req.customer = customers[0];
        req.customer.jti = decoded.jti;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token tidak valid atau kedaluwarsa.' });
    }
};

module.exports = { protectCustomer, signCustomerToken, BILLING_AUDIENCE };
