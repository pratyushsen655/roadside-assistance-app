const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  uploadKYC,
  toggleAvailability,
  getEarnings
} = require('../controllers/mechanicController');

router.use(protect);

router.get('/profile', restrictTo('mechanic', 'admin'), getProfile);
router.put('/profile', restrictTo('mechanic'), updateProfile);
router.post('/kyc', restrictTo('mechanic'), uploadKYC);
router.put('/status', restrictTo('mechanic'), toggleAvailability);
router.get('/earnings', restrictTo('mechanic'), getEarnings);

module.exports = router;
