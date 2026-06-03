const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const smsService = require('../services/smsService');
const socketHandler = require('../sockets/socketHandler');

// @desc    Get Current Customer Profile
// @route   GET /api/users/profile
// @access  Private (Customer/Admin)
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-otp');
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Customer Profile details
// @route   PUT /api/users/profile
// @access  Private (Customer)
exports.updateProfile = async (req, res, next) => {
  const { name, email, avatar } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (avatar !== undefined) updateData.avatar = avatar;

  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-otp');

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update User Emergency Contacts
// @route   PUT /api/users/emergency-contacts
// @access  Private (Customer)
exports.updateEmergencyContacts = async (req, res, next) => {
  const { contacts } = req.body; // Array of { name, phone }

  if (!contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ success: false, message: 'Please provide contacts list as an array.' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { emergencyContacts: contacts } },
      { new: true, runValidators: true }
    ).select('-otp');

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Trigger SOS Emergency Broadcast
// @route   POST /api/users/sos
// @access  Private (Customer)
exports.triggerSOS = async (req, res, next) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ success: false, message: 'Current coordinates are required to trigger SOS.' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // 1. Update location coordinates in DB
    user.location = {
      type: 'Point',
      coordinates: [longitude, latitude],
    };
    await user.save();

    const locationLink = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    const sosMessage = `[EMERGENCY SOS] ${user.name || 'A customer'} (${user.phone}) has triggered an SOS alert. Location: ${locationLink}`;

    // 2. Dispatch SMS alert to emergency contacts list
    if (user.emergencyContacts && user.emergencyContacts.length > 0) {
      for (const contact of user.emergencyContacts) {
        await smsService.sendOTP(contact.phone, `ALERT: Breakdown emergency. Tracking link: ${locationLink}`);
      }
    }

    // 3. Broadcast SOS coordinates to nearby mechanics (within 5km)
    const nearbyMechanics = await Mechanic.find({
      status: 'online',
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          $maxDistance: 5000, // 5km
        },
      },
    });

    // Alert nearby mechanics via WebSocket
    nearbyMechanics.forEach(mechanic => {
      socketHandler.sendToMechanic(mechanic._id.toString(), 'emergency_sos_alert', {
        customerId: user._id,
        customerName: user.name || 'Anonymous User',
        customerPhone: user.phone,
        latitude,
        longitude,
        locationLink
      });
    });

    // Alert admins via WebSocket
    socketHandler.sendToAdmins('admin_sos_alert', {
      customerId: user._id,
      customerName: user.name || 'Anonymous User',
      customerPhone: user.phone,
      latitude,
      longitude,
      locationLink
    });

    res.status(200).json({
      success: true,
      message: 'SOS triggered. Alert notifications dispatched to emergency contacts and nearby mechanics.',
      notifiedMechanicsCount: nearbyMechanics.length
    });

  } catch (error) {
    next(error);
  }
};
