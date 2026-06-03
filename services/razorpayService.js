const Razorpay = require('razorpay');
const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config();

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

let razorpayInstance = null;

if (keyId && keySecret) {
  try {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    console.log('[Razorpay Service] Razorpay Client initialized successfully.');
  } catch (error) {
    console.warn('[Razorpay Service] Failed to initialize Razorpay client:', error.message);
  }
} else {
  console.log('[Razorpay Service] Razorpay credentials missing. Running in mock/simulation mode.');
}

/**
 * Creates a Razorpay Order
 * @param {number} amount - Amount in INR
 * @param {string} receiptId - Unique receipt identifier (e.g. ServiceRequest ID)
 * @returns {Promise<object>} - Order details
 */
const createOrder = async (amount, receiptId) => {
  if (razorpayInstance) {
    try {
      const options = {
        amount: Math.round(amount * 100), // amount in paise
        currency: 'INR',
        receipt: receiptId,
        payment_capture: 1 // Auto capture
      };
      const order = await razorpayInstance.orders.create(options);
      return { success: true, order };
    } catch (error) {
      console.error('[Razorpay Service] Order creation failed:', error.message);
      throw error;
    }
  }

  // Mock Fallback Order
  const mockOrder = {
    id: `order_${Math.random().toString(36).substring(2, 11)}`,
    entity: 'order',
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: receiptId,
    status: 'created',
    created_at: Math.floor(Date.now() / 1000)
  };
  console.log('[Razorpay Service] Generated MOCK order:', mockOrder.id);
  return { success: true, order: mockOrder, mock: true };
};

/**
 * Verifies Razorpay Webhook/Client signature
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} signature
 * @returns {boolean}
 */
const verifySignature = (orderId, paymentId, signature) => {
  if (!signature) return false;

  if (razorpayInstance) {
    try {
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      return generatedSignature === signature;
    } catch (error) {
      console.error('[Razorpay Service] Signature verification failed:', error.message);
      return false;
    }
  }

  // In mock/development mode, if signature is "mock_signature", verify as true
  if (signature === 'mock_signature' || signature.startsWith('mock_')) {
    return true;
  }
  return false;
};

module.exports = {
  createOrder,
  verifySignature,
  isMock: () => !razorpayInstance
};
