const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { amount, requestId } = req.body;
    const Razorpay = require('razorpay');

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount: amount * 100,
      currency: 'INR',
      receipt: requestId,
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, requestId, amount } = req.body;
    const crypto = require('crypto');
    const Payment = require('../models/Payment');

    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
      });
    }

    const payment = await Payment.create({
      requestId,
      userId: req.user.id,
      amount,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      status: 'completed',
    });

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      payment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
