const { AppError } = require('../utils/errors');
const store = require('../store/db.store');
const avatarStorage = require('../services/avatar-storage.service');

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function detectAvatarType(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError('Debe enviar un archivo de avatar no vacio', 400);
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype)) {
    throw new AppError('El formato del avatar no esta permitido', 415);
  }
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected) throw new AppError('El contenido del avatar no es una imagen valida', 400);
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, detected.mime)) {
    throw new AppError('El formato del avatar no esta permitido', 415);
  }
  if (detected.mime !== file.mimetype) {
    throw new AppError('El tipo declarado no coincide con el contenido del avatar', 415);
  }
  return { extension: ALLOWED_TYPES[detected.mime] };
}

async function uploadAvatar(req, res, next) {
  let newFilename;
  try {
    const { extension } = await detectAvatarType(req.file);
    newFilename = await avatarStorage.saveAvatar(req.file.buffer, extension);
    let replacement;
    try {
      replacement = await store.replaceUserAvatar(req.auth.userId, newFilename);
    } catch (err) {
      await avatarStorage.deleteAvatarBestEffort(newFilename);
      throw err;
    }
    if (!replacement) {
      await avatarStorage.deleteAvatarBestEffort(newFilename);
      throw new AppError('Usuario no encontrado', 404);
    }
    await avatarStorage.deleteAvatarBestEffort(replacement.previousAvatarFilename);
    res.status(200).json({ user: store.toPublicUser(replacement.user) });
  } catch (err) {
    next(err);
  }
}

async function getAvatar(req, res, next) {
  try {
    const user = await store.findUserById(req.auth.userId);
    if (!user) throw new AppError('Usuario no encontrado', 404);
    if (!user.avatarFilename) throw new AppError('El usuario no tiene avatar', 404);
    const avatar = await avatarStorage.getAvatarFile(user.avatarFilename);
    if (!avatar) throw new AppError('El avatar no esta disponible', 404);
    res.set({
      'Content-Type': avatar.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(avatar.filePath, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadAvatar, getAvatar };
