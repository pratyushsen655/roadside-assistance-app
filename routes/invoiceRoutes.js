const express = require('express');
const { generateInvoice, getHistory } = require('../controllers/invoiceController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Both routes require JWT authentication
router.use(authMiddleware);

router.get('/history', getHistory);
router.get('/:jobId', generateInvoice);

module.exports = router;
