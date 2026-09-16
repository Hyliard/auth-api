const { AppError } = require('./errors');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidEmail(email) {
  return typeof email === 'string' && email.trim().length <= 254 && EMAIL_REGEX.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === 'string' && password.trim().length > 0
    && password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new AppError('El cuerpo JSON debe ser un objeto', 400);
  }
  return body;
}

function validateString(value, field, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AppError(`El campo ${field} debe ser texto no vacio de hasta ${maxLength} caracteres`, 400);
  }
  return value.trim();
}

function validatePassword(value, field = 'password') {
  if (!isValidPassword(value)) {
    throw new AppError(`El campo ${field} debe tener al menos 8 caracteres, no ser solo espacios y no superar 72 bytes UTF-8`, 400);
  }
  return value;
}

function validateEmail(value) {
  if (!isValidEmail(value)) {
    throw new AppError('El formato del email no es valido (maximo 254 caracteres)', 400);
  }
  return value.trim().toLowerCase();
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function validateUuid(value, field) {
  if (!isValidUuid(value)) throw new AppError(`El parametro ${field} debe ser un UUID valido`, 400);
  return value.toLowerCase();
}

module.exports = { isValidEmail, isValidPassword, validateBody, validateString, validatePassword, validateEmail, isValidUuid, validateUuid };
