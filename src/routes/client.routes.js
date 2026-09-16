const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const clientController = require('../controllers/client.controller');

const router = express.Router();

router.use(authenticate);
router.post('/', clientController.createClient);
router.get('/', clientController.listClients);
router.get('/:clientId', clientController.getClient);
router.patch('/:clientId', clientController.updateClient);
router.delete('/:clientId', clientController.archiveClient);

module.exports = router;