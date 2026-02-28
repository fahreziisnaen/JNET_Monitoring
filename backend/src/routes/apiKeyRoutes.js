const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKeyController');
const { protect, authorizeSuperAdmin } = require('../middleware/authMiddleware');

router.use(protect); // Ensure all routes are protected
router.use(authorizeSuperAdmin); // Enforce Super Admin role for API Key management

router.get('/', apiKeyController.getAllApiKeys);
router.post('/', apiKeyController.createApiKey);
router.delete('/:id', apiKeyController.deleteApiKey);

module.exports = router;
