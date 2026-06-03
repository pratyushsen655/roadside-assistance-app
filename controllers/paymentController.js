const Payment = require('../models/Payment');
const ServiceRequest = require('../models/ServiceRequest');
const Mechanic = require('../models/Mechanic');
const socketHandler = require('../sockets/socketHandler');
const dotenv = require('dotenv');
dotenv.config();

const stripeSecret = process.env.STRIPE_SECRET_KEY;
let stripe = null;

if (stripeSecret) {
  try {
    stripe = require('stripe')(stripeSecret);
  } catch (error) {
    console.warn('[Payment Service] Failed to initialize Stripe client:', error.message);
  }
}

// @desc    Process a simulated or Stripe checkout payment
// @route   POST /api/payments/checkout
// @access  Private (Customer)
exports.processCheckout = async (req, res, next) => {
  const { requestId, paymentMethod, cardToken } = req.body; // paymentMethod: 'card' or 'upi' or 'cash'

  if (!requestId || !paymentMethod) {
    return res.status(400).json({ success: false, message: 'Please provide request ID and payment method.' });
  }

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Breakdown request not found.' });
    }

    if (request.customer.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'You are not authorized to pay for this service request.' });
    }

    if (request.paymentStatus === 'paid') {
      return res.status(400).json({ success: false, message: 'This service request is already paid.' });
    }

    const amount = request.pricing.totalAmount;
    let transactionId = `txn_${Math.random().toString(36).substring(2, 11)}`;
    let status = 'success';
    let gatewayResponse = { simulated: true };

    // Stripe checkout verification if card is specified and keys exist
    if (paymentMethod === 'card' && stripe) {
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // Stripe expects lowest denomination (cents/paise)
          currency: 'inr',
          payment_method_types: ['card'],
          description: `Mechanic assistance breakdown request ID: ${requestId}`,
          metadata: { requestId: requestId.toString(), customerId: req.user.id.toString() }
        });
        
        transactionId = paymentIntent.id;
        status = paymentIntent.status === 'succeeded' ? 'success' : 'pending';
        gatewayResponse = paymentIntent;

      } catch (stripeErr) {
        console.error('[Stripe Payment Error]:', stripeErr.message);
        return res.status(400).json({ success: false, message: `Stripe Payment Error: ${stripeErr.message}` });
      }
    }

    // Cash settlement handled directly
    if (paymentMethod === 'cash') {
      status = 'success';
    }

    // 1. Log payment transaction
    const payment = new Payment({
      serviceRequest: requestId,
      customer: req.user.id,
      mechanic: request.mechanic,
      amount,
      paymentMethod,
      paymentStatus: status,
      transactionId,
      gatewayResponse
    });

    await payment.save();

    // 2. Update service request
    request.paymentStatus = status === 'success' ? 'paid' : 'pending';
    request.paymentMethod = paymentMethod;
    await request.save();

    // 3. Dispatch WebSocket broadcasts
    socketHandler.sendToCustomer(request.customer.toString(), 'payment_processed', {
      requestId,
      paymentStatus: request.paymentStatus,
      amount
    });

    if (request.mechanic) {
      socketHandler.sendToMechanic(request.mechanic.toString(), 'payment_processed', {
        requestId,
        paymentStatus: request.paymentStatus,
        amount
      });
    }

    res.status(200).json({
      success: true,
      message: status === 'success' ? 'Payment processed successfully.' : 'Payment initiated, pending validation.',
      payment
    });

  } catch (error) {
    next(error);
  }
};
