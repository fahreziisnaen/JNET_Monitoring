const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('../controllers/importController');
const { protect } = require('../middleware/authMiddleware');
const upload = multer({ storage: multer.memoryStorage() });

router.post('/kml', protect, upload.single('kmlFile'), importController.importKml);
router.get('/kml', protect, importController.exportKml);

module.exports = router;