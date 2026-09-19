const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const controller = require('../controllers/payment.controller');

const router = express.Router();
router.use(authenticate);
router.post('/', controller.createPayment);
router.get('/', controller.listPayments);
router.get('/:paymentId', controller.getPayment);
router.patch('/:paymentId', controller.updatePayment);
router.delete('/:paymentId', controller.archivePayment);

module.exports = router;
