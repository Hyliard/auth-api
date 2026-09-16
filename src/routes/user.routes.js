const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');
const { sensitiveLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.delete('/me', authenticate, sensitiveLimiter, userController.deleteAccount);

module.exports = router;
