const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { getChatMessages } = require('../controllers/chatController');

router.use(protect);

router.get('/:requestId', restrictTo('customer', 'mechanic'), getChatMessages);

module.exports = router;
