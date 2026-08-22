// Almacenamiento en memoria. Todos los datos se pierden cuando el proceso
// del servidor se reinicia, ya que no se utiliza ninguna base de datos.

const users = new Map();        // userId -> { id, name, email, passwordHash, createdAt }
const usersByEmail = new Map(); // email (en minusculas) -> userId
const devices = new Map();      // deviceId -> { deviceId, userId, deviceName, createdAt, lastLoginAt, active }
const sessions = new Map();     // sessionId -> { sessionId, userId, deviceId, createdAt, revoked }

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function getDevicesByUser(userId) {
  return Array.from(devices.values()).filter((d) => d.userId === userId);
}

function getSessionsByUser(userId) {
  return Array.from(sessions.values()).filter((s) => s.userId === userId);
}

function revokeSessionsByUser(userId) {
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      session.revoked = true;
    }
  }
}

function revokeSessionsByDevice(deviceId) {
  for (const session of sessions.values()) {
    if (session.deviceId === deviceId) {
      session.revoked = true;
    }
  }
}

function deleteDevicesByUser(userId) {
  for (const [id, device] of devices.entries()) {
    if (device.userId === userId) {
      devices.delete(id);
    }
  }
}

module.exports = {
  users,
  usersByEmail,
  devices,
  sessions,
  toPublicUser,
  getDevicesByUser,
  getSessionsByUser,
  revokeSessionsByUser,
  revokeSessionsByDevice,
  deleteDevicesByUser,
};
