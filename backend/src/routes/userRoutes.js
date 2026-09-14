const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const twoFactorController = require('../controllers/twoFactorController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/2fa', twoFactorController.getStatus);
router.post('/2fa/setup', twoFactorController.beginSetup);
router.post('/2fa/enable', twoFactorController.enable);
router.post('/2fa/disable', twoFactorController.disable);
router.post('/2fa/recovery-codes', twoFactorController.regenerateRecoveryCodes);

router.put('/details', userController.updateUserDetails);
router.put('/change-password', userController.changePassword);
router.post('/avatar', upload.single('avatar'), userController.updateAvatar);
router.delete('/', userController.deleteUserAccount);

module.exports = router;