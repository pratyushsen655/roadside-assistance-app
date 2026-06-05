const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Request',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mechanicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mechanic',
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['card', 'upi', 'wallet', 'cash', 'razorpay'],
      default: 'razorpay',
    },
    transactionId: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    refundDetails: {
      refundId: String,
      refundAmount: Number,
      refundReason: String,
      refundedAt: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
