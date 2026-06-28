const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/mechanic/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const completedRequestsToday = await ServiceRequest.find({
      mechanic: req.user.id,
      status: 'completed',
      completedAt: { $gte: startOfToday, $lte: endOfToday }
    });

    const jobsToday = completedRequestsToday.length;
    const earningsToday = completedRequestsToday
      .filter(job => job.paymentStatus === 'paid')
      .reduce((sum, job) => sum + (job.pricing?.totalAmount || 0), 0);

    const mechanicProfile = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });
    const rating = mechanicProfile ? (mechanicProfile.rating || mechanicProfile.averageRating || 5) : 5;
    const totalJobs = await ServiceRequest.countDocuments({ mechanic: req.user.id, status: 'completed' });

    res.status(200).json({
      success: true,
      jobsToday,
      earningsToday,
      rating,
      totalJobs
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/mechanic/requests/pending
// Returns pending requests within 4 km of the mechanic using MongoDB $geoNear.
// Distance is provided by the DB — no manual haversine calculation.
router.get('/requests/pending', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');
    const { calculateHaversineDistance } = require('../services/mapService');

    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });

    if (!mechanic || !mechanic.isOnline) {
      return res.status(200).json([]);
    }

    const [mLng, mLat] = mechanic.location?.coordinates || [0, 0];

    // Guard: if mechanic has no valid location stored yet, return empty feed
    if (mLng === 0 && mLat === 0) {
      console.warn(`[NearbyRequests] Mechanic ${mechanic._id} has no location set — returning empty feed`);
      return res.status(200).json([]);
    }

    // Retrieve all pending requests not rejected by this mechanic
    const rawRequests = await ServiceRequest.find({
      status: 'pending',
      rejectedBy: { $ne: mechanic._id }
    }).populate('customer', 'name phone');

    const items = rawRequests.map(reqItem => {
      const coords = reqItem.customerLocation?.coordinates;
      const cLng = coords ? coords[0] : 0;
      const cLat = coords ? coords[1] : 0;
      
      let distanceKm = null;
      let coordsMissing = false;

      console.log(`[NearbyRequests DEBUG] reqItem: ${reqItem._id}, mechanic: ${mechanic._id}`);
      console.log(`[NearbyRequests DEBUG] mLng: ${mLng}, mLat: ${mLat}`);
      console.log(`[NearbyRequests DEBUG] cLng: ${cLng}, cLat: ${cLat}`);

      if (cLng === 0 && cLat === 0) {
        console.warn(`[NearbyRequests] Customer location coordinates missing/null for request ${reqItem._id}`);
        coordsMissing = true;
      } else {
        distanceKm = parseFloat(calculateHaversineDistance(mLat, mLng, cLat, cLng).toFixed(1));
        console.log(`[NearbyRequests DEBUG] Calculated distanceKm: ${distanceKm}`);
      }

      // Calculate elapsed time in seconds to determine active search radius
      const elapsedSeconds = (Date.now() - new Date(reqItem.createdAt).getTime()) / 1000;
      let activeRadiusKm = 5;
      if (elapsedSeconds >= 120) {
        activeRadiusKm = 15;
      } else if (elapsedSeconds >= 60) {
        activeRadiusKm = 10;
      }

      return {
        reqItem,
        distanceKm,
        coordsMissing,
        activeRadiusKm
      };
    })
    // Filter to requests that are within the current search radius or have coordinates missing (so we can show the fallback UI)
    .filter(item => item.coordsMissing || item.distanceKm <= item.activeRadiusKm)
    // Sort by distance (nearest first), pushing coordinate-missing requests to the bottom
    .sort((a, b) => {
      if (a.coordsMissing && b.coordsMissing) return 0;
      if (a.coordsMissing) return 1;
      if (b.coordsMissing) return -1;
      return a.distanceKm - b.distanceKm;
    })
    .map(({ reqItem, distanceKm, coordsMissing }) => ({
      _id: reqItem._id,
      customerName: (/** @type {any} */ (reqItem.customer))?.name || 'Customer',
      customerPhone: (/** @type {any} */ (reqItem.customer))?.phone || '',
      vehicleMake: reqItem.vehicleType
        ? reqItem.vehicleType.charAt(0).toUpperCase() + reqItem.vehicleType.slice(1)
        : 'Vehicle',
      vehicleModel: reqItem.vehicleModel
        ? `${reqItem.vehicleModel} [${reqItem.vehicleNumber || 'N/A'}]`
        : (reqItem.vehicleNumber || 'Model'),
      vehicleNumber: reqItem.vehicleNumber || '',
      issueType: reqItem.serviceType,
      issueDescription: reqItem.issueDescription || '',
      distanceKm,
      coordsMissing,
      location: reqItem.customerAddress || 'Nearby',
      customerLocation: reqItem.customerLocation,
      price: reqItem.totalPrice || reqItem.current_price || reqItem.amount || reqItem.pricing?.totalAmount || 350,
      baseRate: reqItem.baseRate || 350,
      distanceCharge: reqItem.distanceCharge || 0
    }));

    res.status(200).json(items);
  } catch (error) {
    console.error('[NearbyRequests Error]', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});



