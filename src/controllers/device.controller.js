const { AppError } = require('../utils/errors');
const store = require('../store/memory.store');

function listDevices(req, res, next) {
  try {
    const userDevices = store.getDevicesByUser(req.auth.userId).map((d) => ({
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

function unlinkDevice(req, res, next) {
  try {
    const { deviceId } = req.params;
    const device = store.devices.get(deviceId);

    if (!device || device.userId !== req.auth.userId) {
      throw new AppError('Dispositivo no encontrado', 404);
    }

    const wasCurrentDevice = deviceId === req.auth.deviceId;

    device.active = false;
    store.revokeSessionsByDevice(deviceId);
    store.devices.delete(deviceId);

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
