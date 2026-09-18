const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');
const avatarController = require('../controllers/avatar.controller');
const { uploadAvatar } = require('../middleware/avatar-upload.middleware');
const { sensitiveLimiter, avatarUploadLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.delete('/me', authenticate, sensitiveLimiter, userController.deleteAccount);
router.post('/me/avatar', authenticate, avatarUploadLimiter, uploadAvatar, avatarController.uploadAvatar);
router.get('/me/avatar', authenticate, avatarController.getAvatar);

module.exports = router;
