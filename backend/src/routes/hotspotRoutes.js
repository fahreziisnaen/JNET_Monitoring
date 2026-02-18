const express = require('express');
const router = express.Router();
const hotspotController = require('../controllers/hotspotController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/summary', hotspotController.getHotspotSummary);
router.get('/profiles', hotspotController.getHotspotProfiles);
router.post('/vouchers/generate', authorizeAdmin, hotspotController.generateVouchers);
router.route('/users')
    .get(hotspotController.getHotspotUsers)
    .post(authorizeAdmin, hotspotController.addHotspotUser);
router.route('/users/:id')
    .delete(authorizeAdmin, hotspotController.deleteHotspotUser);

router.put('/users/:id/status', authorizeAdmin, hotspotController.setHotspotUserStatus);
router.post('/active/:id/kick', authorizeAdmin, hotspotController.kickHotspotUser);

module.exports = router;