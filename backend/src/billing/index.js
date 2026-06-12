const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const { startBillingScheduler } = require('./billingScheduler');

function register(app) {
    app.use('/api/billing/webhook', webhookRoutes);
    app.use('/api/billing/customer', customerRoutes);
    app.use('/api/billing/admin', adminRoutes);

    if (process.env.BILLING_DOCS_ENABLED !== 'false') {
        app.use('/api/docs', require('./routes/docsRoutes'));
        console.log('[Billing] Docs (Scalar) di /api/docs');
    }

    startBillingScheduler();

    console.log('[Billing] Modul billing terpasang: /api/billing/{customer,admin,webhook}');
}

module.exports = { register };
