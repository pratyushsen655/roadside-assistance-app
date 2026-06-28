const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const pricingService = require('../services/pricingService');
const mapService = require('../services/mapService');
const aiService = require('../services/aiService');
const fcmService = require('../services/fcmService');
const socketHandler = require('../sockets/socketHandler');

/**
 * Generate 4-digit PIN for verification
 */
const generateStartOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// @desc    Create a breakdown service request
// @route   POST /api/requests
// @access  Private (Customer)
exports.createRequest = async (req, res, next) => {
  const {
    vehicleType,
    vehicleModel,
    issueDescription,
    imageUrl,
    latitude,
    longitude,
    customerAddress,
    bookingType,
    scheduledTime
  } = req.body;

  if (!vehicleType || !issueDescription || !latitude || !longitude) {
    return res.status(400).json({
      success: false,
      message: 'Please provide vehicle type, description, and location coordinates.'
    });
  }

  try {
    const user = await User.findById(req.user.id);
    
    if (user.activeRequestId) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active service request in progress.'
      });
    }

    // 1. Calculate pricing estimate
    // Look up count of online mechanics vs requests to evaluate surge modifier
    const onlineMechCount = await Mechanic.countDocuments({ status: 'online' });
    const pendingReqCount = await ServiceRequest.countDocuments({ status: 'pending' });
    
    // For estimate, assume distance is 0 initially (or estimate from nearest mechanic)
    let estimateDistance = 2; // default 2km estimate if no mechanic assigned yet
    
    // Find closest mechanic to get a realistic distance estimate
    const closestMechanic = await Mechanic.findOne({
      status: 'online',
      vehicleSpecializations: vehicleType,
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] }
        }
      }
    });

    if (closestMechanic) {
      const [mLon, mLat] = closestMechanic.location.coordinates;
      estimateDistance = mapService.calculateHaversineDistance(latitude, longitude, mLat, mLon);
    }

    const fareEstimate = pricingService.calculateFare(
      vehicleType,
      estimateDistance,
      pendingReqCount + 1,
      onlineMechCount
    );

    const startOTP = generateStartOTP();

    // 2. Create the Request document
    const serviceRequest = new ServiceRequest({
      customer: req.user.id,
      vehicleType,
      vehicleModel: vehicleModel || '',
      issueDescription,
      imageUrl: imageUrl || '',
      customerLocation: {
        type: 'Point',
        coordinates: [longitude, latitude], // GeoJSON longitude first
      },
      customerAddress: customerAddress || '',
      pricing: fareEstimate,
      startOTP,
      bookingType: bookingType || 'instant',
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null
    });

    await serviceRequest.save();

    // 3. Link user activeRequestId
    user.activeRequestId = serviceRequest._id;
    await user.save();

    // 4. Trigger Real-time broadcasts if booking is INSTANT
    if (serviceRequest.bookingType === 'instant') {
      // Find matches using AI scoring service — hard 4 km radius (same as feed endpoint)
      const optimalMatches = await aiService.findOptimalMechanics(serviceRequest, 4);
      
      // Get all fcmTokens and socketIds of mechanics
      const mechanicTokens = [];
      
      optimalMatches.forEach(match => {
        const mechId = match.mechanic._id.toString();
        // Emit Socket event to online matches
        socketHandler.sendToMechanic(mechId, 'new_breakdown_request', {
          requestId: serviceRequest._id,
          vehicleType: serviceRequest.vehicleType,
          vehicleModel: serviceRequest.vehicleModel,
          issueDescription: serviceRequest.issueDescription,
          distanceKm: match.distanceKm,
          estimatedFare: serviceRequest.pricing.totalAmount,
          customerLocation: { latitude, longitude }
        });

        if (match.mechanic.fcmToken) {
          mechanicTokens.push(match.mechanic.fcmToken);
        }
      });

      // Send push notification to mechanics
      if (mechanicTokens.length > 0) {
        await fcmService.sendMulticastNotification(
          mechanicTokens,
          'New Breakdown Alert!',
          `A ${vehicleType} needs roadside assistance nearby: "${issueDescription.substring(0, 40)}..."`,
          { requestId: serviceRequest._id.toString() }
        );
      }

      // Notify admins
      socketHandler.sendToAdmins('admin_new_request', {
        requestId: serviceRequest._id,
        customerName: user.name || 'Customer',
        vehicleType,
        location: { latitude, longitude }
      });
    }

    res.status(201).json({
      success: true,
      data: serviceRequest,
      message: serviceRequest.bookingType === 'instant' 
        ? 'Request created. Pinging nearby mechanics.'
        : 'Request scheduled successfully.'
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get active request details for logged in user/mechanic
// @route   GET /api/requests/active
// @access  Private (Customer/Mechanic)
exports.getActiveRequest = async (req, res, next) => {
  const role = req.authInfo.role;
  const userId = req.user.id;

  try {
    let query = {};
    if (role === 'mechanic') {
      query = { mechanic: userId, status: { $nin: ['completed', 'cancelled'] } };
    } else {
      query = { customer: userId, status: { $nin: ['completed', 'cancelled'] } };
    }

    const request = await ServiceRequest.findOne(query)
      .populate('customer', 'name phone avatar')
      .populate('mechanic', 'name phone avatar averageRating vehicleSpecializations location');

    if (!request) {
      return res.status(200).json({ success: true, data: null, message: 'No active requests found.' });
    }

    // Safeguard: Ensure startOTP is generated and saved if missing
    if (!request.startOTP) {
      request.startOTP = Math.floor(1000 + Math.random() * 9000).toString();
      await request.save();
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    next(error);
  }
};

// @desc    Get nearby breakdown requests (for Mechanic feed)
// @route   GET /api/requests/nearby
// @access  Private (Mechanic)
exports.getNearbyRequests = async (req, res, next) => {
  try {
    const mechanic = await Mechanic.findById(req.user.id);
    if (!mechanic || mechanic.status !== 'online') {
      return res.status(400).json({ success: false, message: 'Mechanic must be online to fetch requests feed.' });
    }

    const [lon, lat] = mechanic.location.coordinates;

    // Fetch requests: pending, vehicle type matches specialization, not rejected by this mechanic, within 10km
    const requests = await ServiceRequest.find({
      status: 'pending',
      bookingType: 'instant',
      vehicleType: { $in: mechanic.vehicleSpecializations },
      rejectedBy: { $ne: mechanic._id },
      customerLocation: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lon, lat] },
          $maxDistance: 10000 // 10km
        }
      }
    }).populate('customer', 'name avatar');

    // Calculate distances for feed mapping
    const formattedRequests = requests.map(reqDoc => {
      const [cLon, cLat] = reqDoc.customerLocation.coordinates;
      const distanceKm = parseFloat(mapService.calculateHaversineDistance(lat, lon, cLat, cLon).toFixed(2));
      return {
        ...reqDoc.toObject(),
        distanceKm
      };
    });

    res.status(200).json({ success: true, count: formattedRequests.length, data: formattedRequests });
  } catch (error) {
    next(error);
  }
};

