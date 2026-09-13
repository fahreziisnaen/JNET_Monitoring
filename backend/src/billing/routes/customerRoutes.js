const express = require('express');
const router = express.Router();
const auth = require('../controllers/customerAuthController');
const portal = require('../controllers/customerPortalController');
const { protectCustomer } = require('../middleware/customerAuthMiddleware');

router.post('/auth/request-otp', auth.requestOtp);
router.post('/auth/verify-otp', auth.verifyOtp);

router.post('/auth/logout', protectCustomer, auth.logout);
router.get('/me', protectCustomer, auth.me);

router.get('/subscription', protectCustomer, portal.getMySubscription);
router.get('/invoices', protectCustomer, portal.getMyInvoices);
router.get('/invoices/:id', protectCustomer, portal.getMyInvoice);
router.post('/invoices/:id/pay', protectCustomer, portal.payInvoice);

module.exports = router;
