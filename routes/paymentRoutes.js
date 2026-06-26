const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

// POST /api/payments/create-order
router.post('/create-order', authMiddleware, paymentController.createOrder);
router.post('/create', authMiddleware, paymentController.createOrder);

// POST /api/payments/verify
router.post('/verify', authMiddleware, paymentController.verifyPayment);

// POST /api/payments/pay-cash
router.post('/pay-cash', authMiddleware, paymentController.payCash);

// GET /api/payments/history
router.post('/history', authMiddleware, paymentController.getHistory); // support both or get
router.get('/history', authMiddleware, paymentController.getHistory);

module.exports = router;
