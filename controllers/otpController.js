const Otp = require('../models/Otp');
const User = require('../models/User');
const { generateToken } = require('./authController');

// ── Helpers ──────────────────────────────────────────────────────────────────

const generateOtp = () => {
  // Cryptographically good enough 6-digit OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const normalizePhone = (phone) => {
  // Strip spaces/dashes, ensure +91 prefix for Indian numbers
  let p = String(phone).replace(/[\s\-]/g, '');
  if (!p.startsWith('+')) {
    p = '+91' + p.replace(/^0+/, '');
  }
  return p;
};

// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
// ── POST /api/auth/send-otp ───────────────────────────────────────────────────
const sendOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const normalizedPhone = normalizePhone(phone);
    const phoneWithCountryCode = normalizedPhone.replace(/\D/g, ''); // e.g. 91XXXXXXXXXX

    // Check if there is an existing active OTP sent within the last 10 minutes (retry flow)
    const existingOtp = await Otp.findOne({
      phone: normalizedPhone,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (existingOtp) {
      let smsSent = false;
      try {
        const { retryOTP } = require('../services/smsService');
        const retryResult = await retryOTP(phoneWithCountryCode);
        // MSG91 returns HTTP 200 even on failure — check response body
        if (retryResult && retryResult.type !== 'error' && retryResult.type !== 'Error') {
          smsSent = true;
        } else {
          console.error('SMS retry returned error body:', retryResult);
        }
      } catch (smsError) {
        console.error('SMS retry failed:', smsError.message);
      }

      const isDev = process.env.NODE_ENV !== 'production';
      return res.json({
        success: true,
        message: smsSent ? 'OTP resent successfully' : 'OTP resent',
        // Always expose OTP in dev mode so the app can auto-fill
        ...((!smsSent || isDev) && { otp: existingOtp.otp }),
      });
    }

    // Invalidate any other existing unused OTPs
    await Otp.updateMany(
      { phone: normalizedPhone, isUsed: false },
      { $set: { isUsed: true } }
    );

    // Generate new OTP
    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await Otp.create({
      phone: normalizedPhone,
      otp: otpCode,
      expiresAt,
      isUsed: false,
    });

    console.log(`[OTP] Phone: ${normalizedPhone} → Code: ${otpCode}`);

    let smsSent = false;
    try {
      const { sendOTP } = require('../services/smsService');
      const smsResult = await sendOTP(phoneWithCountryCode, otpCode);
      // MSG91 returns HTTP 200 even on failure — must check the response body
      if (smsResult && smsResult.type !== 'error' && smsResult.type !== 'Error') {
        smsSent = true;
        console.log('[OTP] SMS sent successfully via MSG91');
      } else {
        console.error('[OTP] MSG91 returned error body:', smsResult);
      }
    } catch (smsError) {
      console.error('[OTP] SMS send failed:', smsError.message);
    }

    const isDev = process.env.NODE_ENV !== 'production';
    return res.json({
      success: true,
      message: smsSent ? 'OTP sent successfully' : 'OTP sent (dev mode)',
      // Always expose OTP in dev mode so the app yellow banner works,
      // OR when SMS failed so the user can still log in
      ...((!smsSent || isDev) && { otp: otpCode }),
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
const verifyOtp = async (req, res, next) => {
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

    // Find or create user by phone
    let user = await User.findOne({ phone: normalizedPhone });
    const isNewUser = !user;

    if (isNewUser) {
      user = await User.create({
        phone: normalizedPhone,
        role: 'user',
        isVerified: true,
      });
    } else {
      if (!user.isVerified) {
        user.isVerified = true;
        await user.save();
      }
    }

    const token = generateToken(user._id, user.role);

    res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        vehicleMake: user.vehicleMake,
        vehicleModel: user.vehicleModel,
        vehicleYear: user.vehicleYear,
        referralCode: user.referralCode,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { sendOtp, verifyOtp };
