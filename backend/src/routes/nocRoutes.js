const express = require('express');
const router = express.Router();
const nocController = require('../controllers/nocController');
const { protect, authorizeNoc, authorizeSuperAdmin, authorizeAdmin } = require('../middleware/authMiddleware');

// Semua route NOC harus diproteksi
router.use(protect);

// Route untuk fungsionalitas NOC (Bisa diakses NOC, Admin, Super Admin)
router.get('/my-workspaces', authorizeNoc, nocController.getMyWorkspaces);
router.post('/map', authorizeNoc, nocController.getAggregatedMapData);
router.post('/secrets', authorizeNoc, nocController.getAggregatedSecrets);

// Route untuk Management Izin NOC (Hanya Admin/Super Admin)
router.get('/permissions', authorizeAdmin, nocController.getNocUsers);
router.post('/permissions/grant', authorizeAdmin, nocController.grantNocAccess);
router.post('/permissions/revoke', authorizeAdmin, nocController.revokeNocAccess);

module.exports = router;
