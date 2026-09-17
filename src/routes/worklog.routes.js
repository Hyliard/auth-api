const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const workLogController = require('../controllers/worklog.controller');

const router = express.Router();

router.use(authenticate);
router.post('/', workLogController.createWorkLog);
router.get('/', workLogController.listWorkLogs);
router.get('/:workLogId', workLogController.getWorkLog);
router.patch('/:workLogId', workLogController.updateWorkLog);
router.delete('/:workLogId', workLogController.archiveWorkLog);

module.exports = router;