// PUT /api/mechanic/requests/:id/accept
router.put('/requests/:id/accept', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
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
    ).populate('customer', 'name phone');

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

    if (/** @type {any} */ (req).io) {
      /** @type {any} */ (req).io.to(`job:${request._id}`).emit('job:accepted:notify', {
        jobId: request._id,
        mechanicId: mechanic?._id,
        mechanicName: mechanic?.name || 'Mechanic',
        mechanicPhone: mechanic?.phone || '+919999999999'
      });
    }

    // Trigger push notification to customer
    try {
      const User = require('../models/User');
      const customerUser = await User.findById(request.customer._id || request.customer);
      const customerToken = customerUser?.pushToken || customerUser?.fcmToken;
      if (customerToken) {
        const { sendPushNotification } = require('../services/pushNotificationService');
        await sendPushNotification(
          customerToken,
          '🔧 Mechanic Found!',
          `${mechanic?.name || 'Mechanic'} is on the way to help you`,
          { screen: 'Tracking', params: { jobId: request._id.toString(), mechanicId: mechanic?._id.toString(), mechanicName: mechanic?.name || 'Mechanic', mechanicPhone: mechanic?.phone || '' } }
        );
      }
    } catch (pushErr) {
      console.error('[Accept Notification Error]', pushErr.message);
    }

    res.status(200).json({
      success: true,
      message: 'Request accepted successfully',
      jobId: request._id,
      customerLocation: request.customerLocation,
      customerName: (/** @type {any} */ (request.customer))?.name || 'Customer',
      customerPhone: (/** @type {any} */ (request.customer))?.phone || '',
      issue: request.issueDescription || request.serviceType
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/mechanic/requests/:id/reject
router.put('/requests/:id/reject', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');

    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic profile not found' });
    }

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const mechanicObjectId = mechanic._id;

    // Add mechanic to rejected list
    const hasRejected = request.rejectedBy.some(id => id.toString() === mechanicObjectId.toString());
    if (!hasRejected) {
      request.rejectedBy.push(mechanicObjectId);
    }

    request.dispatchHistory.push({
      mechanicId: mechanicObjectId,
      action: 'rejected',
      timestamp: new Date()
    });

    await request.save();

    console.log(`[Rejection] Mechanic ${mechanicObjectId} declined request ${request._id}`);

    // Clear background timeout
    const { clearDispatchTimeout, dispatchNextMechanic } = require('../services/matchingService');
    clearDispatchTimeout(request._id);

    // If the rejecting mechanic was the current target, dispatch to next nearest
    if (request.currentNotifiedMechanic && request.currentNotifiedMechanic.toString() === mechanicObjectId.toString()) {
      await dispatchNextMechanic(request, /** @type {any} */ (req).io);
    }

    res.status(200).json({ success: true, message: 'Request rejected successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/mechanic/status
router.put('/status', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { isOnline } = req.body;
    const statusVal = isOnline ? 'online' : 'offline';

    const mechanic = await Mechanic.findOneAndUpdate(
      { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
      { isOnline: !!isOnline, status: statusVal },
      { new: true }
    );
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    res.status(200).json({ success: true, isOnline: mechanic.isOnline, status: mechanic.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/mechanic/jobs
router.get('/jobs', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const jobs = await ServiceRequest.find({ mechanic: req.user.id })
      .populate('customer', 'name phone')
      .sort({ createdAt: -1 });

    const activeList = jobs.filter(job => ['accepted', 'on_the_way', 'arrived', 'work_in_progress', 'assigned'].includes(job.status));
    const completedList = jobs.filter(job => job.status === 'completed');

    const mapJob = (job) => ({
      id: job._id.toString(),
      customer: job.customer?.name || 'Customer',
      customerPhone: job.customer?.phone || '',
      issue: job.issueDescription || job.serviceType,
      location: job.customerAddress || 'Nearby',
      amount: `₹${job.pricing?.totalAmount || 350}`,
      status: job.status === 'completed' ? 'Completed' : 'Active'
    });

    res.status(200).json({
      success: true,
      active: activeList.map(mapJob),
      completed: completedList.map(mapJob)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/mechanic/earnings
router.get('/earnings', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');

    const completedJobs = await ServiceRequest.find({
      mechanic: req.user.id,
      status: 'completed',
      paymentStatus: 'paid'
    }).populate('customer', 'name phone').sort({ completedAt: -1 });

    const total = completedJobs.reduce((sum, job) => sum + (job.pricing?.totalAmount || 0), 0);

    const now = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(now.getDate() - 7);
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(now.getDate() - 30);

    const thisWeek = completedJobs
      .filter(job => job.completedAt >= oneWeekAgo)
      .reduce((sum, job) => sum + (job.pricing?.totalAmount || 0), 0);

    const thisMonth = completedJobs
      .filter(job => job.completedAt >= oneMonthAgo)
      .reduce((sum, job) => sum + (job.pricing?.totalAmount || 0), 0);

    const jobsList = completedJobs.map(job => ({
      id: job._id.toString(),
      job: job.issueDescription || job.serviceType,
      date: job.completedAt ? new Date(job.completedAt).toLocaleString() : 'Completed',
      amount: `₹${job.pricing?.totalAmount || 0}`
    }));

    res.status(200).json({
      success: true,
      total,
      thisWeek,
      thisMonth,
      jobs: jobsList
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/mechanic/profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    res.status(200).json({ success: true, mechanic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/mechanic/profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { name, phone, bio, shopName, shopAddress, city, email, vehicleSpecializations, documents } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (bio !== undefined) updateData.bio = bio;
    if (shopName !== undefined) updateData.shopName = shopName;
    if (shopAddress !== undefined) updateData.shopAddress = shopAddress;
    if (city !== undefined) updateData.city = city;
    if (email !== undefined) updateData.email = email;
    if (vehicleSpecializations !== undefined) updateData.vehicleSpecializations = vehicleSpecializations;
    if (documents !== undefined) updateData.documents = documents;

    const mechanic = await Mechanic.findOneAndUpdate(
      { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    res.status(200).json({ success: true, message: 'Profile updated successfully', mechanic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/mechanic/location
router.put('/location', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
    }

    const mechanic = await Mechanic.findOneAndUpdate(
      { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [Number(longitude), Number(latitude)]
          }
        }
      },
      { new: true }
    );

    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      location: mechanic.location
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/mechanic/jobs/:id/status
router.put('/jobs/:id/status', authMiddleware, async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');
    const { status } = req.body;

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    request.status = status;
    let earningsEarned = 0;

     let totalAmount = request.totalPrice || 350;
    if (status === 'completed') {
      let baseFare = request.baseRate || 349;
      if (!request.totalPrice) {
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
        totalAmount = baseFare + 29;
      }
      
      earningsEarned = totalAmount;

      request.pricing = { baseFare, totalAmount };
      request.amount = totalAmount;
      request.completedAt = new Date();
      request.paymentStatus = 'pending';

      await Mechanic.findOneAndUpdate(
        { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
        { activeRequestId: null, status: 'online' }
      );
    } else {
      // For any other status transitions
      await request.save();
    }

    if (status === 'completed') {
      await request.save();
    }

    if (/** @type {any} */ (req).io) {
      const room = `job:${request._id}`;
      /** @type {any} */ (req).io.to(room).emit('job:status:changed', { status, amount: totalAmount });
      if (status === 'completed') {
        /** @type {any} */ (req).io.to(room).emit('job:completed', { jobId: request._id, amount: totalAmount });
      }
    }

    // Trigger status transition push notifications to customer
    try {
      const User = require('../models/User');
      const customerUser = await User.findById(request.customer);
      const customerToken = customerUser?.pushToken || customerUser?.fcmToken;
      if (customerToken) {
        const { sendPushNotification } = require('../services/pushNotificationService');
        if (status === 'on_the_way') {
          await sendPushNotification(
            customerToken,
            '📍 Mechanic En Route',
            'Your mechanic is on the way',
            { screen: 'Tracking', params: { jobId: request._id.toString() } }
          );
        } else if (status === 'work_in_progress') {
          await sendPushNotification(
            customerToken,
            '🔧 Job Started',
            'Mechanic has started working on your vehicle',
            { screen: 'Tracking', params: { jobId: request._id.toString() } }
          );
        } else if (status === 'completed') {
          await sendPushNotification(
            customerToken,
            '⭐ How was your experience?',
            'Rate your mechanic and help others find great service',
            { screen: 'RateJob', params: { jobId: request._id.toString() } }
          );
        }
      }
    } catch (pushErr) {
      console.error('[Status Notification Error]', pushErr.message);
    }

    res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      earningsEarned,
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- Original Wildcard/General Routes ---

router.get('/', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanics = await Mechanic.find({ availabilityStatus: 'available' }).populate('userId', 'name phone');

    res.status(200).json({
      success: true,
      mechanics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findById(req.params.id).populate('userId', 'name phone email');

    if (!mechanic) {
      return res.status(404).json({
        success: false,
        message: 'Mechanic not found',
      });
    }

    res.status(200).json({
      success: true,
      mechanic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.put('/availability', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { status, location } = req.body;

    const mechanic = await Mechanic.findOneAndUpdate(
      { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
      { availabilityStatus: status, currentLocation: location },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Availability updated',
      mechanic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post('/push-token', authMiddleware, async (req, res) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }
    const Mechanic = require('../models/Mechanic');
    await Mechanic.findOneAndUpdate(
      { $or: [{ _id: req.user.id }, { userId: req.user.id }] },
      { pushToken, fcmToken: pushToken }
    );
    res.json({ success: true, message: 'Push token saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
