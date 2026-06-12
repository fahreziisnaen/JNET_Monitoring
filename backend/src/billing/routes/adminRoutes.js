/**
 * Route admin manajemen billing.
 * Mount: /api/billing/admin  (memakai auth admin existing: protect + authorizeAdmin)
 */
const express = require('express');
const router = express.Router();
const admin = require('../controllers/billingAdminController');
const { protect, authorizeNoc } = require('../../middleware/authMiddleware');

router.use(protect);
// authorizeNoc = noc + admin + owner + super_admin (sesuai kebijakan akses billing)
router.use(authorizeNoc);

// Paket
router.get('/packages', admin.listPackages);
router.post('/packages', admin.createPackage);
router.put('/packages/:id', admin.updatePackage);
router.delete('/packages/:id', admin.deletePackage);

// Pelanggan
router.get('/customers', admin.listCustomers);
router.post('/customers', admin.createCustomer);
router.put('/customers/:id', admin.updateCustomer);
router.get('/importable-clients', admin.listImportableClients);
router.post('/import-clients', admin.importClients);

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
