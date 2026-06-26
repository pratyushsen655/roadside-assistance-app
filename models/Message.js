const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderType: { type: String, enum: ['customer', 'mechanic'], required: true },
  message: { type: String, required: true },
  messageType: { type: String, enum: ['text', 'image', 'location'], default: 'text' },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
