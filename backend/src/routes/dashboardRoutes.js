const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

// Get dashboard snapshot
router.get('/snapshot', protect, dashboardController.getSnapshot);

module.exports = router;

