const express = require('express');
const router = express.Router();
const ipPoolController = require('../controllers/ipPoolController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
    .get(ipPoolController.getPools)
    .post(authorizeAdmin, ipPoolController.addPool);

router.route('/sync')
    .post(authorizeAdmin, ipPoolController.syncPoolsFromMikrotik);

router.route('/:id')
    .delete(authorizeAdmin, ipPoolController.deletePool);

module.exports = router;