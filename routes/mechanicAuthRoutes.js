const express = require('express');
const jwt = require('jsonwebtoken');
const Mechanic = require('../models/Mechanic');
const Otp = require('../models/Otp');

const otpRateLimiter = require('../middleware/otpRateLimiter');

const router = express.Router();

const normalizePhone = (phone) => {
  // Strip spaces/dashes, ensure +91 prefix for Indian numbers
  let p = String(phone).replace(/[\s\-]/g, '');
  if (!p.startsWith('+')) {
    p = '+91' + p.replace(/^0+/, '');
  }
  return p;
};

// @desc    Send OTP to mechanic
// @route   POST /api/mechanic/auth/send-otp
// @access  Public
router.post('/send-otp', otpRateLimiter, async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneWithCountryCode = normalizedPhone.replace(/\D/g, '');

    // Check if there is an existing active OTP sent within the last 10 minutes (retry flow)
    const existingOtp = await Otp.findOne({
      phone: normalizedPhone,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (existingOtp) {
      try {
        const { retryOTP } = require('../services/smsService');
        await retryOTP(phoneWithCountryCode);
        return res.json({
          success: true,
          message: 'OTP resent successfully'
        });
      } catch (smsError) {
        console.error('SMS retry failed:', smsError.message);
        // Fallback for dev/testing
        return res.json({
          success: true,
          message: 'OTP resent',
          otp: existingOtp.otp,
          smsError: smsError.message
        });
      }
    }

    // Invalidate any other existing unused OTPs
    await Otp.updateMany(
      { phone: normalizedPhone, isUsed: false },
      { $set: { isUsed: true } }
    );

    // Generate new 6-digit OTP
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await Otp.create({
      phone: normalizedPhone,
      otp: generatedOtp,
      expiresAt,
      isUsed: false,
    });

    console.log(`[Mechanic OTP] Phone: ${normalizedPhone} → Code: ${generatedOtp}`);

    try {
      const { sendOTP } = require('../services/smsService');
      await sendOTP(phoneWithCountryCode, generatedOtp);
      return res.json({
        success: true,
        message: 'OTP sent successfully'
      });
    } catch (smsError) {
      console.error('SMS failed:', smsError.message);
      // Fallback
      return res.json({
        success: true,
        message: 'OTP sent',
        otp: generatedOtp,
        smsError: smsError.message
      });
    }
  } catch (error) {
    next(error);
  }
});

// @desc    Verify mechanic OTP and login/register
// @route   POST /api/mechanic/auth/verify-otp
// @access  Public
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneWithCountryCode = normalizedPhone.replace(/\D/g, '');

    // Find the most recent valid OTP
    const otpRecord = await Otp.findOne({
      phone: normalizedPhone,
      otp: String(otp).trim(),
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.',
      });
    }

    // After DB validation, optionally call MSG91 verify as double check
    try {
      const { verifyOTPviaMSG91 } = require('../services/smsService');
      await verifyOTPviaMSG91(phoneWithCountryCode, String(otp).trim());
    } catch (msg91Err) {
      console.warn('MSG91 OTP verification double-check failed (ignored for local fallback):', msg91Err.message);
    }

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Find or create mechanic by phone
    let mechanic = await Mechanic.findOne({ phone: normalizedPhone });
    const isNewMechanic = !mechanic;

    if (isNewMechanic) {
      mechanic = await Mechanic.create({
        phone: normalizedPhone,
        name: 'Mechanic',
        isOnline: false,
        rating: 5,
        totalJobs: 0,
        earnings: 0
      });
    }

    // Generate JWT token with { id, phone, role: 'mechanic' }
    const token = jwt.sign(
      { id: mechanic._id, phone: mechanic.phone, role: 'mechanic' },
      process.env.JWT_SECRET || 'fallback_secret_change_in_env',
      { expiresIn: /** @type {any} */ (process.env.JWT_EXPIRY || '7d') }
    );

    res.status(200).json({
      success: true,
      token,
      mechanic,
      isNewMechanic
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
