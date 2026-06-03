const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel',
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['User', 'Mechanic'],
  },
  message: {
    type: String,
    trim: true,
    default: '',
  },
  imageUrl: {
    type: String,
    default: '',
  },
  isRead: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Chat', ChatSchema);
