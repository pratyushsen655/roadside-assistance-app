const Payment = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const Mechanic = require('../models/Mechanic');
const crypto = require('crypto');
const Razorpay = require('razorpay');

// Create a Razorpay Order
exports.createOrder = async (req, res) => {
  try {
    const { jobId, serviceRequestId, requestId, amount } = req.body;
    const finalJobId = requestId || jobId || serviceRequestId;

    if (!finalJobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required' });
    }

    let finalAmount = amount;
    if (!finalAmount) {
      const request = await ServiceRequest.findById(finalJobId);
      if (!request) {
        return res.status(404).json({ success: false, message: 'Service request not found' });
      }
      finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice;
    }

    if (!finalAmount) {
      return res.status(400).json({ success: false, message: 'Payment amount is required' });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const isPlaceholderKey = !process.env.RAZORPAY_KEY_ID || 
                             process.env.RAZORPAY_KEY_ID.includes('xxxx') || 
                             process.env.RAZORPAY_KEY_ID.includes('YourKeyId');

    if (isDev && isPlaceholderKey) {
      return res.status(200).json({
        success: true,
        orderId: 'order_mock_' + Math.random().toString(36).substring(7),
        amount: finalAmount,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId'
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_YourKeySecret',
    });

    const order = await razorpay.orders.create({
      amount: Math.round(Number(finalAmount) * 100), // in paise
      currency: 'INR',
      receipt: `job_${finalJobId}`,
      notes: { jobId: finalJobId, customerId: req.user.id }
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
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
      razorpayOrderId, orderId, razorpay_order_id,
      razorpayPaymentId, paymentId, razorpay_payment_id,
      razorpaySignature, signature, razorpay_signature,
      jobId, serviceRequestId, requestId
    } = req.body;

    const finalOrderId = razorpay_order_id || razorpayOrderId || orderId;
    const finalPaymentId = razorpay_payment_id || razorpayPaymentId || paymentId;
    const finalSignature = razorpay_signature || razorpaySignature || signature;
    const finalJobId = requestId || jobId || serviceRequestId;

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

      const finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice || 0;

      // update mechanic earnings & total jobs completed
      if (request.mechanic) {
        const commissionSplit = 0.80;
        const creditAmount = Math.round(finalAmount * commissionSplit);
        const mechanic = await Mechanic.findById(request.mechanic);
        if (mechanic) {
          const earnings = /** @type {any} */ (mechanic.earnings);
          if (typeof earnings === 'number') {
            mechanic.earnings = earnings + creditAmount;
          } else if (earnings && typeof earnings.total === 'number') {
            earnings.total += creditAmount;
          } else {
            mechanic.earnings = creditAmount;
          }
          mechanic.totalJobs = (mechanic.totalJobs || 0) + 1;
          await mechanic.save();
        }
      }

      // Create Payment transaction record
      const payment = await Payment.create({
        requestId: request._id,
        userId: req.user.id,
        mechanicId: request.mechanic,
        amount: finalAmount,
        paymentMethod: 'razorpay',
        razorpayOrderId: finalOrderId,
        razorpayPaymentId: finalPaymentId,
        razorpaySignature: finalSignature,
        status: 'completed'
      });

      // Emit socket event 'payment:completed' to job room
      const socketHandler = require('../sockets/socketHandler');
      const io = socketHandler.getIo();
      if (io) {
        io.to(`job:${request._id.toString()}`).emit('payment:completed', {
          requestId: request._id,
          paymentStatus: 'paid',
          razorpayPaymentId: finalPaymentId
        });
      }

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

// Create Razorpay QR payment or fallback to Payment Link
exports.createQrOrder = async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'Request ID is required' });
    }

    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    const finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice;
    if (!finalAmount) {
      return res.status(400).json({ success: false, message: 'Invalid or missing pricing amount' });
    }

    const amountInPaise = Math.round(Number(finalAmount) * 100);

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyId',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_YourKeySecret',
    });

    const isDev = process.env.NODE_ENV !== 'production';
    const isPlaceholderKey = !process.env.RAZORPAY_KEY_ID || 
                             process.env.RAZORPAY_KEY_ID.includes('xxxx') || 
                             process.env.RAZORPAY_KEY_ID.includes('YourKeyId');

    // Dev mock bypass if placeholder keys are detected
    if (isDev && isPlaceholderKey) {
      const mockOrderId = 'order_mock_' + Math.random().toString(36).substring(7);
      const mockQrCodeId = 'qr_mock_' + Math.random().toString(36).substring(7);
      
      request.razorpayOrderId = mockOrderId;
      request.razorpayQrCodeId = mockQrCodeId;
      await request.save();

      return res.status(200).json({
        success: true,
        qrCodeId: mockQrCodeId,
        orderId: mockOrderId,
        method: 'qr',
        qrUrl: `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent('https://mock-payment.razorpay.com/' + mockOrderId)}&size=300x300`,
        amount: finalAmount,
        currency: 'INR'
      });
    }

    // Try QR Code API
    try {
      const qrCode = /** @type {any} */ (await razorpay.qrCode.create({
        type: 'upi_qr',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: amountInPaise,
        description: `Service Request ${requestId}`,
        close_by: Math.floor(Date.now() / 1000) + 900 // current time + 15 mins
      }));

      request.razorpayQrCodeId = qrCode.id;
      request.razorpayOrderId = qrCode.order_id || '';
      await request.save();

      return res.status(200).json({
        success: true,
        qrCodeId: qrCode.id,
        orderId: qrCode.order_id || '',
        method: 'qr',
        qrUrl: qrCode.image_url,
        amount: finalAmount,
        currency: 'INR'
      });

    } catch (qrError) {
      console.warn('[Razorpay QR API Failed, falling back to Payment Link]:', qrError.message);

      // Fallback to Payment Link API
      const paymentLink = /** @type {any} */ (await razorpay.paymentLink.create(/** @type {any} */ ({
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        description: `Service Request ${requestId}`,
        reference_id: requestId,
        callback_url: `https://example.com/payment-callback`,
        callback_method: 'get',
        notes: {
          requestId: requestId
        }
      })));

      request.razorpayPaymentLinkId = paymentLink.id;
      request.razorpayOrderId = paymentLink.order_id || '';
      await request.save();

      return res.status(200).json({
        success: true,
        paymentLinkId: paymentLink.id,
        orderId: paymentLink.order_id || '',
        method: 'payment_link',
        qrUrl: paymentLink.short_url,
        amount: finalAmount,
        currency: 'INR'
      });
    }
  } catch (error) {
    console.error('[createQrOrder Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Poll Payment Status
exports.getPaymentStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'Request ID is required' });
    }

    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    if (request.paymentStatus === 'paid') {
      return res.status(200).json({ success: true, paid: true });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const isPlaceholderKey = !process.env.RAZORPAY_KEY_ID || 
                             process.env.RAZORPAY_KEY_ID.includes('xxxx') || 
                             process.env.RAZORPAY_KEY_ID.includes('YourKeyId');

    // Dev bypass for placeholder keys
    if (isDev && isPlaceholderKey) {
      return res.status(200).json({ success: true, paid: false });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    let isPaid = false;
    let paymentId = '';

    if (request.razorpayQrCodeId) {
      try {
        const payments = /** @type {any} */ (await razorpay.payments.all(/** @type {any} */ ({ qr_code_id: request.razorpayQrCodeId })));
        const successfulPayment = payments.items.find(p => p.status === 'captured');
        if (successfulPayment) {
          isPaid = true;
          paymentId = successfulPayment.id;
        }
      } catch (err) {
        console.error('[Error fetching QR status]:', err.message);
      }
    } else if (request.razorpayPaymentLinkId) {
      try {
        const linkStatus = /** @type {any} */ (await razorpay.paymentLink.fetch(request.razorpayPaymentLinkId));
        if (linkStatus.status === 'paid') {
          isPaid = true;
          const payments = /** @type {any} */ (await razorpay.payments.all(/** @type {any} */ ({ payment_link_id: request.razorpayPaymentLinkId })));
          const successfulPayment = payments.items.find(p => p.status === 'captured');
          paymentId = successfulPayment ? successfulPayment.id : '';
        }
      } catch (err) {
        console.error('[Error fetching Payment Link status]:', err.message);
      }
    }

    if (isPaid) {
      request.paymentStatus = 'paid';
      request.paymentMethod = 'razorpay';
      if (paymentId) {
        request.razorpayPaymentId = paymentId;
      }
      await request.save();

      const finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice || 0;

      // Update mechanic earnings
      if (request.mechanic) {
        const commissionSplit = 0.80;
        const creditAmount = Math.round(finalAmount * commissionSplit);
        const mechanic = await Mechanic.findById(request.mechanic);
        if (mechanic) {
          const earnings = /** @type {any} */ (mechanic.earnings);
          if (typeof earnings === 'number') {
            mechanic.earnings = earnings + creditAmount;
          } else if (earnings && typeof earnings.total === 'number') {
            earnings.total += creditAmount;
          } else {
            mechanic.earnings = creditAmount;
          }
          mechanic.totalJobs = (mechanic.totalJobs || 0) + 1;
          await mechanic.save();
        }
      }

      // Create Payment transaction record
      await Payment.create({
        requestId: request._id,
        userId: request.customer,
        mechanicId: request.mechanic,
        amount: finalAmount,
        paymentMethod: 'razorpay',
        razorpayOrderId: request.razorpayOrderId,
        razorpayPaymentId: paymentId || 'pmt_' + Math.random().toString(36).substring(7),
        status: 'completed'
      });

      // Emit socket event 'payment:completed' to job room
      const socketHandler = require('../sockets/socketHandler');
      const io = socketHandler.getIo();
      if (io) {
        io.to(`job:${request._id.toString()}`).emit('payment:completed', {
          requestId: request._id,
          paymentStatus: 'paid',
          razorpayPaymentId: paymentId
        });
      }

      return res.status(200).json({ success: true, paid: true });
    }

    return res.status(200).json({ success: true, paid: false });
  } catch (error) {
    console.error('[getPaymentStatus Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Webhook handler
exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ success: false, message: 'Signature missing' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_YourKeySecret';
    const bodyStr = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    
    const isDev = process.env.NODE_ENV !== 'production';
    const isMock = isDev && (signature === 'mock_signature' || signature.startsWith('mock_'));
    
    let verified = false;
    if (isMock) {
      verified = true;
    } else {
      const shasum = crypto.createHmac('sha256', secret);
      shasum.update(bodyStr);
      const expectedSignature = shasum.digest('hex');
      if (expectedSignature === signature) {
        verified = true;
      }
    }

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const { event, payload } = req.body;
    console.log('[Webhook Received]:', event);

    let paymentEntity = null;
    let qrCodeId = null;
    let paymentLinkId = null;

    if (event === 'qr_code.credited') {
      const qrEntity = payload.qr_code.entity;
      qrCodeId = qrEntity.id;
      paymentEntity = payload.payment.entity;
    } else if (event === 'payment_link.paid') {
      const plEntity = payload.payment_link.entity;
      paymentLinkId = plEntity.id;
      paymentEntity = payload.payment.entity;
    } else if (event === 'payment.captured') {
      paymentEntity = payload.payment.entity;
    }

    if (paymentEntity) {
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      let query = {};
      if (qrCodeId) {
        query.razorpayQrCodeId = qrCodeId;
      } else if (paymentLinkId) {
        query.razorpayPaymentLinkId = paymentLinkId;
      } else if (orderId) {
        query.razorpayOrderId = orderId;
      } else {
        return res.status(200).json({ received: true, message: 'No identifiers to match request' });
      }

      const request = await ServiceRequest.findOne(query);
      if (request && request.paymentStatus !== 'paid') {
        request.paymentStatus = 'paid';
        request.paymentMethod = 'razorpay';
        request.razorpayPaymentId = paymentId;
        if (orderId && !request.razorpayOrderId) {
          request.razorpayOrderId = orderId;
        }
        await request.save();

        const finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice || 0;

        // Update mechanic earnings
        if (request.mechanic) {
          const commissionSplit = 0.80;
          const creditAmount = Math.round(finalAmount * commissionSplit);
          const mechanic = await Mechanic.findById(request.mechanic);
          if (mechanic) {
            const earnings = /** @type {any} */ (mechanic.earnings);
            if (typeof earnings === 'number') {
              mechanic.earnings = earnings + creditAmount;
            } else if (earnings && typeof earnings.total === 'number') {
              earnings.total += creditAmount;
            } else {
              mechanic.earnings = creditAmount;
            }
            mechanic.totalJobs = (mechanic.totalJobs || 0) + 1;
            await mechanic.save();
          }
        }

        // Create transaction record
        await Payment.create({
          requestId: request._id,
          userId: request.customer,
          mechanicId: request.mechanic,
          amount: finalAmount,
          paymentMethod: 'razorpay',
          razorpayOrderId: orderId || request.razorpayOrderId,
          razorpayPaymentId: paymentId,
          status: 'completed'
        });

        // Emit socket event 'payment:completed' to job room
        const socketHandler = require('../sockets/socketHandler');
        const io = socketHandler.getIo();
        if (io) {
          io.to(`job:${request._id.toString()}`).emit('payment:completed', {
            requestId: request._id,
            paymentStatus: 'paid',
            razorpayPaymentId: paymentId
          });
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[handleWebhook Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

