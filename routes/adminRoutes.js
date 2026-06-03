const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const {
  getDashboardAnalytics,
  getLiveRequests,
  getLiveMechanics,
  manualAssign,
  verifyKYC,
  getMechanics,
  getCustomers,
  getPaymentsLog
} = require('../controllers/adminController');

// Lock down all routes to Admins
router.use(protect);
router.use(restrictTo('admin'));

router.get('/analytics', getDashboardAnalytics);
router.get('/requests/live', getLiveRequests);
router.get('/mechanics/live', getLiveMechanics);
router.post('/requests/assign', manualAssign);
router.post('/mechanics/:id/kyc', verifyKYC);
router.get('/mechanics', getMechanics);
router.get('/customers', getCustomers);
router.get('/payments', getPaymentsLog);

module.exports = router;
