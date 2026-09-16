const { rateLimit } = require('express-rate-limit');

function createLimiter(limit, keyGenerator) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // With trust proxy=false, forwarded headers are intentionally ignored.
    // Disable warnings that could serialize attacker-controlled header values.
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { error: { message: 'Demasiados intentos. Intenta nuevamente mas tarde.', statusCode: 429 } },
  });
}

const registerLimiter = createLimiter(10);
const loginLimiter = createLimiter(30);
const sensitiveLimiter = createLimiter(10, (req) => req.auth.userId);

module.exports = { registerLimiter, loginLimiter, sensitiveLimiter };
