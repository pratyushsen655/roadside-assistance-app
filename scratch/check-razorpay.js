const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Razorpay = require('razorpay');

console.log('Loaded RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID);
console.log('Loaded RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? '***' + process.env.RAZORPAY_KEY_SECRET.slice(-4) : 'undefined');

if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes('YourKeyId') || process.env.RAZORPAY_KEY_ID.includes('xxxxxxxxxxxxx')) {
  console.error('Error: Razorpay key is still a placeholder in .env!');
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function testQRCode() {
  console.log('\n--- Testing qrCode.create() ---');
  try {
    const response = await razorpay.qrCode.create({
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: 1000, // Rs 10.00
      description: 'Test Service Request QR Code',
      close_by: Math.floor(Date.now() / 1000) + 900 // 15 mins
    });
    console.log('qrCode.create SUCCESS!');
    console.log('QR Code ID:', response.id);
    console.log('QR Image URL:', response.image_url);
    return { success: true, api: 'qrCode' };
  } catch (error) {
    console.log('qrCode.create FAILED!');
    console.log('Error Code:', error.code);
    console.log('Error Description:', error.description);
    console.log('Full Error:', error.message);
    return { success: false, api: 'qrCode', error };
  }
}

async function testPaymentLink() {
  console.log('\n--- Testing paymentLink.create() ---');
  try {
    const response = await razorpay.paymentLink.create({
      amount: 1000, // Rs 10.00
      currency: 'INR',
      accept_partial: false,
      description: 'Test Service Request Payment Link',
      customer: {
        name: 'Test Customer',
        email: 'test@example.com',
        contact: '+919999999999'
      },
      notify: {
        sms: false,
        email: false
      },
      reminder_enable: false,
      notes: {
        requestId: 'test_request_123'
      },
      callback_url: 'https://example.com/callback',
      callback_method: 'get'
    });
    console.log('paymentLink.create SUCCESS!');
    console.log('Payment Link ID:', response.id);
    console.log('Short URL:', response.short_url);
    return { success: true, api: 'paymentLink' };
  } catch (error) {
    console.log('paymentLink.create FAILED!');
    console.log('Error Code:', error.code);
    console.log('Error Description:', error.description);
    console.log('Full Error:', error.message);
    return { success: false, api: 'paymentLink', error };
  }
}

async function runTests() {
  const qrRes = await testQRCode();
  const plRes = await testPaymentLink();
  console.log('\n--- Summary ---');
  console.log('QR Code API:', qrRes.success ? 'AVAILABLE' : 'UNAVAILABLE');
  console.log('Payment Link API:', plRes.success ? 'AVAILABLE' : 'UNAVAILABLE');
}

runTests();
