const prisma = require('./prisma');

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function createUser({ name, email, passwordHash }) {
  return prisma.user.create({ data: { name, email, passwordHash } });
}

function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

function updateUserPassword(id, passwordHash) {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}

function createDevice({ userId, deviceName, lastLoginAt }) {
  return prisma.device.create({ data: { userId, deviceName, lastLoginAt } });
}

function createSession({ userId, deviceId }) {
  return prisma.session.create({ data: { userId, deviceId } });
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
  updateUserPassword,
  createDevice,
  createSession,
  findSessionById,
  findDeviceById,
  getDevicesByUser,
  revokeSession,
  revokeSessionsByUser,
  revokeSessionsByDevice,
  deleteDevice,
  deleteUser,
};
