const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const ServiceRequest = require('../models/ServiceRequest');

const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/roadside_assistance';
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

async function run() {
  console.log('Using MongoDB URI:', mongodbUri);
  console.log('RAZORPAY_KEY_ID:', keyId ? `${keyId.substring(0, 8)}...` : 'undefined');

  try {
    // 1. Connect to MongoDB
    await mongoose.connect(mongodbUri);
    console.log('✅ Connected to MongoDB');

    // 2. Find the most recent completed ServiceRequest
    const request = await ServiceRequest.findOne({ status: 'completed' }).sort({ updatedAt: -1 });
    if (!request) {
      console.warn('⚠️ No completed service request found in database.');
      await mongoose.disconnect();
      process.exit(0);
    }
    console.log(`✅ Found recent completed request: ${request._id}`);
    
    const finalAmount = request.accepted_price || request.pricing?.totalAmount || request.amount || request.totalPrice || 350;
    console.log(`- Amount: ₹${finalAmount}`);

    // 3. Initialize Razorpay
    if (!keyId || !keySecret) {
      console.error('❌ Razorpay credentials missing in environment variables.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    console.log('✅ Razorpay instance initialized');

    // 4. Attempt to create a Payment Link
    const amountInPaise = Math.round(Number(finalAmount) * 100);
    console.log(`- Generating Razorpay Payment Link for amount: ${amountInPaise} paise...`);
    
    try {
      const response = await razorpay.paymentLink.create({
        amount: amountInPaise,
        currency: 'INR',
        description: 'RoadMitra Service Payment',
        callback_url: 'https://roadside-assistance-production-ddaf.up.railway.app/api/payments/callback',
        callback_method: 'get',
        reference_id: String(request._id),
        notes: {
          requestId: String(request._id)
        }
      });

      // 5. Log the full response
      console.log('✅ Razorpay Payment Link creation succeeded:');
      console.log(JSON.stringify(response, null, 2));

    } catch (apiError) {
      console.error('❌ Razorpay Payment Link creation failed:');
      console.error('Error Code:', apiError.code);
      console.error('Error Description:', apiError.description);
      console.error('Full Error Details:', apiError);
    }

  } catch (error) {
    console.error('❌ Execution Error:', error);
  } finally {
    // 6. Disconnect and exit
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB. Exiting.');
  }
}

run();
