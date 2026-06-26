const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['mechanic_assigned', 'job_complete', 'rate_mechanic', 'mechanic_enroute', 'message', 'admin_broadcast'],
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Legacy support: recipient/recipientModel kept for backward compat
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'recipientModel',
    },
    recipientModel: {
      type: String,
      enum: ['User', 'Mechanic'],
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);
