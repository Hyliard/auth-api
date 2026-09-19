const { AppError } = require('../utils/errors');
const { validateUuid } = require('../utils/validators');
const {
  validatePaymentCreate, validatePaymentPatch, validatePaymentFilters,
} = require('../utils/payment.validators');
const { serializePayment } = require('../utils/payment.serializers');
const store = require('../store/db.store');

async function createPayment(req, res, next) {
  try {
    const data = validatePaymentCreate(req.body);
    const payment = await store.createPayment({ userId: req.auth.userId, ...data });
    res.status(201).json({ payment: serializePayment(payment) });
  } catch (err) {
    next(err);
  }
}

async function listPayments(req, res, next) {
  try {
    const filters = validatePaymentFilters(req.query);
    if (filters.invoiceId && !(await store.findInvoiceById(req.auth.userId, filters.invoiceId))) {
      throw new AppError('Invoice no encontrada', 404);
    }
    if (filters.clientId && !(await store.findClientById(req.auth.userId, filters.clientId))) {
      throw new AppError('Cliente no encontrado', 404);
    }
    const payments = await store.getPaymentsByUser(req.auth.userId, filters);
    res.status(200).json({ payments: payments.map(serializePayment) });
  } catch (err) {
    next(err);
  }
}

async function getPayment(req, res, next) {
  try {
    const paymentId = validateUuid(req.params.paymentId, 'paymentId');
    const payment = await store.findPaymentById(req.auth.userId, paymentId);
    if (!payment) throw new AppError('Payment no encontrado', 404);
    res.status(200).json({ payment: serializePayment(payment) });
  } catch (err) {
    next(err);
  }
}

async function updatePayment(req, res, next) {
  try {
    const paymentId = validateUuid(req.params.paymentId, 'paymentId');
    const data = validatePaymentPatch(req.body);
    const payment = await store.updatePayment(req.auth.userId, paymentId, data);
    res.status(200).json({ payment: serializePayment(payment) });
  } catch (err) {
    next(err);
  }
}

async function archivePayment(req, res, next) {
  try {
    const paymentId = validateUuid(req.params.paymentId, 'paymentId');
    const payment = await store.archivePayment(req.auth.userId, paymentId);
    res.status(200).json({ payment: serializePayment(payment) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment, listPayments, getPayment, updatePayment, archivePayment };
