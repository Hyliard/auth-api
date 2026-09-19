const { AppError } = require('./errors');
const { validateBody, validateUuid } = require('./validators');
const {
  validateAllowedFields, validateDecimal, validateCurrency, validateDate,
  validateOptionalText, validateBoolean, validateQueryBoolean, validateDateRange,
} = require('./financial.validators');

const CREATE_FIELDS = new Set(['invoiceId', 'amount', 'currency', 'paidAt', 'method', 'note']);
const PATCH_FIELDS = new Set(['amount', 'paidAt', 'method', 'note', 'active']);
const QUERY_FIELDS = new Set(['includeInactive', 'invoiceId', 'clientId', 'from', 'to']);

function normalize(body) {
  const data = {};
  if ('invoiceId' in body) data.invoiceId = validateUuid(body.invoiceId, 'invoiceId');
  if ('amount' in body) data.amount = validateDecimal(body.amount, 'amount');
  if ('currency' in body) data.currency = validateCurrency(body.currency);
  if ('paidAt' in body) data.paidAt = validateDate(body.paidAt, 'paidAt');
  if ('method' in body) data.method = validateOptionalText(body.method, 'method', 200);
  if ('note' in body) data.note = validateOptionalText(body.note, 'note', 2000);
  if ('active' in body) data.active = validateBoolean(body.active, 'active');
  return data;
}

function validatePaymentCreate(value) {
  const body = validateBody(value);
  validateAllowedFields(body, CREATE_FIELDS);
  for (const field of ['invoiceId', 'amount', 'currency', 'paidAt']) if (!(field in body)) throw new AppError(`El campo ${field} es obligatorio`, 400);
  return normalize(body);
}

function validatePaymentPatch(value) {
  const body = validateBody(value);
  if (!Object.keys(body).length) throw new AppError('Debe indicar al menos un campo para actualizar', 400);
  validateAllowedFields(body, PATCH_FIELDS);
  return normalize(body);
}

function validatePaymentFilters(query) {
  validateAllowedFields(query, QUERY_FIELDS, 'La consulta contiene parametros no permitidos');
  const data = { includeInactive: validateQueryBoolean(query.includeInactive, 'includeInactive', false) };
  if (query.invoiceId !== undefined) data.invoiceId = validateUuid(query.invoiceId, 'invoiceId');
  if (query.clientId !== undefined) data.clientId = validateUuid(query.clientId, 'clientId');
  if (query.from !== undefined) data.from = validateDate(query.from, 'from');
  if (query.to !== undefined) data.to = validateDate(query.to, 'to');
  validateDateRange(data.from, data.to);
  return data;
}

module.exports = { validatePaymentCreate, validatePaymentPatch, validatePaymentFilters };
