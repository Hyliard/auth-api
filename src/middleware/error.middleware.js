const { AppError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const parserErrors = {
    'entity.parse.failed': [400, 'El cuerpo JSON no es valido'],
    'entity.too.large': [413, 'El cuerpo de la solicitud es demasiado grande'],
    'encoding.unsupported': [415, 'Codificacion no soportada'],
    'charset.unsupported': [415, 'Charset no soportado'],
    'request.aborted': [400, 'Solicitud interrumpida'],
    'request.size.invalid': [400, 'Tamano de solicitud invalido'],
  };
  const known = Object.prototype.hasOwnProperty.call(parserErrors, err.type) ? parserErrors[err.type] : null;
  const operational = err instanceof AppError;
  const statusCode = known ? known[0] : operational ? err.statusCode : 500;
  const message = known ? known[1] : operational ? err.message : 'Error interno del servidor';

  if (!known && !operational) {
    // Error messages, stacks, metadata and request bodies can contain credentials.
    // Use a fixed allowlist, never serialize the original error or request.
    const types = new Set(['TypeError', 'SyntaxError', 'PrismaClientKnownRequestError', 'PrismaClientValidationError', 'PrismaClientInitializationError']);
    console.error({
      type: types.has(err.name) ? err.name : 'Error',
      message: 'Error interno del servidor',
      status: statusCode,
      code: typeof err.code === 'string' && /^P\d{4}$/.test(err.code) ? err.code : 'INTERNAL_ERROR',
    });
  }

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
