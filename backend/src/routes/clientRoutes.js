const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { protect } = require('../middleware/authMiddleware');
const uploadClient = require('../middleware/uploadClient');

router.use(protect);

router.get('/unlinked-pppoe-secrets', clientController.getUnlinkedPppoeSecrets);
router.get('/', clientController.getClients);
router.post('/', uploadClient.single('photo'), clientController.createClient);
router.get('/:id', clientController.getClient);
router.put('/:id', uploadClient.single('photo'), clientController.updateClient);
router.patch('/:id', uploadClient.single('photo'), clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

module.exports = router;

