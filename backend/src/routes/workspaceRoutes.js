const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { protect, authorizeAdmin, authorizeSuperAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/set-active-device', authorizeAdmin, workspaceController.setActiveDevice);
router.get('/me', workspaceController.getWorkspace);
router.get('/interfaces', workspaceController.getAvailableInterfaces);
router.get('/interfaces-by-device', workspaceController.getInterfacesByDevice);
router.put('/whatsapp-group-id', authorizeAdmin, workspaceController.updateWhatsAppGroupId);
router.get('/members', workspaceController.getMembers);
router.delete('/members/:userId', authorizeAdmin, workspaceController.removeMember);

// Administrative Routes (Super Admin Only)
router.get('/all', authorizeSuperAdmin, workspaceController.getAllWorkspaces);
router.put('/:workspaceId/whatsapp-group-id', authorizeSuperAdmin, workspaceController.adminUpdateWhatsAppGroupId);

module.exports = router;