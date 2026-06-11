/**
 * Billing module entrypoint.
 * Satu titik pasang ke aplikasi Express utama (server.js):
 *
 *   const billing = require('./src/billing');
 *   billing.register(app);
 *
 * Menyediakan:
 *   - /api/billing/customer  (client-facing, auth pelanggan via OTP WA)
 *   - /api/billing/admin     (manajemen, auth admin existing)
 *   - /api/billing/webhook   (callback payment gateway, raw body + signature)
 * dan menyalakan scheduler (mati default, lihat billingScheduler.js).
 */
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const { startBillingScheduler } = require('./billingScheduler');

function register(app) {
    app.use('/api/billing/webhook', webhookRoutes); // raw body — daftar sebelum yg lain
    app.use('/api/billing/customer', customerRoutes);
    app.use('/api/billing/admin', adminRoutes);

    // Dokumentasi API (Scalar) — hanya billing. Default AKTIF; set
    // BILLING_DOCS_ENABLED=false di produksi agar tidak mengekspos surface API.
    if (process.env.BILLING_DOCS_ENABLED !== 'false') {
        app.use('/api/billing/docs', require('./routes/docsRoutes'));
        console.log('[Billing] Docs (Scalar) di /api/billing/docs');
    }

    startBillingScheduler();

    console.log('[Billing] Modul billing terpasang: /api/billing/{customer,admin,webhook}');
}

module.exports = { register };
