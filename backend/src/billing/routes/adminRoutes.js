const express = require('express');
const router = express.Router();
const admin = require('../controllers/billingAdminController');
const { protect, authorizeNoc } = require('../../middleware/authMiddleware');

router.use(protect);
router.use(authorizeNoc);

router.get('/packages', admin.listPackages);
router.post('/packages', admin.createPackage);
router.put('/packages/:id', admin.updatePackage);
router.delete('/packages/:id', admin.deletePackage);

router.get('/customers', admin.listCustomers);
router.get('/customers/:id', admin.getCustomerDetail);
router.post('/customers', admin.createCustomer);
router.put('/customers/:id', admin.updateCustomer);
router.delete('/customers/:id', admin.deleteCustomer);
router.get('/importable-clients', admin.listImportableClients);
router.post('/import-clients', admin.importClients);

router.get('/subscriptions', admin.listSubscriptions);
router.post('/subscriptions', admin.createSubscription);
router.put('/subscriptions/:id', admin.updateSubscription);

router.get('/invoices', admin.listInvoices);
router.post('/invoices/generate', admin.generateInvoices);

router.get('/settings', admin.getSettings);
router.put('/settings', admin.updateSettings);

module.exports = router;
