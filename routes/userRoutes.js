const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  updateEmergencyContacts,
  triggerSOS
} = require('../controllers/userController');

// All routes here require verification
router.use(protect);

router.get('/profile', restrictTo('customer', 'admin'), getProfile);
router.put('/profile', restrictTo('customer'), updateProfile);
router.put('/emergency-contacts', restrictTo('customer'), updateEmergencyContacts);
router.post('/sos', restrictTo('customer'), triggerSOS);

module.exports = router;
