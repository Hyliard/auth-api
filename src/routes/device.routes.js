const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const deviceController = require('../controllers/device.controller');

const router = express.Router();

router.use(authenticate);
router.get('/', deviceController.listDevices);
router.delete('/:deviceId', deviceController.unlinkDevice);

module.exports = router;
