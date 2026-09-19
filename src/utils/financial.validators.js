const { Prisma } = require('@prisma/client');
const { AppError } = require('./errors');
const { validateUuid } = require('./validators');

const DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateAllowedFields(value, allowed, message = 'El cuerpo contiene campos no permitidos') {
  if (Object.keys(value).some((field) => !allowed.has(field))) throw new AppError(message, 400);
}

function validateDecimal(value, field) {
  const normalized = typeof value === 'string' ? value.trim()
    : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  const match = normalized && DECIMAL_REGEX.exec(normalized);
  const digits = normalized?.replace('.', '') || '';
  if (!match || digits.length > 65 || (match[1]?.length || 0) > 30) {
    throw new AppError(`El campo ${field} debe ser un decimal valido`, 400);
  }
  const decimal = new Prisma.Decimal(normalized);
  if (decimal.lte(0)) throw new AppError(`El campo ${field} debe ser mayor que 0`, 400);
  return decimal;
}

function validateCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new AppError('El campo currency debe contener exactamente 3 letras', 400);
  }
  return value.trim().toUpperCase();
}

function validateDate(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw new AppError(`El campo ${field} debe tener formato YYYY-MM-DD`, 400);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`El campo ${field} debe ser una fecha valida en formato YYYY-MM-DD`, 400);
  }
  return date;
}

function validateOptionalText(value, field, maxLength) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError(`El campo ${field} debe ser texto o null`, 400);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new AppError(`El campo ${field} no puede superar ${maxLength} caracteres`, 400);
  return normalized;
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

function validateDateRange(from, to, fromField = 'from', toField = 'to') {
  if (from && to && to < from) throw new AppError(`El campo ${toField} no puede ser anterior a ${fromField}`, 400);
}

function validateUuidArray(value, field) {
  if (!Array.isArray(value) || value.length > 500) throw new AppError(`El campo ${field} debe ser un array de hasta 500 UUIDs`, 400);
  const ids = value.map((id) => validateUuid(id, field));
  if (new Set(ids).size !== ids.length) throw new AppError(`El campo ${field} contiene UUIDs duplicados`, 400);
  return ids;
}

module.exports = {
  validateAllowedFields, validateDecimal, validateCurrency, validateDate,
  validateOptionalText, validateBoolean, validateQueryBoolean, validateDateRange,
  validateUuidArray,
};
