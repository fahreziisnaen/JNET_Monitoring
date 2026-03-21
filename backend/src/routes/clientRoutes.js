const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { protect, authorizeNoc } = require('../middleware/authMiddleware');
const uploadClient = require('../middleware/uploadClient');

router.use(protect);

router.get('/unlinked-pppoe-secrets', clientController.getUnlinkedPppoeSecrets);
router.get('/', clientController.getClients);
router.post('/', authorizeNoc, uploadClient.single('photo'), clientController.createClient);
router.delete('/bulk', authorizeNoc, clientController.bulkDeleteClients);
router.get('/orphan-check', clientController.orphanCheck);
router.get('/:id', clientController.getClient);
router.put('/:id', authorizeNoc, uploadClient.single('photo'), clientController.updateClient);
router.patch('/:id', authorizeNoc, uploadClient.single('photo'), clientController.updateClient);
router.delete('/:id', authorizeNoc, clientController.deleteClient);

module.exports = router;

