const { verifyToken } = require('../utils/jwt');
const { AppError } = require('../utils/errors');
const store = require('../store/db.store');
const { isValidUuid } = require('../utils/validators');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const match = typeof authHeader === 'string' && /^Bearer ([^\s]+)$/i.exec(authHeader);
    if (!match) {
      throw new AppError('Token de autenticacion no proporcionado', 401);
    }

    const token = match[1];
    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      throw new AppError('Token invalido o expirado', 401);
    }

    const { userId, sessionId, deviceId } = payload || {};
    if (![userId, sessionId, deviceId].every(isValidUuid)) {
      throw new AppError('Token invalido o expirado', 401);
    }

    const session = await store.findSessionById(sessionId);
    if (!session || session.revoked || session.userId !== userId || session.deviceId !== deviceId) {
      throw new AppError('La sesion ya no es valida', 401);
    }

    const device = await store.findDeviceById(deviceId);
    if (!device || !device.active || device.userId !== userId) {
      throw new AppError('El dispositivo ya no esta vinculado', 401);
    }

    const user = await store.findUserById(userId);
    if (!user) {
      throw new AppError('El usuario ya no existe', 401);
    }

    req.auth = { userId, sessionId, deviceId };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
