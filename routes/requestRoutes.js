const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { body, param } = require('express-validator');
const validate = require('../middleware/validationMiddleware');
const {
  createRequest,
  getActiveRequest,
  getNearbyRequests,
  acceptRequest,
  rejectRequest,
  verifyStartOTP,
  updateRequestStatus,
  cancelRequest,
  getRequestHistory
} = require('../controllers/requestController');

router.use(protect);

router.post('/',
  restrictTo('customer'),
  [
    body('vehicleType').notEmpty().withMessage('Vehicle type is required'),
    body('latitude').isFloat().withMessage('Valid latitude required'),
    body('longitude').isFloat().withMessage('Valid longitude required'),
    body('issueDescription').notEmpty().withMessage('Issue description required')
  ],
  validate,
  createRequest);
router.get('/active', restrictTo('customer', 'mechanic'), getActiveRequest);
router.get('/nearby', restrictTo('mechanic'), getNearbyRequests);
router.put('/:id/accept', restrictTo('mechanic'), acceptRequest);
router.put('/:id/reject', restrictTo('mechanic'), rejectRequest);
router.post('/:id/verify-start', restrictTo('mechanic'), verifyStartOTP);
router.put('/:id/status',
  restrictTo('mechanic'),
  [
    param('id').isMongoId().withMessage('Invalid request ID'),
    body('status').isIn(['on_the_way', 'arrived', 'completed']).withMessage('Invalid status')
  ],
  validate,
  updateRequestStatus);
router.put('/:id/cancel',
  restrictTo('customer', 'mechanic', 'admin'),
  [param('id').isMongoId().withMessage('Invalid request ID')],
  validate,
  cancelRequest);
router.get('/history', restrictTo('customer', 'mechanic'), getRequestHistory);

module.exports = router;