// @desc    Mechanic accepts breakdown request
// @route   PUT /api/requests/:id/accept
// @access  Private (Mechanic)
exports.acceptRequest = async (req, res, next) => {
  const requestId = req.params.id;
  const mechanicId = req.user.id;

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Breakdown request not found.' });
    }

    if (request.status !== 'pending' && request.status !== 'assigned') {
      return res.status(400).json({ success: false, message: 'Request is no longer available. Already accepted by another mechanic.' });
    }

    const mechanic = await Mechanic.findById(mechanicId).populate('userId');
    if (mechanic.activeRequestId) {
      return res.status(400).json({ success: false, message: 'You already have another active request in progress.' });
    }

    // 1. Calculate actual route metrics from mechanic to customer location
    const origin = mechanic.location.coordinates; // [lon, lat]
    const destination = request.customerLocation.coordinates; // [lon, lat]
    const route = await mapService.getRouteDetails(origin, destination);

    // 2. Re-calculate dynamic fare with actual distance details
    const pendingReqCount = await ServiceRequest.countDocuments({ status: 'pending' });
    const onlineMechCount = await Mechanic.countDocuments({ status: 'online' });
    
    const finalFare = pricingService.calculateFare(
      request.vehicleType,
      route.distanceKm,
      pendingReqCount,
      onlineMechCount
    );

    // 3. Update Service Request
    request.mechanic = mechanicId;
    request.status = 'accepted';
    request.mechanicLocationAtAcceptance = {
      type: 'Point',
      coordinates: origin
    };
    request.pricing = finalFare;
    await request.save();

    // 4. Update Mechanic status to busy
    mechanic.status = 'busy';
    mechanic.activeRequestId = requestId;
    await mechanic.save();

    // 5. Update Customer activeRequestId
    const customer = await User.findById(request.customer);
    customer.activeRequestId = requestId;
    await customer.save();

    // 6. Broadcast via Sockets to customer
    const mechanicUser = /** @type {any} */(mechanic.userId);

    socketHandler.sendToCustomer(request.customer.toString(), 'request_accepted', {
      requestId,
      pricing: request.pricing,
      etaMins: route.durationMins,
      distanceKm: route.distanceKm,
      mechanic: {
        _id: mechanic._id,
        name: mechanicUser.name,
        phone: mechanicUser.phone,
        avatar: mechanicUser.avatar,
        averageRating: mechanic.averageRating
      }
    });

    // Notify other mechanics who might be viewing this request to clear it
    socketHandler.getIo().emit('request_claimed', { requestId });

    // Send push notification to Customer
    if (customer.fcmToken) {
      await fcmService.sendPushNotification(
        customer.fcmToken,
        'Mechanic Assigned!',
        `${mechanicUser.name} is on the way to help you.`
      );
    }

    // Notify Admin Panel
    socketHandler.sendToAdmins('admin_request_accepted', {
      requestId,
      mechanicName: mechanicUser.name,
      mechanicId
    });

    res.status(200).json({
      success: true,
      message: 'Service request accepted. Head to client location.',
      data: request
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Mechanic rejects breakdown request
// @route   PUT /api/requests/:id/reject
// @access  Private (Mechanic)
exports.rejectRequest = async (req, res, next) => {
  const requestId = req.params.id;
  const mechanicId = req.user.id;

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    // Append mechanic to reject list so it's not shown again
    if (!request.rejectedBy.includes(mechanicId)) {
      request.rejectedBy.push(mechanicId);
      await request.save();
    }

    res.status(200).json({ success: true, message: 'Request rejected from your feed.' });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify customer start OTP and start work
// @route   POST /api/requests/:id/verify-start
// @access  Private (Mechanic)
exports.verifyStartOTP = async (req, res, next) => {
  const requestId = req.params.id;
  const { otp } = req.body;

  if (!otp) {
    return res.status(400).json({ success: false, message: 'Verification OTP code is required.' });
  }

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Breakdown request not found.' });
    }

    if (request.status !== 'arrived') {
      return res.status(400).json({ success: false, message: 'Cannot start work before arriving at the location.' });
    }

    if (request.startOTP !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid verification OTP code. Please ask the customer for the correct PIN.' });
    }

    request.status = 'work_in_progress';
    await request.save();

    // Broadcast socket event
    socketHandler.sendToCustomer(request.customer.toString(), 'work_started', {
      requestId,
      status: 'work_in_progress'
    });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now begin work.',
      data: request
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Update Request workflow status (on_the_way -> arrived -> completed)
// @route   PUT /api/requests/:id/status
// @access  Private (Mechanic)
exports.updateRequestStatus = async (req, res, next) => {
  const requestId = req.params.id;
  const { status } = req.body;
  const mechanicId = req.user.id;

  const validStatuses = ['on_the_way', 'arrived', 'completed'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid workflow status transition.' });
  }

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (request.mechanic.toString() !== mechanicId.toString()) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this service request.' });
    }

    // Check transition validity
    if (status === 'on_the_way' && request.status !== 'accepted') {
      return res.status(400).json({ success: false, message: 'Can only transition to on_the_way from accepted.' });
    }
    if (status === 'arrived' && request.status !== 'on_the_way') {
      return res.status(400).json({ success: false, message: 'Can only transition to arrived from on_the_way.' });
    }
    // Completed status can only follow work_in_progress
    if (status === 'completed' && request.status !== 'work_in_progress') {
      return res.status(400).json({ success: false, message: 'Cannot complete service before starting. Please verify the customer OTP PIN first.' });
    }

    request.status = status;
    
    if (status === 'completed') {
      request.completedAt = new Date();
      request.paymentStatus = request.paymentMethod === 'cash' ? 'paid' : 'pending'; // Cash settles immediately
      
      // Update mechanic wallet earnings (80% commission split)
      const mechanic = await Mechanic.findById(mechanicId);
      const commissionSplit = 0.80;
      const creditAmount = Math.round(request.pricing.totalAmount * commissionSplit);
      
      const earnings = /** @type {any} */(mechanic.earnings);
      if (typeof earnings === 'number') {
        mechanic.earnings = earnings + creditAmount;
      } else if (earnings && typeof earnings.total === 'number') {
        earnings.total += creditAmount;
        mechanic.earnings = earnings;
      } else {
        mechanic.earnings = creditAmount;
      }
      mechanic.status = 'online'; // Return to online availability pool
      mechanic.activeRequestId = null;
      await mechanic.save();

      // Reset customer activeRequestId
      await User.findByIdAndUpdate(request.customer, { activeRequestId: null });
    }

    await request.save();

    // Broadcast status to customer
    socketHandler.sendToCustomer(request.customer.toString(), 'request_status_update', {
      requestId,
      status: request.status,
      paymentStatus: request.paymentStatus
    });

    // Notify admins
    socketHandler.sendToAdmins('admin_request_status_update', {
      requestId,
      status: request.status
    });

    res.status(200).json({
      success: true,
      message: `Workflow transitioned successfully to ${status}.`,
      data: request
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Cancel request
// @route   PUT /api/requests/:id/cancel
// @access  Private (Customer/Mechanic/Admin)
exports.cancelRequest = async (req, res, next) => {
  const requestId = req.params.id;
  const role = req.authInfo.role;
  const userId = req.user.id;
  const { cancellationReason } = req.body;
  console.log('[Cancel Controller Entry] cancelRequest initiated. Request ID:', requestId, 'User ID:', userId, 'Role:', role);

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Service request not found.' });
    }

    if (['completed', 'cancelled'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Request is already completed or cancelled.' });
    }

    // Verify cancellation rights
    if (role === 'customer' && request.customer.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized cancellation request.' });
    }
    if (role === 'mechanic' && request.mechanic.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized cancellation request.' });
    }

    // Cancel workflow
    request.status = 'cancelled';
    request.cancelledBy = role;
    request.cancellationReason = cancellationReason || 'No reason provided';
    await request.save();
    console.log('[Cancel Controller DB Update] Request status updated to cancelled. Request ID:', request._id);

    // Release customer
    await User.findByIdAndUpdate(request.customer, { activeRequestId: null });

    // Release mechanic if assigned
    if (request.mechanic) {
      await Mechanic.findByIdAndUpdate(request.mechanic, {
        status: 'online',
        activeRequestId: null
      });
      // Notify mechanic
      console.log('[Cancel Controller Emit Mechanic] Emitting request_cancelled to mechanic:', request.mechanic.toString());
      socketHandler.sendToMechanic(request.mechanic.toString(), 'request_cancelled', {
        requestId,
        cancelledBy: role,
        reason: request.cancellationReason
      });
    }

    // Notify customer
    console.log('[Cancel Controller Emit Customer] Emitting request_cancelled to customer user room:', `user:${request.customer.toString()}`);
    socketHandler.sendToCustomer(request.customer.toString(), 'request_cancelled', {
      requestId,
      cancelledBy: role,
      reason: request.cancellationReason
    });

    // Notify admins
    socketHandler.sendToAdmins('admin_request_cancelled', {
      requestId,
      cancelledBy: role,
      reason: request.cancellationReason
    });

    res.status(200).json({
      success: true,
      message: 'Service request cancelled successfully.',
      data: request
    });

  } catch (error) {
    console.error('[Cancel Controller Error] Error in cancelRequest:', error.message);
    next(error);
  }
};

// @desc    Get Request History list
// @route   GET /api/requests/history
// @access  Private (Customer/Mechanic)
exports.getRequestHistory = async (req, res, next) => {
  const role = req.authInfo.role;
  const userId = req.user.id;

  try {
    let query = {};
    if (role === 'mechanic') {
      query = { mechanic: userId };
    } else {
      query = { customer: userId };
    }

    const history = await ServiceRequest.find(query)
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (error) {
    next(error);
  }
};
