const bcrypt = require('bcryptjs');
const { AppError } = require('../utils/errors');
const store = require('../store/memory.store');

async function deleteAccount(req, res, next) {
  try {
    const { password } = req.body || {};

    if (!password) {
      throw new AppError('El campo password es obligatorio', 400);
    }

    const user = store.users.get(req.auth.userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404);
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new AppError('Contrasena incorrecta', 401);
    }

    store.deleteDevicesByUser(user.id);
    store.revokeSessionsByUser(user.id);
    store.users.delete(user.id);
    store.usersByEmail.delete(user.email);

    res.status(200).json({ message: 'Cuenta eliminada correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { deleteAccount };
