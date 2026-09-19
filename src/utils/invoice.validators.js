const { AppError } = require('./errors');
const { validateBody, validateUuid } = require('./validators');
const {
  validateAllowedFields, validateDecimal, validateCurrency, validateDate,
  validateOptionalText, validateBoolean, validateQueryBoolean, validateDateRange,
  validateUuidArray,
} = require('./financial.validators');

const STATUSES = new Set(['DRAFT', 'PENDING', 'PAID', 'CANCELLED']);
const CREATE_FIELDS = new Set(['clientId', 'contractId', 'number', 'periodFrom', 'periodTo', 'currency', 'subtotal', 'status', 'issuedAt', 'dueDate', 'note', 'workLogIds']);
const PATCH_FIELDS = new Set(['number', 'periodFrom', 'periodTo', 'currency', 'subtotal', 'status', 'issuedAt', 'dueDate', 'note', 'active', 'workLogIds']);
const QUERY_FIELDS = new Set(['includeInactive', 'clientId', 'contractId', 'status', 'from', 'to', 'overdue']);

function validateStatus(value) {
  if (typeof value !== 'string' || !STATUSES.has(value)) throw new AppError('El campo status no es valido', 400);
  return value;
}

function normalize(body) {
  const data = {};
  if ('clientId' in body) data.clientId = validateUuid(body.clientId, 'clientId');
  if ('contractId' in body) data.contractId = body.contractId === null ? null : validateUuid(body.contractId, 'contractId');
  if ('number' in body) data.number = validateOptionalText(body.number, 'number', 100);
  for (const field of ['periodFrom', 'periodTo', 'issuedAt', 'dueDate']) {
    if (field in body) data[field] = validateDate(body[field], field, { nullable: true });
  }
  if ('currency' in body) data.currency = validateCurrency(body.currency);
  if ('subtotal' in body) data.subtotal = validateDecimal(body.subtotal, 'subtotal');
  if ('status' in body) data.status = validateStatus(body.status);
  if ('note' in body) data.note = validateOptionalText(body.note, 'note', 2000);
  if ('active' in body) data.active = validateBoolean(body.active, 'active');
  if ('workLogIds' in body) data.workLogIds = validateUuidArray(body.workLogIds, 'workLogIds');
  return data;
}

function validateRanges(data) {
  validateDateRange(data.periodFrom, data.periodTo, 'periodFrom', 'periodTo');
  validateDateRange(data.issuedAt, data.dueDate, 'issuedAt', 'dueDate');
}

function validateInvoiceCreate(value) {
  const body = validateBody(value);
  validateAllowedFields(body, CREATE_FIELDS);
  for (const field of ['clientId', 'currency', 'subtotal']) if (!(field in body)) throw new AppError(`El campo ${field} es obligatorio`, 400);
  const data = normalize(body);
  if (data.status === 'PAID') throw new AppError('Una invoice nueva no puede comenzar como PAID sin payments', 409);
  validateRanges(data);
  return data;
}

function validateInvoicePatch(value) {
  const body = validateBody(value);
  if (!Object.keys(body).length) throw new AppError('Debe indicar al menos un campo para actualizar', 400);
  validateAllowedFields(body, PATCH_FIELDS);
  const data = normalize(body);
  return data;
}

function validateInvoiceFilters(query) {
  validateAllowedFields(query, QUERY_FIELDS, 'La consulta contiene parametros no permitidos');
  const data = { includeInactive: validateQueryBoolean(query.includeInactive, 'includeInactive', false) };
  if (query.clientId !== undefined) data.clientId = validateUuid(query.clientId, 'clientId');
  if (query.contractId !== undefined) data.contractId = validateUuid(query.contractId, 'contractId');
  if (query.status !== undefined) data.status = validateStatus(query.status);
  if (query.from !== undefined) data.from = validateDate(query.from, 'from');
  if (query.to !== undefined) data.to = validateDate(query.to, 'to');
  if (query.overdue !== undefined) data.overdue = validateQueryBoolean(query.overdue, 'overdue');
  validateDateRange(data.from, data.to);
  return data;
}

module.exports = { validateInvoiceCreate, validateInvoicePatch, validateInvoiceFilters, validateRanges };
