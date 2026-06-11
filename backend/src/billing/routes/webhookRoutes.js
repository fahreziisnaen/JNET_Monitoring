/**
 * Route webhook payment gateway.
 * Mount: /api/billing/webhook
 *
 * Verifikasi signature HMAC butuh body MENTAH. `express.json()` global di
 * server.js menangkapnya ke `req.rawBody` (opsi verify), jadi handler memakai
 * `req.rawBody` — bukan hasil re-stringify yg byte-nya bisa berbeda.
 */
const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');

router.post('/tripay', payment.tripayCallback);

module.exports = router;
