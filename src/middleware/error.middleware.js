const { AppError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Error interno del servidor';

  if (!err.isOperational) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
