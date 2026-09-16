const { Prisma } = require('@prisma/client');
const { AppError } = require('./errors');
const { validateBody, validateString, validateUuid } = require('./validators');

const CREATE_FIELDS = new Set([
  'clientId', 'name', 'hourlyRate', 'currency', 'overtimeRate', 'startDate', 'endDate',
]);
const EDITABLE_FIELDS = new Set([...CREATE_FIELDS, 'active']);
const DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateAllowedFields(body, allowedFields) {
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new AppError('El cuerpo contiene campos no permitidos', 400);
  }
}

function validateDecimal(value, field, { optional = false, allowZero = false } = {}) {
  if (value === null && optional) return null;

  let normalized;
  if (typeof value === 'string') {
    normalized = value.trim();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    normalized = String(value);
  } else {
    throw new AppError(`El campo ${field} debe ser un decimal valido`, 400);
  }

  const match = DECIMAL_REGEX.exec(normalized);
  const digits = normalized.replace('.', '');
  if (!match || digits.length > 65 || (match[1]?.length || 0) > 30) {
    throw new AppError(`El campo ${field} debe ser un decimal valido`, 400);
  }

  const decimal = new Prisma.Decimal(normalized);
  if (allowZero ? decimal.lt(0) : decimal.lte(0)) {
    throw new AppError(`El campo ${field} debe ser ${allowZero ? 'mayor o igual a 0' : 'mayor que 0'}`, 400);
  }
  return decimal;
}

function validateCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new AppError('El campo currency debe contener exactamente 3 letras', 400);
  }
  return value.trim().toUpperCase();
}

function validateDate(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw new AppError(`El campo ${field} debe tener formato YYYY-MM-DD`, 400);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`El campo ${field} debe ser una fecha valida en formato YYYY-MM-DD`, 400);
  }
  return date;
}

function validateDateRange(startDate, endDate) {
  if (startDate && endDate && endDate < startDate) {
    throw new AppError('El campo endDate no puede ser anterior a startDate', 400);
  }
}

function normalizeFields(body) {
  const data = {};
  if (Object.prototype.hasOwnProperty.call(body, 'clientId')) {
    data.clientId = validateUuid(body.clientId, 'clientId');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    data.name = validateString(body.name, 'name');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'hourlyRate')) {
    data.hourlyRate = validateDecimal(body.hourlyRate, 'hourlyRate');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'currency')) {
    data.currency = validateCurrency(body.currency);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'overtimeRate')) {
    data.overtimeRate = validateDecimal(body.overtimeRate, 'overtimeRate', { optional: true, allowZero: true });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'startDate')) {
    data.startDate = validateDate(body.startDate, 'startDate');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'endDate')) {
    data.endDate = validateDate(body.endDate, 'endDate');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active !== 'boolean') {
      throw new AppError('El campo active debe ser booleano', 400);
    }
    data.active = body.active;
  }
  return data;
}

function validateContractCreate(value) {
  const body = validateBody(value);
  validateAllowedFields(body, CREATE_FIELDS);
  for (const field of ['clientId', 'name', 'hourlyRate', 'currency']) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      throw new AppError(`El campo ${field} es obligatorio`, 400);
    }
  }
  const data = normalizeFields(body);
  validateDateRange(data.startDate, data.endDate);
  return data;
}

function validateContractPatch(value) {
  const body = validateBody(value);
  if (Object.keys(body).length === 0) {
    throw new AppError('Debe indicar al menos un campo para actualizar', 400);
  }
  validateAllowedFields(body, EDITABLE_FIELDS);
  return normalizeFields(body);
}

function validateIncludeInactive(value) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new AppError('El parametro includeInactive debe ser true o false', 400);
}

module.exports = {
  validateContractCreate,
  validateContractPatch,
  validateDateRange,
  validateIncludeInactive,
};
