const Mechanic = require('../models/Mechanic');
const ServiceRequest = require('../models/ServiceRequest');

// @desc    Get Current Mechanic Profile
// @route   GET /api/mechanics/profile
// @access  Private (Mechanic/Admin)
exports.getProfile = async (req, res, next) => {
  try {
    const mechanic = await Mechanic.findById(req.user.id).select('-otp');
    res.status(200).json({ success: true, data: mechanic });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Mechanic Profile Details
// @route   PUT /api/mechanics/profile
// @access  Private (Mechanic)
exports.updateProfile = async (req, res, next) => {
  const { name, vehicleSpecializations, avatar } = req.body;
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (vehicleSpecializations !== undefined) updateData.vehicleSpecializations = vehicleSpecializations;
  if (avatar !== undefined) updateData.avatar = avatar;

  try {
    const mechanic = await Mechanic.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-otp');

    res.status(200).json({ success: true, data: mechanic });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload KYC Documents
// @route   POST /api/mechanics/kyc
// @access  Private (Mechanic)
exports.uploadKYC = async (req, res, next) => {
  const { docType, docUrl } = req.body;

  if (!docType || !docUrl) {
    return res.status(400).json({ success: false, message: 'Please provide document type and secure url.' });
  }

  try {
    const mechanic = await Mechanic.findById(req.user.id);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic account not found.' });
    }

    mechanic.kyc = {
      docType,
      docUrl,
      status: 'pending', // Reset verification state to pending upon document update
      rejectionReason: ''
    };

    await mechanic.save();

    res.status(200).json({
      success: true,
      message: 'KYC documents uploaded successfully. Your profile is undergoing verification.',
      data: mechanic.kyc
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle availability status (online/offline)
// @route   PUT /api/mechanics/status
// @access  Private (Mechanic)
exports.toggleAvailability = async (req, res, next) => {
  const { status } = req.body; // 'online' or 'offline'

  if (!status || !['online', 'offline'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status. Choose online or offline.' });
  }

  try {
    const mechanic = await Mechanic.findById(req.user.id);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found.' });
    }

    // Block changes if profile has not been approved
    if (mechanic.kyc.status !== 'approved' && status === 'online') {
      return res.status(403).json({
        success: false,
        message: 'Cannot toggle online status. Your KYC documents are pending approval or have been rejected.'
      });
    }

    // Do not toggle offline if mechanic is handling an active assignment
    if (mechanic.activeRequestId && status === 'offline') {
      return res.status(400).json({
        success: false,
        message: 'Cannot go offline while you have an active breakdown assignment in progress.'
      });
    }

    mechanic.status = status;
    await mechanic.save();

    res.status(200).json({
      success: true,
      message: `Status updated successfully to ${status}.`,
      data: { status: mechanic.status }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get Earnings Summary and breakdown history
// @route   GET /api/mechanics/earnings
// @access  Private (Mechanic)
exports.getEarnings = async (req, res, next) => {
  try {
    const mechanic = await Mechanic.findById(req.user.id);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found.' });
    }

    // Get list of completed jobs
    const completedRequests = await ServiceRequest.find({
      mechanic: req.user.id,
      status: 'completed'
    }).populate('customer', 'name phone').sort({ completedAt: -1 });

    res.status(200).json({
      success: true,
      earnings: mechanic.earnings,
      completedJobsCount: completedRequests.length,
      history: completedRequests
    });
  } catch (error) {
    next(error);
  }
};
