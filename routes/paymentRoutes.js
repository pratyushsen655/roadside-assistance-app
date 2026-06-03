const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { processCheckout } = require('../controllers/paymentController');

router.use(protect);

router.post('/checkout', restrictTo('customer'), processCheckout);

module.exports = router;
