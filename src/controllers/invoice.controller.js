const { AppError } = require('../utils/errors');
const {
  validateInvoiceCreate, validateInvoicePatch, validateInvoiceFilters, validateRanges,
} = require('../utils/invoice.validators');
const { serializeInvoice } = require('../utils/invoice.serializers');
const store = require('../store/db.store');

async function requireClient(userId, clientId, requireActive = false) {
  const client = await store.findClientById(userId, clientId);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  if (requireActive && !client.active) throw new AppError('No se puede usar un cliente archivado', 409);
  return client;
}

async function requireContract(userId, contractId, requireActive = false) {
  const contract = await store.findContractById(userId, contractId);
  if (!contract) throw new AppError('Contrato no encontrado', 404);
  if (requireActive && !contract.active) throw new AppError('No se puede usar un contrato archivado', 409);
  return contract;
}

async function validateWorkLogs(userId, workLogIds, { clientId, contractId, currency, invoiceId }) {
  if (workLogIds === undefined) return;
  const workLogs = await store.findInvoiceWorkLogs(userId, workLogIds);
  if (workLogs.length !== workLogIds.length) throw new AppError('WorkLog no encontrado', 404);
  for (const workLog of workLogs) {
    if (!workLog.active) throw new AppError('No se puede facturar un WorkLog archivado', 409);
    if (!workLog.contract.active) throw new AppError('No se puede facturar un WorkLog de un contrato archivado', 409);
    if (workLog.contract.clientId !== clientId || (contractId && workLog.contractId !== contractId)) {
      throw new AppError('Los WorkLogs no son coherentes con el cliente o contrato de la invoice', 409);
    }
    if (workLog.contract.currency !== currency) throw new AppError('La moneda del WorkLog no coincide con la invoice', 409);
    if (workLog.invoiceLink && workLog.invoiceLink.invoiceId !== invoiceId) {
      throw new AppError('Uno o mas WorkLogs ya fueron facturados', 409);
    }
  }
}

async function createInvoice(req, res, next) {
  try {
    const data = validateInvoiceCreate(req.body);
    await requireClient(req.auth.userId, data.clientId, true);
    if (data.contractId) {
      const contract = await requireContract(req.auth.userId, data.contractId, true);
      if (contract.clientId !== data.clientId) throw new AppError('El contrato no pertenece al cliente indicado', 409);
      if (contract.currency !== data.currency) throw new AppError('La moneda del contrato no coincide con la invoice', 409);
    }
    await validateWorkLogs(req.auth.userId, data.workLogIds || [], data);
    const invoice = await store.createInvoice({ userId: req.auth.userId, ...data });
    res.status(201).json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
}

async function listInvoices(req, res, next) {
  try {
    const filters = validateInvoiceFilters(req.query);
    if (filters.clientId) await requireClient(req.auth.userId, filters.clientId);
    if (filters.contractId) await requireContract(req.auth.userId, filters.contractId);
    const invoices = (await store.getInvoicesByUser(req.auth.userId, filters)).map(serializeInvoice);
    const filtered = filters.overdue === undefined
      ? invoices : invoices.filter((invoice) => (invoice.effectiveStatus === 'OVERDUE') === filters.overdue);
    res.status(200).json({ invoices: filtered });
  } catch (err) {
    next(err);
  }
}

async function getInvoice(req, res, next) {
  try {
    const { validateUuid } = require('../utils/validators');
    const invoiceId = validateUuid(req.params.invoiceId, 'invoiceId');
    const invoice = await store.findInvoiceById(req.auth.userId, invoiceId);
    if (!invoice) throw new AppError('Invoice no encontrada', 404);
    res.status(200).json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
}

async function updateInvoice(req, res, next) {
  try {
    const { validateUuid } = require('../utils/validators');
    const invoiceId = validateUuid(req.params.invoiceId, 'invoiceId');
    const current = await store.findInvoiceById(req.auth.userId, invoiceId);
    if (!current) throw new AppError('Invoice no encontrada', 404);
    const data = validateInvoicePatch(req.body);
    validateRanges({
      periodFrom: Object.prototype.hasOwnProperty.call(data, 'periodFrom') ? data.periodFrom : current.periodFrom,
      periodTo: Object.prototype.hasOwnProperty.call(data, 'periodTo') ? data.periodTo : current.periodTo,
      issuedAt: Object.prototype.hasOwnProperty.call(data, 'issuedAt') ? data.issuedAt : current.issuedAt,
      dueDate: Object.prototype.hasOwnProperty.call(data, 'dueDate') ? data.dueDate : current.dueDate,
    });
    const finalCurrency = data.currency || current.currency;
    const workLogIdsToValidate = data.workLogIds !== undefined
      ? data.workLogIds
      : (data.currency && data.currency !== current.currency
        ? current.workLogs.map((link) => link.workLog.id) : undefined);
    await validateWorkLogs(req.auth.userId, workLogIdsToValidate, {
      clientId: current.clientId,
      contractId: current.contractId,
      currency: finalCurrency,
      invoiceId,
    });
    const invoice = await store.updateInvoice(req.auth.userId, invoiceId, data);
    res.status(200).json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
}

async function archiveInvoice(req, res, next) {
  try {
    const { validateUuid } = require('../utils/validators');
    const invoiceId = validateUuid(req.params.invoiceId, 'invoiceId');
    const invoice = await store.archiveInvoice(req.auth.userId, invoiceId);
    res.status(200).json({ invoice: serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createInvoice, listInvoices, getInvoice, updateInvoice, archiveInvoice };
