const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validationMiddleware');
const otpRateLimiter = require('../middleware/otpRateLimiter');
const {
  requestCustomerOTP,
  verifyCustomerOTP,
  registerMechanic,
  requestMechanicOTP,
  verifyMechanicOTP
} = require('../controllers/authController');

// Customer Auth Routes
router.post('/customer/otp', [body('phone').isMobilePhone('any').withMessage('Invalid phone number')], validate, otpRateLimiter, requestCustomerOTP);
router.post('/customer/verify', [body('phone').isMobilePhone('any').withMessage('Invalid phone number'), body('otp').isLength({ min: 4, max: 4 }).withMessage('OTP must be 4 digits')], validate, verifyCustomerOTP);

// Mechanic Auth Routes
router.post('/mechanic/register', [body('name').notEmpty().withMessage('Name required'), body('email').isEmail().withMessage('Valid email required'), body('phone').isMobilePhone('any').withMessage('Invalid phone number')], validate, registerMechanic);
router.post('/mechanic/otp', [body('phone').isMobilePhone('any').withMessage('Invalid phone number')], validate, otpRateLimiter, requestMechanicOTP);
router.post('/mechanic/verify', [body('phone').isMobilePhone('any').withMessage('Invalid phone number'), body('otp').isLength({ min: 4, max: 4 }).withMessage('OTP must be 4 digits')], validate, verifyMechanicOTP);

module.exports = router;
