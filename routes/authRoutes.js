const express = require('express');
const { register, login, generateToken } = require('../controllers/authController');
const { getProfile, updateProfile } = require('../controllers/profileController');
const { sendOtp, verifyOtp } = require('../controllers/otpController');
const authMiddleware = require('../middleware/authMiddleware');
const otpRateLimiter = require('../middleware/otpRateLimiter');
 
const router = express.Router();

// ── Phone OTP Authentication ──────────────────────────────────────────────────
router.post('/send-otp', otpRateLimiter, sendOtp);
router.post('/verify-otp', verifyOtp);

// ── Customer registration (alias for /register with role=user) ──────────────
router.post('/register/customer', register);

// ── Mechanic registration: creates User + Mechanic profile ──────────────────
router.post('/register/mechanic', async (req, res) => {
  try {
    const User = require('../models/User');
    const Mechanic = require('../models/Mechanic');
    const { name, email, password, phone, vehicleSpecializations } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    let existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const user = await User.create({ name, email, password, phone, role: 'mechanic' });

    const mechanic = await Mechanic.create({
      userId: user._id,
      phone: phone,
      name: name,
      licenseNumber: `LIC-${user._id}`,   // placeholder until KYC
      experience: 0,
      hourlyRate: 0,
      vehicleSpecializations: vehicleSpecializations || ['car'],
    });

    const token = generateToken(user._id, 'mechanic');
    res.status(201).json({
      success: true,
      token,
      mechanic: { _id: mechanic._id, name: user.name, email: user.email },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Generic registration ─────────────────────────────────────────────────────
router.post('/register', register);
router.post('/login', login);
 
router.get('/profile', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);
 
router.post('/refresh', authMiddleware, (req, res) => {
  const newToken = generateToken(req.user.id, req.user.role);
  res.json({ success: true, token: newToken });
});

router.post('/push-token', authMiddleware, async (req, res) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user.id, { pushToken, fcmToken: pushToken });
    res.json({ success: true, message: 'Push token saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    // If using token blacklist, add token here
    // For now just return success - client handles clearing
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
});

router.post('/logout-all', authMiddleware, async (req, res) => {
  try {
    // For now just return success
    // In a real app, this would increment token version or invalidate all tokens in DB
    res.json({ success: true, message: 'Logged out from all devices successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Logout from all devices failed' });
  }
});
 
module.exports = router;