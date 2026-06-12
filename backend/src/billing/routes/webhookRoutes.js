const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');

router.post('/tripay', payment.tripayCallback);

module.exports = router;
