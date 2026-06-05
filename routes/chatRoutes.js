const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/:requestId', authMiddleware, async (req, res) => {
  try {
    const Chat = require('../models/Chat');
    const chat = await Chat.findOne({ requestId: req.params.requestId });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found',
      });
    }

    res.status(200).json({
      success: true,
      messages: chat.messages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post('/:requestId/message', authMiddleware, async (req, res) => {
  try {
    const Chat = require('../models/Chat');
    const { message, attachments, senderRole } = req.body;

    let chat = await Chat.findOne({ requestId: req.params.requestId });

    if (!chat) {
      chat = await Chat.create({
        requestId: req.params.requestId,
        participants: [],
        messages: [],
      });
    }

    chat.messages.push({
      senderId: req.user.id,
      senderRole,
      message,
      attachments: attachments || [],
    });

    await chat.save();

    res.status(201).json({
      success: true,
      message: 'Message sent',
      chat,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
