const jwt = require('jsonwebtoken');

function validateConfig(env = process.env) {
  const invalid = (field) => { throw new Error(`Configuracion invalida: ${field}`); };
  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) invalid('DATABASE_URL');
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
      invalid('DATABASE_URL');
    }
  } catch { invalid('DATABASE_URL'); }

  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32
      || /cambia|change.?me|replace|placeholder|your.?secret|example|ejemplo/i.test(secret)) {
    invalid('JWT_SECRET (obligatorio, aleatorio, minimo 32 caracteres y sin placeholders)');
  }
  const port = env.PORT === undefined ? '3000' : env.PORT;
  if (typeof port !== 'string' || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) invalid('PORT');

  const expiresIn = env.JWT_EXPIRES_IN === undefined ? '7d' : env.JWT_EXPIRES_IN;
  // Explicit units avoid jsonwebtoken interpreting a bare numeric string as milliseconds.
  if (typeof expiresIn !== 'string' || !/^[1-9]\d*(ms|s|m|h|d|w|y)$/.test(expiresIn)) invalid('JWT_EXPIRES_IN');
  try {
    const payload = jwt.decode(jwt.sign({}, secret, { expiresIn }));
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat) invalid('JWT_EXPIRES_IN');
  } catch { invalid('JWT_EXPIRES_IN'); }
  return { port: Number(port) };
}

module.exports = { validateConfig };
