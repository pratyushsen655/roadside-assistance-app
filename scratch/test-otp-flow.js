require('dotenv').config({ path: 'backend/.env' });
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Load models
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Mechanic = require('../models/Mechanic');

// Load express app
const app = require('../server');

// Helper to sign JWT
function signToken(id, role = 'user') {
  const secret = process.env.JWT_SECRET || 'fallback_secret_change_in_env';
  return jwt.sign({ id, role }, secret);
}

async function runTest() {
  console.log('--- STARTING ARRIVAL OTP INTEGRATION TEST ---');
  
  // Connect database if not connected
  if (mongoose.connection.readyState === 0) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/roadside_assistance';
    await mongoose.connect(mongoUri);
    console.log('[DB] Connected to MongoDB.');
  }

  try {
    // 1. Clean up old test data
    console.log('[Cleanup] Removing old test items...');
    await User.deleteMany({ email: /test-otp-cust/ });
    await Mechanic.deleteMany({ phone: /^\+9199998/ });
    await ServiceRequest.deleteMany({ issueDescription: /Test OTP/ });

    // 2. Create customer and mechanic
    console.log('[Seed] Creating customer and mechanic...');
    const customer = await User.create({
      name: 'OTP Test Customer',
      email: 'test-otp-cust@example.com',
      phone: '9999800000',
      password: 'password123'
    });

    const mechanic = await Mechanic.create({
      name: 'OTP Test Mechanic',
      phone: '+919999800001',
      isOnline: true,
      status: 'online',
      location: {
        type: 'Point',
        coordinates: [77.2090, 28.6139]
      }
    });

    // Generate tokens
    const customerToken = signToken(customer._id, 'user');
    const mechanicToken = signToken(mechanic._id, 'mechanic');

    // 3. Create service request in accepted status
    console.log('[Seed] Creating service request (status: accepted)...');
    const serviceRequest = await ServiceRequest.create({
      customer: customer._id,
      mechanic: mechanic._id,
      status: 'accepted',
      vehicleType: 'car',
      issueDescription: 'Test OTP Flow Breakdown',
      customerLocation: {
        type: 'Point',
        coordinates: [77.2090, 28.6139]
      },
      customerAddress: 'OTP Test Location, New Delhi',
      pricing: { baseFare: 150, totalAmount: 350 },
      amount: 350
    });

    console.log(`[Seed] Created Request ID: ${serviceRequest._id}`);

    // 4. Test: Mark Arrived
    console.log('\n--- TEST CASE 1: MARK ARRIVED (Mechanic App) ---');
    const arrivedRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/mark-arrived`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send();

    if (arrivedRes.status === 200) {
      console.log('✅ Success: mark-arrived returned HTTP 200.');
      console.log('Response Message:', arrivedRes.body.message);
      if (arrivedRes.body.request.arrivalOtp === undefined) {
        console.log('✅ Success: response request object does NOT leak the OTP to mechanic app.');
      } else {
        console.log('❌ Failure: response request leaked arrivalOtp to mechanic:', arrivedRes.body.request.arrivalOtp);
      }
    } else {
      console.log('❌ Failure: mark-arrived returned status:', arrivedRes.status, arrivedRes.body);
    }

    // Verify database state for CASE 1
    const dbRequest1 = await ServiceRequest.findById(serviceRequest._id);
    console.log('[DB Verify] Status in DB:', dbRequest1.status);
    console.log('[DB Verify] Generated OTP in DB:', dbRequest1.arrivalOtp);
    console.log('[DB Verify] Generated At in DB:', dbRequest1.otpGeneratedAt);
    console.log('[DB Verify] OTP Verified in DB:', dbRequest1.otpVerified);
    console.log('[DB Verify] OTP Attempts in DB:', dbRequest1.otpAttempts);

    if (dbRequest1.status === 'arrived' && dbRequest1.arrivalOtp && dbRequest1.arrivalOtp.length === 4) {
      console.log('✅ Success: Database correctly updated with status="arrived" and a 4-digit OTP.');
    } else {
      console.log('❌ Failure: Database state is invalid.');
    }

    // 5. Test: Get Request Details (Customer App)
    console.log('\n--- TEST CASE 2: FETCH REQUEST DETAILS (Customer App) ---');
    const detailsRes = await request(app)
      .get(`/api/requests/${serviceRequest._id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();

    if (detailsRes.status === 200) {
      const returnedOtp = detailsRes.body.request.arrivalOtp;
      console.log('✅ Success: GET request details returned HTTP 200.');
      console.log('Customer fetched OTP:', returnedOtp);
      if (returnedOtp === dbRequest1.arrivalOtp) {
        console.log('✅ Success: Customer app retrieved correct arrival OTP.');
      } else {
        console.log('❌ Failure: Customer app retrieved incorrect OTP:', returnedOtp);
      }
    } else {
      console.log('❌ Failure: GET details returned status:', detailsRes.status, detailsRes.body);
    }

    // 6. Test: Verify OTP Mismatch / Attempts Increment
    console.log('\n--- TEST CASE 3: VERIFY OTP MISMATCH (Mechanic App) ---');
    const verifyMismatchRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/verify-otp`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ otp: '0000' }); // wrong OTP

    if (verifyMismatchRes.status === 400) {
      console.log('✅ Success: verify-otp returned HTTP 400 for mismatch.');
      console.log('Response Message:', verifyMismatchRes.body.message);
      console.log('Attempts Left in Response:', verifyMismatchRes.body.attemptsLeft);
      
      const dbRequest2 = await ServiceRequest.findById(serviceRequest._id);
      console.log('[DB Verify] Attempts in DB:', dbRequest2.otpAttempts);
      if (dbRequest2.otpAttempts === 1 && verifyMismatchRes.body.attemptsLeft === 4) {
        console.log('✅ Success: Database attempts incremented to 1, response shows 4 attempts left.');
      } else {
        console.log('❌ Failure: attempts state did not increment correctly.');
      }
    } else {
      console.log('❌ Failure: verify-otp mismatch returned status:', verifyMismatchRes.status, verifyMismatchRes.body);
    }

    // 7. Test: Verify OTP Expiry Handling
    console.log('\n--- TEST CASE 4: VERIFY OTP EXPIRY (Mechanic App) ---');
    // Artificially modify the otpGeneratedAt to be 11 minutes ago in DB
    await ServiceRequest.findByIdAndUpdate(serviceRequest._id, {
      $set: { otpGeneratedAt: new Date(Date.now() - 11 * 60 * 1000) }
    });
    console.log('[Mock Expiry] Artificially shifted otpGeneratedAt in DB by -11 minutes.');

    const verifyExpiredRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/verify-otp`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ otp: dbRequest1.arrivalOtp }); // correct OTP but expired

    if (verifyExpiredRes.status === 400 && verifyExpiredRes.body.message.includes('expired')) {
      console.log('✅ Success: verify-otp rejected expired OTP with HTTP 400 and expired message.');
      console.log('Response Message:', verifyExpiredRes.body.message);
    } else {
      console.log('❌ Failure: verify-otp did not handle expired code correctly. Status:', verifyExpiredRes.status, verifyExpiredRes.body);
    }

    // 8. Test: Resend OTP (Mark Arrived again)
    console.log('\n--- TEST CASE 5: RESEND OTP (Mechanic App) ---');
    const resendRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/mark-arrived`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send();

    const dbRequest3 = await ServiceRequest.findById(serviceRequest._id);
    console.log('[DB Verify] New OTP in DB:', dbRequest3.arrivalOtp);
    console.log('[DB Verify] Attempts reset in DB:', dbRequest3.otpAttempts);
    console.log('[DB Verify] New Generated At in DB:', dbRequest3.otpGeneratedAt);

    if (dbRequest3.arrivalOtp !== dbRequest1.arrivalOtp && dbRequest3.otpAttempts === 0) {
      console.log('✅ Success: Resending regenerated a new OTP and reset attempts to 0.');
    } else {
      console.log('❌ Failure: Resending did not regenerate or reset attempts properly.');
    }

    // 9. Test: Verify OTP Max Attempt Lockout
    console.log('\n--- TEST CASE 6: MAX ATTEMPT LOCKOUT (Mechanic App) ---');
    // Artificially set attempts to 5 in DB
    await ServiceRequest.findByIdAndUpdate(serviceRequest._id, { $set: { otpAttempts: 5 } });
    console.log('[Mock Lockout] Artificially set otpAttempts to 5 in DB.');

    const verifyLockedRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/verify-otp`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ otp: dbRequest3.arrivalOtp }); // correct code but locked out

    if (verifyLockedRes.status === 400 && verifyLockedRes.body.message.includes('exceeded')) {
      console.log('✅ Success: verify-otp rejected request due to maximum attempts exceeded.');
      console.log('Response Message:', verifyLockedRes.body.message);
    } else {
      console.log('❌ Failure: verify-otp did not handle max attempt lockout. Status:', verifyLockedRes.status, verifyLockedRes.body);
    }

    // Reset attempts back to 0 for successful verification test
    await ServiceRequest.findByIdAndUpdate(serviceRequest._id, { $set: { otpAttempts: 0 } });

    // 10. Test: Successful OTP Matching and status change
    console.log('\n--- TEST CASE 7: SUCCESSFUL VERIFICATION (Mechanic App) ---');
    const verifySuccessRes = await request(app)
      .post(`/api/requests/${serviceRequest._id}/verify-otp`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ otp: dbRequest3.arrivalOtp }); // correct new OTP

    if (verifySuccessRes.status === 200) {
      console.log('✅ Success: verify-otp returned HTTP 200 for match.');
      console.log('Response Message:', verifySuccessRes.body.message);
      
      const dbRequest4 = await ServiceRequest.findById(serviceRequest._id);
      console.log('[DB Verify] Status in DB:', dbRequest4.status);
      console.log('[DB Verify] OTP Verified in DB:', dbRequest4.otpVerified);
      if (dbRequest4.status === 'work_in_progress' && dbRequest4.otpVerified === true) {
        console.log('✅ Success: Request status successfully set to "work_in_progress" and otpVerified = true.');
      } else {
        console.log('❌ Failure: Final request status or otpVerified in DB is incorrect.');
      }
    } else {
      console.log('❌ Failure: verify-otp match returned status:', verifySuccessRes.status, verifySuccessRes.body);
    }

  } catch (error) {
    console.error('Test execution failed with crash:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n[DB] Database connection closed.');
    console.log('--- TEST RUN COMPLETED ---');
  }
}

runTest();
