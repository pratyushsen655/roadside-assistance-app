const express = require('express');
const { getMyReferralInfo, applyReferralCode } = require('../controllers/referralController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// All referral routes require JWT auth
router.use(authMiddleware);

router.get('/my-code', getMyReferralInfo);
router.post('/apply', applyReferralCode);

module.exports = router;
