const bcrypt = require('bcryptjs');
const { AppError } = require('../utils/errors');
const store = require('../store/db.store');
const { validateBody, validatePassword } = require('../utils/validators');

async function deleteAccount(req, res, next) {
  try {
    const { password } = validateBody(req.body);
    validatePassword(password);

    const user = await store.findUserById(req.auth.userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404);
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new AppError('Contrasena incorrecta', 401);
    }

    await store.revokeSessionsByUser(user.id);
    await store.deleteUser(user.id);

    res.status(200).json({ message: 'Cuenta eliminada correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { deleteAccount };
