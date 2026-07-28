const mongoose = require('mongoose');

const KycAuditLogSchema = new mongoose.Schema({
  mechanic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Mechanic',
    required: true
  },
  docType: {
    type: String,
    default: 'unknown'
  },
  status: {
    type: String,
    enum: ['accepted', 'rejected'],
    required: true
  },
  reason: {
    type: String,
    default: ''
  },
  originalFileName: {
    type: String,
    default: ''
  },
  mimeType: {
    type: String,
    default: ''
  },
  fileSizeBytes: {
    type: Number,
    default: 0
  },
  ipAddress: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('KycAuditLog', KycAuditLogSchema);
