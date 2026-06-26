const Payment = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const Mechanic = require('../models/Mechanic');
const crypto = require('crypto');
const Razorpay = require('razorpay');

// Create a Razorpay Order
exports.createOrder = async (req, res) => {
  try {
    const { jobId, serviceRequestId, amount } = req.body;
    const finalJobId = jobId || serviceRequestId;

    if (!finalJobId || !amount) {
      return res.status(400).json({ success: false, message: 'Job ID and amount are required' });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const isPlaceholderKey = !process.env.RAZORPAY_KEY_ID || 
                             process.env.RAZORPAY_KEY_ID.includes('xxxx') || 
                             process.env.RAZORPAY_KEY_ID.includes('YourKeyId');

    if (isDev && isPlaceholderKey) {
      return res.status(200).json({
        success: true,
        orderId: 'order_mock_' + Math.random().toString(36).substring(7),
        amount,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId'
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_YourKeySecret',
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // in paise
      currency: 'INR',
      receipt: `job_${finalJobId}`,
      notes: { jobId: finalJobId, customerId: req.user.id }
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Verify Razorpay Payment Signature
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpayOrderId, orderId,
      razorpayPaymentId, paymentId,
      razorpaySignature, signature,
      jobId, serviceRequestId
    } = req.body;

    const finalOrderId = razorpayOrderId || orderId;
    const finalPaymentId = razorpayPaymentId || paymentId;
    const finalSignature = razorpaySignature || signature;
    let finalJobId = jobId || serviceRequestId;

    if (!finalJobId) {
      const User = require('../models/User');
      const user = await User.findById(req.user.id);
      if (user && user.activeRequestId) {
        finalJobId = user.activeRequestId;
      } else {
        const lastRequest = await ServiceRequest.findOne({ customer: req.user.id })
          .sort({ createdAt: -1 });
        if (lastRequest) {
          finalJobId = lastRequest._id;
        }
      }
    }

    if (!finalOrderId || !finalPaymentId || !finalSignature || !finalJobId) {
      return res.status(400).json({ success: false, message: 'All payment parameters are required' });
    }

    const key_secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_YourKeySecret';
    
    // Dev bypass for simulated Expo Go payments
    const isDev = process.env.NODE_ENV !== 'production';
    const isMock = isDev && (finalSignature === 'mock_signature' || finalSignature === 'sig_mock_123');

    let verified = false;
    if (isMock) {
      verified = true;
    } else {
      const body = finalOrderId + '|' + finalPaymentId;
      const expectedSignature = crypto.createHmac('sha256', key_secret).update(body).digest('hex');
      if (expectedSignature === finalSignature) {
        verified = true;
      }
    }

    if (verified) {
      const request = await ServiceRequest.findById(finalJobId);
      if (!request) {
        return res.status(404).json({ success: false, message: 'Job not found' });
      }

      request.paymentStatus = 'paid';
      request.paymentMethod = 'razorpay';
      request.razorpayOrderId = finalOrderId;
      request.razorpayPaymentId = finalPaymentId;
      await request.save();

      // update mechanic earnings & total jobs completed
      if (request.mechanic) {
        const earningsEarned = request.amount || request.pricing?.totalAmount || 0;
        await Mechanic.findByIdAndUpdate(request.mechanic, {
          $inc: { earnings: earningsEarned, totalJobs: 1 }
        });
      }

      // Create Payment transaction record
      const payment = await Payment.create({
        requestId: request._id,
        userId: req.user.id,
        mechanicId: request.mechanic,
        amount: request.amount || request.pricing?.totalAmount || 0,
        paymentMethod: 'razorpay',
        razorpayOrderId: finalOrderId,
        razorpayPaymentId: finalPaymentId,
        razorpaySignature: finalSignature,
        status: 'completed'
      });

      return res.status(200).json({ success: true, message: 'Payment verified successfully', payment });
    } else {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Process Pay Cash Option
exports.payCash = async (req, res) => {
  try {
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required' });
    }

    const request = await ServiceRequest.findById(jobId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    request.paymentStatus = 'paid';
    request.paymentMethod = 'cash';
    await request.save();

    if (request.mechanic) {
      const earningsEarned = request.amount || request.pricing?.totalAmount || 0;
      await Mechanic.findByIdAndUpdate(request.mechanic, {
        $inc: { earnings: earningsEarned, totalJobs: 1 }
      });
    }

    const payment = await Payment.create({
      requestId: request._id,
      userId: req.user.id,
      mechanicId: request.mechanic,
      amount: request.amount || request.pricing?.totalAmount || 0,
      paymentMethod: 'cash',
      status: 'completed'
    });

    return res.status(200).json({ success: true, message: 'Cash payment processed successfully', payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get Payment History for User
exports.getHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user.id })
      .populate('mechanicId', 'name phone')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, payments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
