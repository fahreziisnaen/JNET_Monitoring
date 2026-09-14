const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.post('/login/2fa', authController.verifyLoginTwoFactor);
router.post('/logout', protect, authController.logout);
router.post('/reset-password', authController.resetPassword);
router.get('/me', protect, authController.getMe);

module.exports = router;
