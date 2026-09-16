const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const contractController = require('../controllers/contract.controller');

const router = express.Router();

router.use(authenticate);
router.post('/', contractController.createContract);
router.get('/', contractController.listContracts);
router.get('/:contractId', contractController.getContract);
router.patch('/:contractId', contractController.updateContract);
router.delete('/:contractId', contractController.archiveContract);

module.exports = router;
