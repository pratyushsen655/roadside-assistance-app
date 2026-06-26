const express = require('express');
const { getNotifications, markAllRead, markOneRead } = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// All notification routes require JWT auth
router.use(authMiddleware);

router.get('/', getNotifications);
router.put('/mark-all-read', markAllRead);
router.put('/:id/read', markOneRead);

module.exports = router;
