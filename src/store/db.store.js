const prisma = require('./prisma');
const { AppError } = require('../utils/errors');

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

async function createUser({ name, email, passwordHash }) {
  try {
    return await prisma.user.create({ data: { name, email, passwordHash } });
  } catch (err) {
    // This operation writes User only. Match the email constraint, not every P2002.
    if (err.code === 'P2002' && Array.isArray(err.meta?.target)
        && err.meta.target.length === 1 && err.meta.target[0] === 'email') {
      throw new AppError('Ya existe un usuario registrado con ese email', 409);
    }
    throw err;
  }
}

function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

async function lockCredentials(tx, userId, expectedPasswordHash) {
  // Parameterized SQL: credential writers and session creators share this row lock.
  // READ COMMITTED returns the current hash after a preceding writer commits.
  const users = await tx.$queryRaw`
    SELECT "passwordHash" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE
  `;
  if (users.length !== 1 || users[0].passwordHash !== expectedPasswordHash) {
    throw new AppError('Las credenciales cambiaron. Inicia sesion nuevamente.', 401);
  }
}

function createLoginSession({ userId, expectedPasswordHash, deviceName, lastLoginAt }) {
  return prisma.$transaction(async (tx) => {
    await lockCredentials(tx, userId, expectedPasswordHash);
    const device = await tx.device.create({ data: { userId, deviceName, lastLoginAt } });
    const session = await tx.session.create({ data: { userId, deviceId: device.deviceId } });
    return { device, session };
  }, { isolationLevel: 'ReadCommitted' });
}

function changePasswordAndRevokeSessions(userId, expectedPasswordHash, passwordHash) {
  return prisma.$transaction(async (tx) => {
    await lockCredentials(tx, userId, expectedPasswordHash);
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId }, data: { revoked: true } });
  }, { isolationLevel: 'ReadCommitted' });
}

function findSessionById(sessionId) {
  return prisma.session.findUnique({ where: { sessionId } });
}

function findDeviceById(deviceId) {
  return prisma.device.findUnique({ where: { deviceId } });
}

function getDevicesByUser(userId) {
  return prisma.device.findMany({ where: { userId } });
}

function revokeSession(sessionId) {
  return prisma.session.updateMany({ where: { sessionId }, data: { revoked: true } });
}

function revokeSessionsByUser(userId) {
  return prisma.session.updateMany({ where: { userId }, data: { revoked: true } });
}

function revokeSessionsByDevice(deviceId) {
  return prisma.session.updateMany({ where: { deviceId }, data: { revoked: true } });
}

function deleteDevice(deviceId) {
  return prisma.device.delete({ where: { deviceId } });
}

function deleteUser(id) {
  return prisma.user.delete({ where: { id } });
}

module.exports = {
  toPublicUser,
  createUser,
  findUserByEmail,
  findUserById,
  changePasswordAndRevokeSessions,
  createLoginSession,
  findSessionById,
  findDeviceById,
  getDevicesByUser,
  revokeSession,
  revokeSessionsByUser,
  revokeSessionsByDevice,
  deleteDevice,
  deleteUser,
};
