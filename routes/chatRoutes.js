const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const Message = require('../models/Message');

const router = express.Router();

router.use(authMiddleware);

// GET /api/chat/:jobId/messages — fetch all messages for a job (sorted newest first)
router.get('/:jobId/messages', async (req, res) => {
  try {
    const messages = await Message.find({ jobId: req.params.jobId }).sort({ createdAt: -1 });
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/chat/:jobId/messages — save a message to DB
router.post('/:jobId/messages', async (req, res) => {
  try {
    const { message, senderType } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const newMessage = await Message.create({
      jobId: req.params.jobId,
      senderId: req.user.id,
      senderType: senderType || (req.user.role === 'mechanic' ? 'mechanic' : 'customer'),
      message
    });

    res.status(201).json({
      success: true,
      message: newMessage
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/chat/:jobId/read — mark all messages sent by other party as read
router.put('/:jobId/read', async (req, res) => {
  try {
    const otherSenderType = req.user.role === 'mechanic' ? 'customer' : 'mechanic';
    await Message.updateMany(
      { jobId: req.params.jobId, senderType: otherSenderType, isRead: false },
      { isRead: true }
    );
    res.json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
