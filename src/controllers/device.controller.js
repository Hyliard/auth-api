const { AppError } = require('../utils/errors');
const store = require('../store/db.store');

async function listDevices(req, res, next) {
  try {
    const devices = await store.getDevicesByUser(req.auth.userId);
    const userDevices = devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      createdAt: d.createdAt,
      lastLoginAt: d.lastLoginAt,
      isCurrentDevice: d.deviceId === req.auth.deviceId,
    }));

    res.status(200).json({ devices: userDevices });
  } catch (err) {
    next(err);
  }
}

async function unlinkDevice(req, res, next) {
  try {
    const { deviceId } = req.params;
    const device = await store.findDeviceById(deviceId);

    if (!device || device.userId !== req.auth.userId) {
      throw new AppError('Dispositivo no encontrado', 404);
    }

    const wasCurrentDevice = deviceId === req.auth.deviceId;

    await store.revokeSessionsByDevice(deviceId);
    await store.deleteDevice(deviceId);

    res.status(200).json({
      message: wasCurrentDevice
        ? 'Dispositivo desvinculado. Tu sesion actual fue cerrada.'
        : 'Dispositivo desvinculado correctamente.',
      currentSessionClosed: wasCurrentDevice,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listDevices, unlinkDevice };
