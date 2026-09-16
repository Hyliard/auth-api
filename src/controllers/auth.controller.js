const bcrypt = require('bcryptjs');
const { AppError } = require('../utils/errors');
const { validateBody, validateString, validateEmail, validatePassword } = require('../utils/validators');
const { signToken } = require('../utils/jwt');
const store = require('../store/db.store');

const SALT_ROUNDS = 10;

async function register(req, res, next) {
  try {
    const { name, email, password } = validateBody(req.body);
    const normalizedName = validateString(name, 'name');
    const normalizedEmail = validateEmail(email);
    validatePassword(password);

    if (await store.findUserByEmail(normalizedEmail)) {
      throw new AppError('Ya existe un usuario registrado con ese email', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await store.createUser({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
    });

    res.status(201).json({ user: store.toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password, deviceName } = validateBody(req.body);
    const normalizedEmail = validateEmail(email);
    validatePassword(password);
    const normalizedDeviceName = deviceName === undefined
      ? 'Dispositivo sin nombre' : validateString(deviceName, 'deviceName');
    const user = await store.findUserByEmail(normalizedEmail);

    if (!user) {
      throw new AppError('Credenciales invalidas', 401);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError('Credenciales invalidas', 401);
    }

    const now = new Date();
    const { device, session } = await store.createLoginSession({
      userId: user.id,
      expectedPasswordHash: user.passwordHash,
      deviceName: normalizedDeviceName,
      lastLoginAt: now,
    });

    const token = signToken({ userId: user.id, sessionId: session.sessionId, deviceId: device.deviceId });

    res.status(200).json({
      token,
      deviceId: device.deviceId,
      user: store.toPublicUser(user),
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await store.findUserById(req.auth.userId);
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
    const { currentPassword, newPassword } = validateBody(req.body);
    validatePassword(currentPassword, 'currentPassword');
    validatePassword(newPassword, 'newPassword');

    const user = await store.findUserById(req.auth.userId);
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

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await store.changePasswordAndRevokeSessions(user.id, user.passwordHash, passwordHash);

    res.status(200).json({
      message: 'Contrasena actualizada correctamente. Todas las sesiones fueron cerradas, inicia sesion nuevamente.',
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const session = await store.findSessionById(req.auth.sessionId);
    if (session) {
      await store.revokeSession(session.sessionId);
    }
    res.status(200).json({ message: 'Sesion cerrada correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, changePassword, logout };
