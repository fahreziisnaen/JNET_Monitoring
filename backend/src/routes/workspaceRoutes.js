const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/set-active-device', workspaceController.setActiveDevice);
router.get('/me', workspaceController.getWorkspace);
router.get('/interfaces', workspaceController.getAvailableInterfaces);
router.get('/interfaces-by-device', workspaceController.getInterfacesByDevice);
router.put('/set-main-interface', workspaceController.setMainInterface);
router.put('/whatsapp-group-id', workspaceController.updateWhatsAppGroupId);

module.exports = router;