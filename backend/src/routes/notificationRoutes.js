const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/pppoe-disconnect', notificationController.sendPppoeDisconnectNotification);
router.post('/pppoe-reconnect', notificationController.sendPppoeReconnectNotification);

module.exports = router;

