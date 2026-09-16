const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const authController = require('../controllers/auth.controller');
const { registerLimiter, loginLimiter, sensitiveLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, sensitiveLimiter, authController.changePassword);
router.delete('/session', authenticate, authController.logout);

module.exports = router;
