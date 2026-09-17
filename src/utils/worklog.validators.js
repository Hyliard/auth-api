const { Prisma } = require('@prisma/client');
const { AppError } = require('./errors');
const { validateBody, validateUuid } = require('./validators');

const CREATE_FIELDS = new Set(['contractId', 'workDate', 'hours', 'isOvertime', 'note']);
const EDITABLE_FIELDS = new Set([...CREATE_FIELDS, 'active']);
const QUERY_FIELDS = new Set(['includeInactive', 'contractId', 'from', 'to', 'isOvertime']);
const DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateAllowedFields(value, allowedFields, message) {
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new AppError(message, 400);
  }
}

function validateDate(value, field) {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw new AppError(`El campo ${field} debe tener formato YYYY-MM-DD`, 400);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`El campo ${field} debe ser una fecha valida en formato YYYY-MM-DD`, 400);
  }
  return date;
}

function validateHours(value) {
  let normalized;
  if (typeof value === 'string') normalized = value.trim();
  else if (typeof value === 'number' && Number.isFinite(value)) normalized = String(value);
  else throw new AppError('El campo hours debe ser un decimal valido', 400);

  const match = DECIMAL_REGEX.exec(normalized);
  const digits = normalized.replace('.', '');
  if (!match || digits.length > 65 || (match[1]?.length || 0) > 30) {
    throw new AppError('El campo hours debe ser un decimal valido', 400);
  }
  const hours = new Prisma.Decimal(normalized);
  if (hours.lte(0)) throw new AppError('El campo hours debe ser mayor que 0', 400);
  return hours;
}

function validateBoolean(value, field) {
  if (typeof value !== 'boolean') throw new AppError(`El campo ${field} debe ser booleano`, 400);
  return value;
}

function validateQueryBoolean(value, field, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError(`El parametro ${field} debe ser true o false`, 400);
}

function validateNote(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError('El campo note debe ser texto o null', 400);
  const note = value.trim();
  if (!note) return null;
  if (note.length > 2000) throw new AppError('El campo note no puede superar 2000 caracteres', 400);
  return note;
}

function normalizeFields(body) {
  const data = {};
  if (Object.prototype.hasOwnProperty.call(body, 'contractId')) data.contractId = validateUuid(body.contractId, 'contractId');
  if (Object.prototype.hasOwnProperty.call(body, 'workDate')) data.workDate = validateDate(body.workDate, 'workDate');
  if (Object.prototype.hasOwnProperty.call(body, 'hours')) data.hours = validateHours(body.hours);
  if (Object.prototype.hasOwnProperty.call(body, 'isOvertime')) data.isOvertime = validateBoolean(body.isOvertime, 'isOvertime');
  if (Object.prototype.hasOwnProperty.call(body, 'note')) data.note = validateNote(body.note);
  if (Object.prototype.hasOwnProperty.call(body, 'active')) data.active = validateBoolean(body.active, 'active');
  return data;
}

function validateWorkLogCreate(value) {
  const body = validateBody(value);
  validateAllowedFields(body, CREATE_FIELDS, 'El cuerpo contiene campos no permitidos');
  for (const field of ['contractId', 'workDate', 'hours']) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) throw new AppError(`El campo ${field} es obligatorio`, 400);
  }
  return normalizeFields(body);
}

function validateWorkLogPatch(value) {
  const body = validateBody(value);
  if (Object.keys(body).length === 0) throw new AppError('Debe indicar al menos un campo para actualizar', 400);
  validateAllowedFields(body, EDITABLE_FIELDS, 'El cuerpo contiene campos no permitidos');
  return normalizeFields(body);
}

function validateWorkLogFilters(query) {
  validateAllowedFields(query, QUERY_FIELDS, 'La consulta contiene parametros no permitidos');
  const filters = {
    includeInactive: validateQueryBoolean(query.includeInactive, 'includeInactive', false),
  };
  if (query.contractId !== undefined) filters.contractId = validateUuid(query.contractId, 'contractId');
  if (query.from !== undefined) filters.from = validateDate(query.from, 'from');
  if (query.to !== undefined) filters.to = validateDate(query.to, 'to');
  if (filters.from && filters.to && filters.to < filters.from) {
    throw new AppError('El parametro to no puede ser anterior a from', 400);
  }
  if (query.isOvertime !== undefined) filters.isOvertime = validateQueryBoolean(query.isOvertime, 'isOvertime');
  return filters;
}

module.exports = { validateWorkLogCreate, validateWorkLogPatch, validateWorkLogFilters };
