const crypto = require('crypto');
const pool = require('../../config/database');
const { signCustomerToken } = require('../middleware/customerAuthMiddleware');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../../services/whatsappService');
const { normalizeWa } = require('../utils/phone');

const OTP_TTL_MINUTES = 10;

function genOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

exports.requestOtp = async (req, res) => {
    try {
        const wa = normalizeWa(req.body.whatsapp_number);
        if (!wa || wa.length < 9) {
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid.' });
        }

        const [customers] = await pool.query(
            'SELECT id, status FROM billing_customers WHERE whatsapp_number = ? LIMIT 1',
            [wa]
        );
        if (customers.length === 0) {
            return res.status(200).json({ message: 'Jika nomor terdaftar, OTP telah dikirim via WhatsApp.' });
        }
        if (customers[0].status !== 'active') {
            return res.status(403).json({ message: 'Akun pelanggan nonaktif. Hubungi admin.' });
        }

        if (!isWhatsAppConnected()) {
            return res.status(503).json({ message: 'Layanan WhatsApp sedang tidak tersedia. Coba lagi nanti.' });
        }

        const otp = genOtp();
        const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

        await pool.query('DELETE FROM billing_customer_otps WHERE whatsapp_number = ?', [wa]);
        await pool.query(
            "INSERT INTO billing_customer_otps (whatsapp_number, otp_code, purpose, expires_at) VALUES (?, ?, 'login', ?)",
            [wa, otp, expiresAt]
        );

        const sent = await sendWhatsAppMessage(
            wa,
            `Kode OTP login billing Anda: *${otp}*\nBerlaku ${OTP_TTL_MINUTES} menit. Jangan bagikan ke siapa pun.`
        );
        if (!sent) {
            return res.status(503).json({ message: 'Gagal mengirim OTP via WhatsApp. Coba lagi nanti.' });
        }

        return res.status(200).json({ message: 'OTP telah dikirim via WhatsApp.' });
    } catch (error) {
        console.error('[Billing][Auth] requestOtp error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const wa = normalizeWa(req.body.whatsapp_number);
        const otp = String(req.body.otp || '').trim();
        if (!wa || !otp) {
            return res.status(400).json({ message: 'Nomor WhatsApp dan OTP wajib diisi.' });
        }

        const [rows] = await pool.query(
            'SELECT id, otp_code, expires_at FROM billing_customer_otps WHERE whatsapp_number = ? ORDER BY id DESC LIMIT 1',
            [wa]
        );
        if (rows.length === 0 || rows[0].otp_code !== otp) {
            return res.status(401).json({ message: 'OTP salah.' });
        }
        if (new Date(rows[0].expires_at) < new Date()) {
            return res.status(401).json({ message: 'OTP kedaluwarsa. Minta OTP baru.' });
        }

        const [customers] = await pool.query(
            'SELECT id, workspace_id, name, whatsapp_number FROM billing_customers WHERE whatsapp_number = ? LIMIT 1',
            [wa]
        );
        if (customers.length === 0) {
            return res.status(404).json({ message: 'Akun pelanggan tidak ditemukan.' });
        }
        const customer = customers[0];

        await pool.query('DELETE FROM billing_customer_otps WHERE whatsapp_number = ?', [wa]);

        const tokenId = crypto.randomUUID();
        const userAgent = (req.headers['user-agent'] || '').substring(0, 255);
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().substring(0, 64);
        await pool.query(
            'INSERT INTO billing_customer_sessions (customer_id, token_id, user_agent, ip_address) VALUES (?, ?, ?, ?)',
            [customer.id, tokenId, userAgent, ip]
        );

        const token = signCustomerToken({ id: customer.id, workspace_id: customer.workspace_id, jti: tokenId });

        res.cookie('billing_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        return res.status(200).json({
            message: 'Login berhasil.',
            token,
            customer: { id: customer.id, name: customer.name, whatsapp_number: customer.whatsapp_number },
        });
    } catch (error) {
        console.error('[Billing][Auth] verifyOtp error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.logout = async (req, res) => {
    try {
        if (req.customer?.jti) {
            await pool.query('DELETE FROM billing_customer_sessions WHERE token_id = ?', [req.customer.jti]);
        }
        res.cookie('billing_token', '', { httpOnly: true, maxAge: 0 });
        return res.status(200).json({ message: 'Logout berhasil.' });
    } catch (error) {
        console.error('[Billing][Auth] logout error:', error.message);
        return res.status(500).json({ message: 'Terjadi kesalahan internal.' });
    }
};

exports.me = async (req, res) => {
    return res.status(200).json({ customer: req.customer });
};
