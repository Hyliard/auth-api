const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');

const router = express.Router();

router.delete('/me', authenticate, userController.deleteAccount);

module.exports = router;
