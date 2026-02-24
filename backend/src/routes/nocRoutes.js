const express = require('express');
const router = express.Router();
const nocController = require('../controllers/nocController');
const { protect, authorizeSuperAdmin } = require('../middleware/authMiddleware');

// Semua route NOC harus diproteksi dan hanya untuk super admin
router.use(protect);
router.use(authorizeSuperAdmin);

router.post('/map', nocController.getAggregatedMapData);
router.post('/secrets', nocController.getAggregatedSecrets);

module.exports = router;
