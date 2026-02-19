const express = require('express');
const router = express.Router();
const botController = require('../controllers/botController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

router.use(protect);
router.post('/toggle', authorizeAdmin, botController.toggleBotStatus);
router.post('/request-reset', authorizeAdmin, botController.requestResetOtp);
router.post('/reset-session', authorizeAdmin, botController.resetSession);
router.post('/test-message', botController.testMessage);
router.get('/groups', botController.getGroups);
router.get('/qr', botController.getQRStatus);

module.exports = router;