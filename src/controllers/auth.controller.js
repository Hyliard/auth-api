const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../utils/errors');
const { isValidEmail, isValidPassword } = require('../utils/validators');
const { signToken } = require('../utils/jwt');
const store = require('../store/memory.store');

const SALT_ROUNDS = 10;

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      throw new AppError('Los campos name, email y password son obligatorios', 400);
    }
    if (!isValidEmail(email)) {
      throw new AppError('El formato del email no es valido', 400);
    }
    if (!isValidPassword(password)) {
      throw new AppError('La contrasena debe tener un minimo de 8 caracteres', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (store.usersByEmail.has(normalizedEmail)) {
      throw new AppError('Ya existe un usuario registrado con ese email', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = uuidv4();
    const user = {
      id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    store.users.set(id, user);
    store.usersByEmail.set(normalizedEmail, id);

    res.status(201).json({ user: store.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password, deviceName } = req.body || {};

    if (!email || !password) {
      throw new AppError('Los campos email y password son obligatorios', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userId = store.usersByEmail.get(normalizedEmail);
    const user = userId ? store.users.get(userId) : null;

    if (!user) {
      throw new AppError('Credenciales invalidas', 401);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError('Credenciales invalidas', 401);
    }

    const deviceId = uuidv4();
    const now = new Date().toISOString();
    const device = {
      deviceId,
      userId: user.id,
      deviceName: typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim() : 'Dispositivo sin nombre',
      createdAt: now,
      lastLoginAt: now,
      active: true,
    };
    store.devices.set(deviceId, device);

    const sessionId = uuidv4();
    const session = {
      sessionId,
      userId: user.id,
      deviceId,
      createdAt: now,
      revoked: false,
    };
    store.sessions.set(sessionId, session);

    const token = signToken({ userId: user.id, sessionId, deviceId });

    res.status(200).json({
      token,
      deviceId,
      user: store.toPublicUser(user),
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = store.users.get(req.auth.userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404);
    }
    res.status(200).json({ user: store.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      throw new AppError('Los campos currentPassword y newPassword son obligatorios', 400);
    }
    if (!isValidPassword(newPassword)) {
      throw new AppError('La nueva contrasena debe tener un minimo de 8 caracteres', 400);
    }

    const user = store.users.get(req.auth.userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404);
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new AppError('La contrasena actual es incorrecta', 401);
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsOld) {
      throw new AppError('La nueva contrasena no puede ser igual a la contrasena actual', 409);
    }

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    store.revokeSessionsByUser(user.id);

    res.status(200).json({
      message: 'Contrasena actualizada correctamente. Todas las sesiones fueron cerradas, inicia sesion nuevamente.',
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const session = store.sessions.get(req.auth.sessionId);
    if (session) {
      session.revoked = true;
    }
    res.status(200).json({ message: 'Sesion cerrada correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, changePassword, logout };
