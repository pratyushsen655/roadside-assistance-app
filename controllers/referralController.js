const User = require('../models/User');
const Referral = require('../models/Referral');

// GET /api/referrals/my-code
const getMyReferralInfo = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'referralCode referralEarnings referredBy'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const referrals = await Referral.find({ referrerId: req.user.id })
      .populate('referredUserId', 'name email createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const totalReferrals = referrals.length;
    const totalEarnings = referrals.reduce((sum, r) => sum + r.earnings, 0);
    const pendingEarnings = referrals
      .filter((r) => r.status === 'pending')
      .reduce((sum, r) => sum + r.earnings, 0);
    const paidEarnings = referrals
      .filter((r) => r.status === 'paid')
      .reduce((sum, r) => sum + r.earnings, 0);

    const appLink = `https://play.google.com/store/apps/details?id=com.praty.roadsideassist&referral=${user.referralCode}`;
    const shareMessage = `🚗 Stranded on the road? Get instant mechanic help!\n\n📲 Download RescueMe app:\n${appLink}\n\n🎁 Use my referral code *${user.referralCode}* at signup to get ₹30 off your first service!\n\n🔧 Fast • Reliable • 24/7 Roadside Assistance`;

    res.status(200).json({
      success: true,
      referralCode: user.referralCode,
      referredBy: user.referredBy,
      totalReferrals,
      totalEarnings,
      pendingEarnings,
      paidEarnings,
      referrals,
      shareMessage,
      appLink
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/referrals/apply
const applyReferralCode = async (req, res, next) => {
  try {
    const { referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({ success: false, message: 'referralCode is required' });
    }

    // Find the referrer
    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase().trim() });
    if (!referrer) {
      return res.status(404).json({ success: false, message: 'Invalid referral code' });
    }

    // Cannot refer yourself
    if (referrer._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot use your own referral code' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if user already has been referred
    if (currentUser.referredBy) {
      return res.status(400).json({ success: false, message: 'A referral code has already been applied to your account' });
    }

    // Check if this referral already exists
    const existingReferral = await Referral.findOne({
      referrerId: referrer._id,
      referredUserId: req.user.id,
    });
    if (existingReferral) {
      return res.status(400).json({ success: false, message: 'Referral already recorded' });
    }

    // Create referral record
    await Referral.create({
      referrerId: referrer._id,
      referredUserId: req.user.id,
      earnings: 1000,
      status: 'pending',
    });

    // Credit the referrer
    await User.findByIdAndUpdate(referrer._id, {
      $inc: { referralEarnings: 1000 },
    });

    // Link referredBy on current user
    await User.findByIdAndUpdate(req.user.id, {
      $set: { referredBy: referrer._id },
    });

    res.status(200).json({
      success: true,
      message: `Referral applied! ₹1000 has been credited to ${referrer.name}'s account.`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMyReferralInfo, applyReferralCode };
