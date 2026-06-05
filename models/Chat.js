const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Request',
      required: true,
    },
    participants: [
      {
        userId: mongoose.Schema.Types.ObjectId,
        role: {
          type: String,
          enum: ['user', 'mechanic'],
        },
      },
    ],
    messages: [
      {
        senderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        senderRole: {
          type: String,
          enum: ['user', 'mechanic'],
          required: true,
        },
        message: {
          type: String,
          required: true,
        },
        attachments: [String],
        timestamp: {
          type: Date,
          default: Date.now,
        },
        isRead: {
          type: Boolean,
          default: false,
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chat', chatSchema);
