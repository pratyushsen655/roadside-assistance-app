const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const ServiceRequest = require('../models/ServiceRequest');
const Payment = require('../models/Payment');
const socketHandler = require('../sockets/socketHandler');
const fcmService = require('../services/fcmService');

// @desc    Get dashboard metrics and counts
// @route   GET /api/admin/analytics
// @access  Private (Admin Only)
exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    const totalMechanics = await Mechanic.countDocuments({});
    const activeRequests = await ServiceRequest.countDocuments({ status: { $nin: ['completed', 'cancelled'] } });
    const completedRequests = await ServiceRequest.countDocuments({ status: 'completed' });
    
    // Calculate total revenue
    const payments = await Payment.find({ paymentStatus: 'success' });
    const totalRevenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

    // Get booking distribution by vehicle type
    const carBookings = await ServiceRequest.countDocuments({ vehicleType: 'car' });
    const bikeBookings = await ServiceRequest.countDocuments({ vehicleType: 'bike' });

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        totalMechanics,
        activeRequests,
        completedRequests,
        totalRevenue,
        bookingsDistribution: { car: carBookings, bike: bikeBookings }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all active service requests for the admin live map
// @route   GET /api/admin/requests/live
// @access  Private (Admin Only)
exports.getLiveRequests = async (req, res, next) => {
  try {
    const activeRequests = await ServiceRequest.find({
      status: { $nin: ['completed', 'cancelled'] }
    })
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone location');

    res.status(200).json({ success: true, count: activeRequests.length, data: activeRequests });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all online/busy mechanics for the admin live map
// @route   GET /api/admin/mechanics/live
// @access  Private (Admin Only)
exports.getLiveMechanics = async (req, res, next) => {
  try {
    const mechanics = await Mechanic.find({
      status: { $in: ['online', 'busy'] }
    }).select('-otp');

    res.status(200).json({ success: true, count: mechanics.length, data: mechanics });
  } catch (error) {
    next(error);
  }
};

// @desc    Manually assign a mechanic to a request (overrides auto suggestion)
// @route   POST /api/admin/requests/assign
// @access  Private (Admin Only)
exports.manualAssign = async (req, res, next) => {
  const { requestId, mechanicId } = req.body;

  if (!requestId || !mechanicId) {
    return res.status(400).json({ success: false, message: 'Please provide request ID and mechanic ID.' });
  }

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Breakdown request not found.' });
    }

    if (['completed', 'cancelled'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Request is already finalized.' });
    }

    const mechanic = await Mechanic.findById(mechanicId);
    if (!mechanic || mechanic.status !== 'online') {
      return res.status(400).json({ success: false, message: 'Selected mechanic is either offline or currently busy.' });
    }

    // Assign
    request.mechanic = mechanicId;
    request.status = 'assigned'; // Waiting for mechanic response
    await request.save();

    // Trigger direct socket events to mechanic
    socketHandler.sendToMechanic(mechanicId.toString(), 'admin_assigned_request', {
      requestId: request._id,
      vehicleType: request.vehicleType,
      issueDescription: request.issueDescription,
      customerLocation: {
        latitude: request.customerLocation.coordinates[1],
        longitude: request.customerLocation.coordinates[0],
      },
      customerAddress: request.customerAddress
    });

    // Notify customer
    socketHandler.sendToCustomer(request.customer.toString(), 'request_status_update', {
      requestId: request._id,
      status: 'assigned',
      message: 'Admin is assigning a mechanic to your location.'
    });

    res.status(200).json({
      success: true,
      message: 'Mechanic assigned successfully. Awaiting acceptance.',
      data: request
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Verify/Approve KYC status of mechanics
// @route   POST /api/admin/mechanics/:id/kyc
// @access  Private (Admin Only)
exports.verifyKYC = async (req, res, next) => {
  const mechanicId = req.params.id;
  const { status, rejectionReason } = req.body; // 'approved' or 'rejected'

  if (!status || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Provide verification status: approved or rejected.' });
  }

  try {
    const mechanic = await Mechanic.findById(mechanicId);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found.' });
    }

    mechanic.kyc.status = status;
    if (status === 'rejected') {
      mechanic.kyc.rejectionReason = rejectionReason || 'KYC documents invalid or unreadable.';
      mechanic.status = 'offline';
    } else {
      mechanic.kyc.rejectionReason = '';
    }

    await mechanic.save();

    // Send push notification or SMS alert to mechanic
    if (mechanic.fcmToken) {
      await fcmService.sendPushNotification(
        mechanic.fcmToken,
        'KYC Profile Update',
        `Your verification documents have been ${status}.`
      );
    }

    res.status(200).json({
      success: true,
      message: `KYC updated successfully to ${status}.`,
      data: mechanic
    });

  } catch (error) {
    next(error);
  }
};

// @desc    List all mechanics
// @route   GET /api/admin/mechanics
// @access  Private (Admin Only)
exports.getMechanics = async (req, res, next) => {
  try {
    const list = await Mechanic.find({}).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: list.length, data: list });
  } catch (error) {
    next(error);
  }
};

// @desc    List all customers
// @route   GET /api/admin/customers
// @access  Private (Admin Only)
exports.getCustomers = async (req, res, next) => {
  try {
    const list = await User.find({ role: 'customer' }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: list.length, data: list });
  } catch (error) {
    next(error);
  }
};

// @desc    List all payments
// @route   GET /api/admin/payments
// @access  Private (Admin Only)
exports.getPaymentsLog = async (req, res, next) => {
  try {
    const log = await Payment.find({})
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: log.length, data: log });
  } catch (error) {
    next(error);
  }
};
