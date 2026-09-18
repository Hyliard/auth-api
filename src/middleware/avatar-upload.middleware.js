const multer = require('multer');
const { AppError } = require('../utils/errors');

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AVATAR_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
  },
});

function uploadAvatar(req, res, next) {
  upload.single('avatar')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('El avatar no puede superar 5 MB', 413));
      }
      return next(new AppError('El formulario multipart contiene campos o archivos no permitidos', 400));
    }
    return next(err);
  });
}

module.exports = { uploadAvatar, MAX_AVATAR_SIZE };
