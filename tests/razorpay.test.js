// backend/tests/razorpay.test.js
/**
 * Razorpay integration tests (test mode).
 *
 * Scenarios covered:
 *   1. Create order (POST /api/payments/create-order)
 *   2. Verify payment signature (POST /api/payments/verify)
 *   3. Handle webhook for payment.captured
 *   4. Refund flow (POST /api/payments/refund)
 *   5. Mock failed payment (invalid signature)
 *
 * Prerequisites:
 *   - Set environment variables before running tests:
 *       RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys)
 *       JWT_SECRET (for auth if needed)
 *   - The backend must expose the following routes:
 *       POST   /api/payments/create-order
 *       POST   /api/payments/verify
 *       POST   /api/payments/webhook   (raw body & signature header)
 *       POST   /api/payments/refund
 */

const request = require('supertest');
const crypto = require('crypto');
const app = require('../server'); // Express app exported from server.js

// Helper to generate Razorpay webhook signature (as Razorpay does)
function generateSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

describe('Razorpay Payment Flow (Test Mode)', () => {
  let orderId;
  let paymentId;
  const amount = 5000; // ₹50 in paise

  // ---------------------------------------------------
  // 1️⃣ Create Order
  // ---------------------------------------------------
  test('Create Razorpay order', async () => {
    const res = await request(app)
      .post('/api/payments/create-order')
      .send({ amount, currency: 'INR', receipt: `receipt_${Date.now()}` })
      .expect(201);
    expect(res.body).toHaveProperty('orderId');
    expect(res.body).toHaveProperty('amount', amount);
    orderId = res.body.orderId;
  });

  // ---------------------------------------------------
  // 2️⃣ Verify Payment Signature – success
  // ---------------------------------------------------
  test('Verify payment signature (valid)', async () => {
    const mockPayment = {
      razorpay_payment_id: `pay_${Date.now()}`,
      razorpay_order_id: orderId,
      razorpay_signature: '',
    };
    mockPayment.razorpay_signature = generateSignature(
      {
        razorpay_order_id: mockPayment.razorpay_order_id,
        razorpay_payment_id: mockPayment.razorpay_payment_id,
      },
      process.env.RAZORPAY_KEY_SECRET
    );

    const res = await request(app)
      .post('/api/payments/verify')
      .send(mockPayment)
      .expect(200);
    expect(res.body).toHaveProperty('status', 'verified');
    paymentId = mockPayment.razorpay_payment_id;
  });

  // ---------------------------------------------------
  // 3️⃣ Verify Payment Signature – failure
  // ---------------------------------------------------
  test('Verify payment signature (invalid)', async () => {
    const badPayload = {
      razorpay_payment_id: 'pay_invalid',
      razorpay_order_id: orderId,
      razorpay_signature: 'invalidsignature',
    };
    const res = await request(app)
      .post('/api/payments/verify')
      .send(badPayload)
      .expect(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  // ---------------------------------------------------
  // 4️⃣ Webhook – payment.captured
  // ---------------------------------------------------
  test('Handle webhook: payment.captured', async () => {
    const webhookPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const signature = generateSignature(webhookPayload, process.env.RAZORPAY_KEY_SECRET);
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(webhookPayload)
      .expect(200);
    // The webhook handler should acknowledge receipt
    expect(res.body).toHaveProperty('received', true);
  });

  // ---------------------------------------------------
  // 5️⃣ Refund Flow
  // ---------------------------------------------------
  test('Refund a captured payment', async () => {
    const refundRes = await request(app)
      .post('/api/payments/refund')
      .send({ paymentId, amount }) // amount in paise for full refund
      .expect(201);
    expect(refundRes.body).toHaveProperty('refundId');
    expect(refundRes.body).toHaveProperty('status');
    // status may be "processed" or "refunded"
    const allowed = ['processed', 'refunded'];
    expect(allowed).toContain(refundRes.body.status.toLowerCase());
  });
});
