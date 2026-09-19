const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const controller = require('../controllers/invoice.controller');

const router = express.Router();
router.use(authenticate);
router.post('/', controller.createInvoice);
router.get('/', controller.listInvoices);
router.get('/:invoiceId', controller.getInvoice);
router.patch('/:invoiceId', controller.updateInvoice);
router.delete('/:invoiceId', controller.archiveInvoice);

module.exports = router;
