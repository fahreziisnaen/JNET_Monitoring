const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const { protect, authorizeAdmin, authorizeNoc } = require('../middleware/authMiddleware');
const uploadAsset = require('../middleware/uploadAsset');

router.use(protect);

router.get('/unconnected-pppoe-users', assetController.getUnconnectedPppoeUsers);
router.get('/workspace-users', assetController.getWorkspaceUsers);
router.get('/owners', assetController.getAssetOwners);
router.post('/owners', authorizeAdmin, assetController.addAssetOwner);

router.route('/')
    .get(assetController.getAssets)
    .post(authorizeAdmin, uploadAsset.single('photo'), assetController.addAsset)
    .delete(authorizeAdmin, assetController.deleteAllAssets);

router.delete('/bulk', authorizeAdmin, assetController.bulkDeleteAssets);

router.route('/:id/connections')
    .get(assetController.getAssetConnections)
    .post(authorizeAdmin, assetController.addAssetConnection);

router.route('/:id')
    .put(authorizeNoc, uploadAsset.single('photo'), assetController.updateAsset)
    .patch(authorizeNoc, uploadAsset.single('photo'), assetController.updateAsset)
    .delete(authorizeAdmin, assetController.deleteAsset);

module.exports = router;