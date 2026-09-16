const { AppError } = require('../utils/errors');
const { isValidEmail, validateBody, validateString, validateUuid } = require('../utils/validators');
const store = require('../store/db.store');

const editableFields = new Set(['name', 'email', 'company', 'active']);
const protectedFields = new Set(['id', 'userId', 'createdAt', 'updatedAt']);
const createFields = new Set(['name', 'email', 'company']);

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AppError('Los campos email y company deben ser texto', 400);
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length > 254) {
    throw new AppError('Los campos email y company no pueden superar 254 caracteres', 400);
  }
  return normalizedValue || null;
}

function validateName(value) {
  return validateString(value, 'name');
}

function validateEmail(value) {
  const normalizedEmail = normalizeOptionalString(value);
  if (normalizedEmail !== null && !isValidEmail(normalizedEmail)) {
    throw new AppError('El formato del email no es valido', 400);
  }

  return normalizedEmail;
}

function validateCompany(value) {
  return normalizeOptionalString(value);
}

function validatePatchFields(body) {
  const fields = Object.keys(body);
  if (fields.some((field) => protectedFields.has(field))) {
    throw new AppError('No se pueden modificar los campos protegidos del cliente', 400);
  }
  if (fields.some((field) => !editableFields.has(field))) {
    throw new AppError('El cuerpo contiene campos no permitidos', 400);
  }
  if (fields.length === 0) {
    throw new AppError('Debe indicar al menos un campo para actualizar', 400);
  }

  const data = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    data.name = validateName(body.name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    data.email = validateEmail(body.email);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'company')) {
    data.company = validateCompany(body.company);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active !== 'boolean') {
      throw new AppError('El campo active debe ser booleano', 400);
    }
    data.active = body.active;
  }

  return data;
}

function validateCreateFields(body) {
  if (Object.keys(body).some((field) => !createFields.has(field))) {
    throw new AppError('El cuerpo contiene campos no permitidos', 400);
  }
}

async function createClient(req, res, next) {
  try {
    const body = validateBody(req.body);
    validateCreateFields(body);
    const name = validateName(body.name);
    const email = validateEmail(body.email);
    const company = validateCompany(body.company);
    const client = await store.createClient({
      userId: req.auth.userId,
      name,
      email,
      company,
    });

    res.status(201).json({ client });
  } catch (err) {
    next(err);
  }
}

async function listClients(req, res, next) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const clients = await store.getClientsByUser(req.auth.userId, includeInactive);
    res.status(200).json({ clients });
  } catch (err) {
    next(err);
  }
}

async function getClient(req, res, next) {
  try {
    const clientId = validateUuid(req.params.clientId, 'clientId');
    const client = await store.findClientById(req.auth.userId, clientId);
    if (!client) {
      throw new AppError('Cliente no encontrado', 404);
    }

    res.status(200).json({ client });
  } catch (err) {
    next(err);
  }
}

async function updateClient(req, res, next) {
  try {
    const clientId = validateUuid(req.params.clientId, 'clientId');
    const data = validatePatchFields(validateBody(req.body));
    const client = await store.updateClient(req.auth.userId, clientId, data);
    if (!client) {
      throw new AppError('Cliente no encontrado', 404);
    }

    res.status(200).json({ client });
  } catch (err) {
    next(err);
  }
}

async function archiveClient(req, res, next) {
  try {
    const clientId = validateUuid(req.params.clientId, 'clientId');
    const client = await store.updateClient(req.auth.userId, clientId, { active: false });
    if (!client) {
      throw new AppError('Cliente no encontrado', 404);
    }

    res.status(200).json({ client });
  } catch (err) {
    next(err);
  }
}

module.exports = { createClient, listClients, getClient, updateClient, archiveClient };
