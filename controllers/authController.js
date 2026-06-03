const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const jwt = require('jsonwebtoken');
const smsService = require('../services/smsService');

/**
 * Generate a random 4-digit OTP
 */
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Generate JWT token
 */
const generateToken = (id, role) => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET || 'dev_jwt_secret_token_12345',
    { expiresIn: process.env.JWT_EXPIRY || '7d' }
  );
};

// @desc    Request OTP for Customer Login / Auto-Registration
// @route   POST /api/auth/customer/otp
// @access  Public
exports.requestCustomerOTP = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: 'Please provide a phone number.' });
  }

  try {
    let user = await User.findOne({ phone });

    // Auto register if user does not exist
    if (!user) {
      user = new User({ phone });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes valid
    await user.save();

    // Send SMS
    await smsService.sendOTP(phone, otp);

    res.status(200).json({
      success: true,
      message: `OTP sent successfully to ${phone}.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify Customer OTP and login
// @route   POST /api/auth/customer/verify
// @access  Public
exports.verifyCustomerOTP = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Please provide phone and OTP.' });
  }

  try {
    const user = await User.findOne({ phone });

    if (!user || user.otp !== otp || user.otpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    // Clear OTP details upon verification
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const token = generateToken(user._id, user.role);

    res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        emergencyContacts: user.emergencyContacts
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Register a new Mechanic (requires KYC submission later)
// @route   POST /api/auth/mechanic/register
// @access  Public
exports.registerMechanic = async (req, res, next) => {
  const { name, email, phone, vehicleSpecializations } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ success: false, message: 'Please provide all details (name, email, phone).' });
  }

  try {
    let existingMech = await Mechanic.findOne({ $or: [{ phone }, { email }] });
    if (existingMech) {
      return res.status(400).json({ success: false, message: 'Mechanic already registered with this phone/email.' });
    }

    const mechanic = new Mechanic({
      name,
      email,
      phone,
      vehicleSpecializations: vehicleSpecializations || ['car', 'bike']
    });

    await mechanic.save();

    res.status(201).json({
      success: true,
      message: 'Mechanic registered successfully. Please log in to complete your KYC.'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Request OTP for Mechanic Login
// @route   POST /api/auth/mechanic/otp
// @access  Public
exports.requestMechanicOTP = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: 'Please provide a phone number.' });
  }

  try {
    const mechanic = await Mechanic.findOne({ phone });

    if (!mechanic) {
      return res.status(404).json({
        success: false,
        message: 'No registered mechanic found with this phone number. Please register first.'
      });
    }

    const otp = generateOTP();
    mechanic.otp = otp;
    mechanic.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await mechanic.save();

    // Send SMS
    await smsService.sendOTP(phone, otp);

    res.status(200).json({
      success: true,
      message: `OTP sent successfully to ${phone}.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify Mechanic OTP and Login
// @route   POST /api/auth/mechanic/verify
// @access  Public
exports.verifyMechanicOTP = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Please provide phone and OTP.' });
  }

  try {
    const mechanic = await Mechanic.findOne({ phone });

    if (!mechanic || mechanic.otp !== otp || mechanic.otpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    // Reset OTP values
    mechanic.otp = null;
    mechanic.otpExpiry = null;
    await mechanic.save();

    const token = generateToken(mechanic._id, 'mechanic');

    res.status(200).json({
      success: true,
      token,
      mechanic: {
        _id: mechanic._id,
        phone: mechanic.phone,
        name: mechanic.name,
        email: mechanic.email,
        role: 'mechanic',
        avatar: mechanic.avatar,
        vehicleSpecializations: mechanic.vehicleSpecializations,
        kycStatus: mechanic.kyc.status,
        status: mechanic.status
      }
    });
  } catch (error) {
    next(error);
  }
};
