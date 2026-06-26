const User = require('../models/User');

// GET /api/auth/profile
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'name email phone avatar vehicleMake vehicleModel vehicleYear referralCode referralEarnings'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// PUT /api/auth/profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, vehicleMake, vehicleModel, vehicleYear, avatar } = req.body;

    const allowedUpdates = {};
    if (name !== undefined) allowedUpdates.name = name;
    if (phone !== undefined) allowedUpdates.phone = phone;
    if (vehicleMake !== undefined) allowedUpdates.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) allowedUpdates.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined) allowedUpdates.vehicleYear = vehicleYear;
    if (avatar !== undefined) allowedUpdates.avatar = avatar;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    ).select('name email phone avatar vehicleMake vehicleModel vehicleYear referralCode referralEarnings');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, message: 'Profile updated successfully', user });
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, updateProfile };
