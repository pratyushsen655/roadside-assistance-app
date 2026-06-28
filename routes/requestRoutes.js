const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const ServiceRequest = require('../models/ServiceRequest');
const Mechanic = require('../models/Mechanic');
const User = require('../models/User');

const router = express.Router();

// 1. Create a service request
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      serviceType,
      description,
      issueDescription,
      vehicleType,
      vehicleModel,
      vehicleNumber,
      location,
      customerLocation,
      customerAddress
    } = req.body;

    const finalIssueDescription = issueDescription || description;
    const finalLocation = customerLocation || location;

    let finalServiceType = serviceType;
    if (finalServiceType === 'tire_repair') {
      finalServiceType = 'flat_tire';
    } else if (finalServiceType === 'battery') {
      finalServiceType = 'battery_jump';
    } else if (finalServiceType === 'lock_out') {
      finalServiceType = 'other';
    }

    let finalVehicleType = vehicleType;
    if (finalVehicleType === 'e-vehicle') {
      finalVehicleType = 'ev';
    }

    let geoJsonLocation = finalLocation;
    if (!geoJsonLocation && req.body.latitude !== undefined && req.body.longitude !== undefined) {
      geoJsonLocation = {
        type: 'Point',
        coordinates: [Number(req.body.longitude), Number(req.body.latitude)]
      };
    }

    if (!geoJsonLocation && customerAddress) {
      try {
        const { geocodeAddress } = require('../services/mapService');
        const coords = await geocodeAddress(customerAddress);
        if (coords) {
          geoJsonLocation = {
            type: 'Point',
            coordinates: coords
          };
        }
      } catch (err) {
        console.error('[Geocode Address Error]', err.message);
      }
    }

    if (!geoJsonLocation) {
      geoJsonLocation = {
        type: 'Point',
        coordinates: [77.2090, 28.6139] // standard default coordinates
      };
    }

    // Calculate distance and dynamic surcharge/totalPrice
    const { calculateHaversineDistance } = require('../services/mapService');
    const { calculateServicePrice } = require('../config/constants');

    let distanceKm = 0;
    const [cLng, cLat] = geoJsonLocation.coordinates;
    const onlineMechanics = await Mechanic.find({ isOnline: true });

    let closestDistance = null;
    onlineMechanics.forEach(m => {
      const [mLng, mLat] = m.location?.coordinates || [0, 0];
      if (mLng === 0 && mLat === 0) return;
      const dist = calculateHaversineDistance(cLat, cLng, mLat, mLng);
      if (closestDistance === null || dist < closestDistance) {
        closestDistance = dist;
      }
    });

    if (closestDistance !== null) {
      distanceKm = parseFloat((closestDistance ?? 0).toFixed(2));
    }

    const priceBreakdown = calculateServicePrice(finalVehicleType, finalServiceType, distanceKm);
    const finalPriceVal = priceBreakdown.totalPrice;

    const newRequest = await ServiceRequest.create({
      customer: req.user.id,
      serviceType: finalServiceType || 'breakdown',
      issueDescription: finalIssueDescription || 'No description provided',
      vehicleType: finalVehicleType || 'car',
      vehicleModel: vehicleModel || '',
      vehicleNumber: vehicleNumber || '',
      customerLocation: geoJsonLocation,
      customerAddress: customerAddress || '',
      initial_price: finalPriceVal,
      current_price: finalPriceVal,
      last_price_update_time: new Date(),
      pricing: { baseFare: priceBreakdown.baseRate, totalAmount: finalPriceVal },
      amount: finalPriceVal,
      baseRate: priceBreakdown.baseRate,
      distanceCharge: priceBreakdown.distanceCharge,
      totalPrice: finalPriceVal,
    });

    // Link customer activeRequestId
    await User.findByIdAndUpdate(req.user.id, { activeRequestId: newRequest._id });

    // Start matching and sequential dispatch process (Layer 1, 2, 3)
    try {
      const { startMatchingProcess } = require('../services/matchingService');
      await startMatchingProcess(newRequest, /** @type {any} */ (req).io, 5);
    } catch (matchingErr) {
      console.error('[Matching Error] Failed to start matching process:', matchingErr.message);
    }

    // Return format compatible with both data.request._id and data._id
    res.status(201).json({
      success: true,
      message: 'Service request created',
      request: newRequest,
      _id: newRequest._id,
      ...newRequest.toObject()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 1.2 Estimate service request fare (must be registered before /:id)
router.post('/estimate', authMiddleware, async (req, res) => {
  try {
    const { vehicleType, serviceType, location, customerLocation, latitude, longitude } = req.body;
    const finalLocation = customerLocation || location;

    let finalServiceType = serviceType;
    if (finalServiceType === 'tire_repair') {
      finalServiceType = 'flat_tire';
    } else if (finalServiceType === 'battery') {
      finalServiceType = 'battery_jump';
    } else if (finalServiceType === 'lock_out') {
      finalServiceType = 'other';
    }

    let finalVehicleType = vehicleType;
    if (finalVehicleType === 'e-vehicle') {
      finalVehicleType = 'ev';
    }

    let coords = null;
    if (finalLocation && Array.isArray(finalLocation.coordinates) && finalLocation.coordinates.length >= 2) {
      coords = finalLocation.coordinates;
    } else if (latitude !== undefined && longitude !== undefined) {
      coords = [Number(longitude), Number(latitude)];
    }

    let distanceKm = 0;
    if (coords) {
      const { calculateHaversineDistance } = require('../services/mapService');
      const onlineMechanics = await Mechanic.find({ isOnline: true });
      const [cLng, cLat] = coords;

      let closestDistance = null;
      onlineMechanics.forEach(m => {
        const [mLng, mLat] = m.location?.coordinates || [0, 0];
        if (mLng === 0 && mLat === 0) return;
        const dist = calculateHaversineDistance(cLat, cLng, mLat, mLng);
        if (closestDistance === null || dist < closestDistance) {
          closestDistance = dist;
        }
      });

      if (closestDistance !== null) {
        distanceKm = parseFloat((closestDistance ?? 0).toFixed(2));
      }
    }

    const { calculateServicePrice } = require('../config/constants');
    const fare = calculateServicePrice(finalVehicleType, finalServiceType, distanceKm);

    res.status(200).json({
      success: true,
      fare: {
        baseRate: fare.baseRate,
        distanceCharge: fare.distanceCharge,
        totalPrice: fare.totalPrice,
        distanceKm: distanceKm
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 1.5 Get bidding settings (must be registered before /:id)
router.get('/bidding-settings', authMiddleware, async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    let autoPromptDelay = await Setting.findOne({ key: 'autoPromptDelay' });
    if (!autoPromptDelay) autoPromptDelay = /** @type {any} */ ({ value: 120 });

    let maxPriceIncrease = await Setting.findOne({ key: 'maxPriceIncrease' });
    if (!maxPriceIncrease) maxPriceIncrease = /** @type {any} */ ({ value: 1000 });

    res.status(200).json({
      success: true,
      settings: {
        autoPromptDelay: Number(autoPromptDelay.value),
        maxPriceIncrease: Number(maxPriceIncrease.value)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Get request details by ID
router.get('/:id', async (req, res) => {
  try {
    const request = await ServiceRequest.findById(req.params.id)
      .populate('customer', 'name phone email')
      .populate('mechanic', 'name phone averageRating');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    // Check if arrivalOtp is expired (older than 10 minutes)
    if (request.arrivalOtp && request.otpGeneratedAt && !request.otpVerified) {
      const isExpired = Date.now() - request.otpGeneratedAt.getTime() > 10 * 60 * 1000;
      if (isExpired) {
        await ServiceRequest.findByIdAndUpdate(request._id, { $set: { arrivalOtp: '' } });
        request.arrivalOtp = '';
      }
    }

    res.status(200).json({
      success: true,
      request,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Helper: Accept Job
const acceptJob = async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic profile not found' });
    }

    // Atomic find and update to prevent race conditions
    const request = await ServiceRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $in: ['pending', 'assigned'] },
        $or: [
          { currentNotifiedMechanic: mechanic._id },
          { currentNotifiedMechanic: null }
        ]
      },
      {
        $set: {
          mechanic: mechanic._id,
          status: 'accepted',
          accepted_mechanic_id: mechanic._id
        }
      },
      { new: true }
    );

    if (!request) {
      return res.status(400).json({ success: false, message: 'Request is no longer available. Already accepted by another mechanic or expired.' });
    }

    if (!request.pricing || request.pricing.totalAmount === 0) {
      request.pricing = { baseFare: 150, totalAmount: 350 };
      request.amount = 350;
      request.current_price = 350;
    }
    request.accepted_price = request.current_price || request.amount || (request.pricing ? request.pricing.totalAmount : 350);

    request.dispatchHistory.push({
      mechanicId: mechanic._id,
      action: 'accepted',
      timestamp: new Date()
    });

    await request.save();

    // Clear 30s background timeout
    const { clearDispatchTimeout } = require('../services/matchingService');
    clearDispatchTimeout(request._id);

    mechanic.activeRequestId = request._id;
    mechanic.status = 'busy';
    await mechanic.save();

    // Notify customer room via socket
    if (req.io) {
      req.io.to(`job:${request._id}`).emit('job:accepted:notify', {
        jobId: request._id,
        mechanicId: mechanic?._id || req.user.id,
        mechanicName: mechanic?.name || 'Mechanic',
        mechanicPhone: mechanic?.phone || '+919999999999'
      });
      req.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'accepted' });
    }

    res.status(200).json({
      success: true,
      message: 'Request accepted successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Accept request
router.post('/:id/accept', authMiddleware, acceptJob);
router.put('/:id/accept', authMiddleware, acceptJob);

// Helper: Start Job
const startJob = async (req, res) => {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.status = 'work_in_progress';
    await request.save();

    if (req.io) {
      req.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'work_in_progress' });
    }

    res.status(200).json({
      success: true,
      message: 'Request started successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Start request
router.post('/:id/start', authMiddleware, startJob);
router.put('/:id/start', authMiddleware, startJob);

// Helper: Complete Job
const completeJob = async (req, res) => {
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.status = 'completed';
    let baseFare = 349;
    const serviceType = request.serviceType;
    if (serviceType === 'flat_tire' || serviceType === 'puncture_repair') {
      baseFare = 299;
    } else if (serviceType === 'battery_jump') {
      baseFare = 399;
    } else if (serviceType === 'fuel_delivery') {
      baseFare = 249;
    } else if (serviceType === 'engine_repair') {
      baseFare = 599;
    }
    const totalAmount = baseFare + 29;
    request.pricing = { baseFare, totalAmount };
    request.amount = totalAmount;
    request.completedAt = new Date();
    request.paymentStatus = 'pending';
    await request.save();

    // Release mechanic
    if (request.mechanic) {
      await Mechanic.findByIdAndUpdate(request.mechanic, { activeRequestId: null, status: 'online' });
    }

    // Release customer
    if (request.customer) {
      await User.findByIdAndUpdate(request.customer, { activeRequestId: null });
    }

    if (req.io) {
      req.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'completed', amount: totalAmount });
      req.io.to(`job:${request._id}`).emit('job:completed', { jobId: request._id, amount: totalAmount });
    }

    res.status(200).json({
      success: true,
      message: 'Request completed successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Complete request
router.post('/:id/complete', authMiddleware, completeJob);
router.put('/:id/complete', authMiddleware, completeJob);

// Helper: Cancel Job
const cancelJob = async (req, res) => {
  console.log('[Cancel Handler Entry] Cancel request initiated. Request ID:', req.params.id);
  try {
    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (['completed', 'cancelled'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Request is already completed or cancelled' });
    }

    request.status = 'cancelled';
    request.cancelledBy = req.user?.role || 'user';
    request.cancellationReason = req.body.cancellationReason || 'Cancelled by user request';
    await request.save();
    console.log('[Cancel Handler DB Update] Request status updated to cancelled. Request ID:', request._id);

    // Release customer
    if (request.customer) {
      await User.findByIdAndUpdate(request.customer, { activeRequestId: null });
    }

    // Release mechanic
    if (request.mechanic) {
      await Mechanic.findByIdAndUpdate(request.mechanic, {
        activeRequestId: null,
        status: 'online'
      });
    }

    if (req.io) {
      console.log('[Cancel Handler Emit Before] Emitting job:status:changed to room:', 'job:' + request._id);
      req.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'cancelled' });
      console.log('[Cancel Handler Emit After] Successfully emitted job:status:changed to room:', 'job:' + request._id);
    } else {
      console.log('[Cancel Handler Warning] req.io is undefined, cannot emit socket event');
    }

    res.status(200).json({
      success: true,
      message: 'Request cancelled successfully',
      request
    });
  } catch (error) {
    console.error('[Cancel Handler Error] Error cancelling job:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Cancel request
router.post('/:id/cancel', authMiddleware, cancelJob);
router.put('/:id/cancel', authMiddleware, cancelJob);

// 6.5 Increase request price (bidding system)

router.put('/:id/increase-price', authMiddleware, async (req, res) => {
  try {
    const { incrementAmount } = req.body;
    if (!incrementAmount || Number(incrementAmount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid increment amount' });
    }

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Pricing is locked because a mechanic has already accepted or the request is no longer pending.' });
    }

    // Load max allowed price increase limit from Settings model
    const Setting = require('../models/Setting');
    const maxLimitSetting = await Setting.findOne({ key: 'maxPriceIncrease' });
    const maxLimit = maxLimitSetting ? Number(maxLimitSetting.value) : 1000; // default to 1000

    const currentTotalIncrease = (request.current_price || request.amount || 0) - (request.initial_price || 0) + Number(incrementAmount);
    if (currentTotalIncrease > maxLimit) {
      return res.status(400).json({ success: false, message: `Price increase limit exceeded. Maximum total increase allowed is ₹${maxLimit}.` });
    }

    const newPrice = (request.current_price || 0) + Number(incrementAmount);

    request.current_price = newPrice;
    request.price_increase_count = (request.price_increase_count || 0) + 1;
    request.last_price_update_time = new Date();
    request.pricing = { baseFare: newPrice, totalAmount: newPrice };
    request.amount = newPrice;

    request.price_history.push({
      price: newPrice,
      increased_by: Number(incrementAmount),
      timestamp: new Date()
    });

    await request.save();

    // Notify all eligible mechanics and the customer in real-time
    if (/** @type {any} */ (req).io) {
      // Notify customer room
      /** @type {any} */ (req).io.to(`job:${request._id}`).emit('request:price_updated', {
        jobId: request._id,
        current_price: newPrice,
        price_increase_count: request.price_increase_count
      });

      // Broadcast to mechanics room
      /** @type {any} */ (req).io.to('mechanics').emit('request:price_updated', {
        jobId: request._id,
        current_price: newPrice
      });

      // Also emit a general event
      /** @type {any} */ (req).io.emit('request:price_updated_global', {
        jobId: request._id,
        current_price: newPrice
      });
    }

    res.status(200).json({
      success: true,
      message: 'Price increased successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 7. General updates / customer-app update status
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (status === 'cancelled') {
      return cancelJob(req, res);
    }

    const updateFields = {};
    const allowedFields = [
      'vehicleType',
      'vehicleModel',
      'vehicleNumber',
      'serviceType',
      'issueDescription',
      'customerAddress',
      'notes',
      'cost',
      'amount',
      'paymentStatus',
      'paymentMethod'
    ];

    if (req.body.description !== undefined) {
      updateFields.issueDescription = req.body.description;
    }

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });

    const request = await ServiceRequest.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Request updated successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 8. Mark mechanic arrived and generate OTP
router.post('/:id/mark-arrived', authMiddleware, async (req, res) => {
  const requestId = req.params.id;
  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Generate a 4-digit numeric OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Update request details
    request.status = 'arrived';
    request.arrivalOtp = otp;
    request.otpGeneratedAt = new Date();
    request.otpVerified = false;
    request.otpAttempts = 0;
    await request.save();

    console.log(`[OTP Generated] Request: ${request._id} | OTP: ${otp} | GeneratedAt: ${request.otpGeneratedAt}`);

    // Emit Socket.io event to job room
    const reqWithIo = /** @type {any} */ (req);
    if (reqWithIo.io) {
      reqWithIo.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'arrived' });
      reqWithIo.io.to(`job:${request._id}`).emit('arrival_otp', { requestId: request._id, otp });
      reqWithIo.io.to(`user:${request.customer}`).emit('arrival_otp', { requestId: request._id, otp });
      console.log(`[OTP Socket Emitted] Emitted arrival_otp event for job:${request._id} and user:${request.customer}`);
    }

    // Push notification to Customer via FCM
    try {
      const User = require('../models/User');
      const customerUser = await User.findById(request.customer);
      const customerToken = customerUser?.pushToken || customerUser?.fcmToken;
      if (customerToken) {
        const { sendPushNotification } = require('../services/pushNotificationService');
        await sendPushNotification(
          customerToken,
          '📍 Mechanic Arrived',
          `Your mechanic has arrived. Share code: ${otp}`,
          { screen: 'Tracking', params: { jobId: request._id.toString(), arrivalOtp: otp } }
        );
        console.log(`[OTP FCM Sent] Sent push notification with OTP to customer ${request.customer}`);
      } else {
        console.log(`[OTP FCM Skipped] Customer ${request.customer} has no push tokens`);
      }
    } catch (pushErr) {
      console.error('[OTP FCM Error] Failed to send push notification:', pushErr.message);
    }

    // Prepare response without the OTP value
    const responseReq = request.toObject();
    delete responseReq.arrivalOtp;

    res.status(200).json({
      success: true,
      message: 'Mechanic marked as arrived. OTP generated and sent to customer.',
      request: responseReq
    });
  } catch (error) {
    console.error('[Arrived Error] Failed to mark arrived:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 9. Verify arrival OTP
const verifyOtpHandler = async (req, res) => {
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

    if (request.otpVerified) {
      return res.status(200).json({ success: true, message: 'OTP already verified.', request });
    }

    if (request.otpAttempts >= 5) {
      console.log(`[OTP Failure] Request: ${requestId} | Max attempts exceeded.`);
      return res.status(400).json({ success: false, message: 'Maximum OTP attempts (5) exceeded. Please resend a new OTP.' });
    }

    // Check expiry (10 minutes)
    const expiryTime = 10 * 60 * 1000;
    if (!request.otpGeneratedAt || (Date.now() - request.otpGeneratedAt.getTime() > expiryTime)) {
      console.log(`[OTP Failure] Request: ${requestId} | OTP expired.`);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please resend a new OTP.' });
    }

    if (request.arrivalOtp !== otp) {
      request.otpAttempts += 1;
      await request.save();
      console.log(`[OTP Mismatch] Request: ${requestId} | Submitted: ${otp} | Stored: ${request.arrivalOtp} | Attempts: ${request.otpAttempts}`);
      const attemptsLeft = 5 - request.otpAttempts;
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. You have ${attemptsLeft} attempts remaining.`,
        attemptsLeft
      });
    }

    // Success
    request.otpVerified = true;
    request.status = 'work_in_progress';
    await request.save();

    console.log(`[OTP Verified] Request: ${requestId} | OTP matched successfully. Status updated to work_in_progress.`);

    // Broadcast socket event
    if (req.io) {
      req.io.to(`job:${request._id}`).emit('job:status:changed', { status: 'work_in_progress' });
    }

    // Send push notification to Customer via FCM
    try {
      const User = require('../models/User');
      const customerUser = await User.findById(request.customer);
      const customerToken = customerUser?.pushToken || customerUser?.fcmToken;
      if (customerToken) {
        const { sendPushNotification } = require('../services/pushNotificationService');
        await sendPushNotification(
          customerToken,
          '🔧 Job Started',
          'Mechanic has started working on your vehicle',
          { screen: 'Tracking', params: { jobId: request._id.toString() } }
        );
        console.log(`[OTP Success FCM] Sent job started push notification to customer ${request.customer}`);
      }
    } catch (pushErr) {
      console.error('[OTP Success FCM Error] Failed to send job started push:', pushErr.message);
    }

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. Work has started.',
      request
    });
  } catch (error) {
    console.error('[Verify OTP Error] Failed to verify OTP:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.post('/:id/verify-otp', authMiddleware, verifyOtpHandler);
router.post('/:id/verify-start', authMiddleware, verifyOtpHandler);

// 10. Generate PDF invoice for request
router.get('/:id/invoice', authMiddleware, require('../controllers/invoiceController').generateInvoice);

module.exports = router;

