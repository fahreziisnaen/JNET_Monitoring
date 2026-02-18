const express = require('express');
const router = express.Router();
const multer = require('multer');
const backupController = require('../controllers/backupController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

router.get('/export', protect, authorizeAdmin, backupController.exportBackup);
router.post('/restore', protect, authorizeAdmin, upload.single('backupFile'), backupController.restoreBackup);
router.post('/factory-reset', protect, authorizeAdmin, backupController.factoryReset);

module.exports = router;
