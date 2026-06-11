/**
 * Route admin manajemen billing.
 * Mount: /api/billing/admin  (memakai auth admin existing: protect + authorizeAdmin)
 */
const express = require('express');
const router = express.Router();
const admin = require('../controllers/billingAdminController');
const { protect, authorizeAdmin } = require('../../middleware/authMiddleware');

router.use(protect);
router.use(authorizeAdmin);

// Paket
router.get('/packages', admin.listPackages);
router.post('/packages', admin.createPackage);
router.put('/packages/:id', admin.updatePackage);
router.delete('/packages/:id', admin.deletePackage);

// Pelanggan
router.get('/customers', admin.listCustomers);
router.post('/customers', admin.createCustomer);
router.put('/customers/:id', admin.updateCustomer);

// Langganan
router.get('/subscriptions', admin.listSubscriptions);
router.post('/subscriptions', admin.createSubscription);
router.put('/subscriptions/:id', admin.updateSubscription);

// Invoice
router.get('/invoices', admin.listInvoices);
router.post('/invoices/generate', admin.generateInvoices);

// Pengaturan billing + gateway
router.get('/settings', admin.getSettings);
router.put('/settings', admin.updateSettings);

module.exports = router;
