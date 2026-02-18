const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
    .get(deviceController.listDevices)
    .post(authorizeAdmin, deviceController.addDevice);

router.route('/:id')
    .put(authorizeAdmin, deviceController.updateDevice)
    .delete(authorizeAdmin, deviceController.deleteDevice);

module.exports = router;