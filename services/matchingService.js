const Mechanic = require('../models/Mechanic');
const User = require('../models/User');
const { calculateHaversineDistance } = require('./mapService');
const { sendRingingRequestNotification } = require('./pushNotificationService');

const activeTimeouts = new Map();

/**
 * Clears the 30-second dispatch timeout for a request.
 * @param {string|object} requestId 
 */
const clearDispatchTimeout = (requestId) => {
  if (!requestId) return;
  const key = requestId.toString();
  const timeoutId = activeTimeouts.get(key);
  if (timeoutId) {
    clearTimeout(timeoutId);
    activeTimeouts.delete(key);
    console.log(`[Matching] Cleared 30s dispatch timeout for request ${key}`);
  }
};

/**
 * Expands the search radius when all current mechanics are exhausted.
 * @param {object} request - ServiceRequest mongoose document
 * @param {object} io - Socket.io instance
 */
const expandSearchRadius = async (request, io) => {
  try {
    const elapsedSeconds = (Date.now() - new Date(request.createdAt).getTime()) / 1000;
    let targetRadius = 10;
    
    if (elapsedSeconds >= 60 && elapsedSeconds < 120) {
      targetRadius = 15;
    } else if (elapsedSeconds >= 120) {
      console.log(`[Matching] Maximum search radius (15km) reached. No more mechanics found for request ${request._id}`);
      request.currentNotifiedMechanic = null;
      await request.save();
      if (io) {
        io.to(`job:${request._id}`).emit('request_matching_exhausted', { requestId: request._id });
        io.to(`user:${request.customer}`).emit('request_matching_exhausted', { requestId: request._id });
      }
      return;
    }

    console.log(`[Matching] Expanding search radius to ${targetRadius}km for request ${request._id}`);
    const [cLng, cLat] = request.customerLocation.coordinates;

    const nearby = await Mechanic.find({
      status: 'online',
      kycStatus: { $ne: 'pending' },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [cLng, cLat] },
          $maxDistance: targetRadius * 1000
        }
      }
    });

    const existingIds = request.notifiedMechanics.map(id => id.toString());
    const newMechanics = nearby.filter(m => !existingIds.includes(m._id.toString()));

    if (newMechanics.length > 0) {
      const newIds = newMechanics.map(m => m._id);
      request.notifiedMechanics.push(...newIds);
      await request.save();
      console.log(`[Matching] Radius expansion found ${newMechanics.length} new mechanics. Dispatching next.`);
      await dispatchNextMechanic(request, io);
    } else {
      // Direct skip to the next bracket by modifying createdAt timestamp
      if (targetRadius === 10) {
        console.log(`[Matching] No new mechanics found at 10km, expanding to 15km immediately`);
        request.createdAt = new Date(Date.now() - 65000); // mock that 65s passed
        await request.save();
        await expandSearchRadius(request, io);
      } else {
        console.log(`[Matching] No new mechanics found at 15km for request ${request._id}`);
        request.currentNotifiedMechanic = null;
        await request.save();
        if (io) {
          io.to(`job:${request._id}`).emit('request_matching_exhausted', { requestId: request._id });
          io.to(`user:${request.customer}`).emit('request_matching_exhausted', { requestId: request._id });
        }
      }
    }
  } catch (err) {
    console.error(`[Matching ERROR] Failed to expand search radius for request ${request._id}:`, err.message);
  }
};

/**
 * Offering a request to the next-nearest mechanic in sequence
 * @param {object} request - ServiceRequest mongoose document
 * @param {object} io - Socket.io instance
 */
const dispatchNextMechanic = async (request, io) => {
  // Guard: Request is no longer pending or already assigned
  if (request.status !== 'pending') {
    console.log(`[Matching] Request ${request._id} status is "${request.status}" — skipping sequential dispatch.`);
    clearDispatchTimeout(request._id);
    return;
  }

  // Clear existing timer if any
  clearDispatchTimeout(request._id);

  const rejectedIds = (request.rejectedBy || []).map(id => id.toString());
  
  // Find first mechanic in the notified list who hasn't rejected it yet
  const nextMechId = request.notifiedMechanics.find(mechId => !rejectedIds.includes(mechId.toString()));

  if (!nextMechId) {
    console.log(`[Matching] No more eligible mechanics in current list for request ${request._id}. Expanding radius...`);
    await expandSearchRadius(request, io);
    return;
  }

  // Update current notified mechanic and add offered entry to dispatchHistory
  request.currentNotifiedMechanic = nextMechId;
  request.dispatchHistory.push({
    mechanicId: nextMechId,
    action: 'offered',
    timestamp: new Date()
  });
  await request.save();

  // Fetch the mechanic profile
  const mechanic = await Mechanic.findById(nextMechId);
  if (!mechanic) {
    console.error(`[Matching ERROR] Mechanic ${nextMechId} in notifiedMechanics not found in DB.`);
    return;
  }

  console.log(`[Matching] Offering request ${request._id} to next mechanic: ${mechanic.name || mechanic._id} (ID: ${mechanic._id})`);

  // Fetch customer details
  const customerUser = await User.findById(request.customer);
  const customerName = customerUser?.name || 'Customer';

  // Calculate distance
  const [cLng, cLat] = request.customerLocation.coordinates;
  const [mLng, mLat] = mechanic.location.coordinates;
  const distanceKm = parseFloat(calculateHaversineDistance(cLat, cLng, mLat, mLng).toFixed(2));

  // Prepare FCM Payload (Must be string fields only)
  const fcmPayload = {
    requestId: request._id.toString(),
    customerName: customerName,
    customerLocation: JSON.stringify({ latitude: cLat, longitude: cLng }),
    customerAddress: request.customerAddress || 'Nearby Coordinates',
    serviceType: request.serviceType || 'breakdown',
    vehicleType: request.vehicleType || 'car',
    distanceKm: distanceKm.toString(),
    timestamp: new Date().toISOString()
  };

  // 1. Direct FCM Push Alert
  if (mechanic.fcmToken || mechanic.pushToken) {
    const token = mechanic.fcmToken || mechanic.pushToken;
    console.log(`[FCM Matching] Dispatching data-only FCM push to mechanic: ${mechanic._id}`);
    await sendRingingRequestNotification(token, fcmPayload);
  } else {
    console.warn(`[FCM Matching Warning] Mechanic ${mechanic._id} has no FCM token saved.`);
  }

  // 2. Parallel Socket.io Alert
  if (io) {
    const socketPayload = {
      requestId: request._id.toString(),
      customerName: customerName,
      customerLocation: { latitude: cLat, longitude: cLng },
      customerAddress: request.customerAddress || 'Nearby Coordinates',
      serviceType: request.serviceType || 'breakdown',
      vehicleType: request.vehicleType || 'car',
      distanceKm: distanceKm,
      timestamp: new Date()
    };

    // Emit to mechanic user's personal room
    if (mechanic.userId) {
      const userRoom = `user:${mechanic.userId.toString()}`;
      io.to(userRoom).emit('incoming_request', socketPayload);
    }

    // Also emit to mechanic room
    const mechanicRoom = `mechanic:${mechanic._id.toString()}`;
    io.to(mechanicRoom).emit('incoming_request', socketPayload);
  }

  // 3. Schedule 30-Second Timeout Auto-Reassignment
  const timeoutId = setTimeout(async () => {
    try {
      const ServiceRequest = require('../models/ServiceRequest');
      const reqDoc = await ServiceRequest.findById(request._id);
      
      // Verify request is still pending and assigned to the same mechanic
      if (reqDoc && reqDoc.status === 'pending' && reqDoc.currentNotifiedMechanic?.toString() === nextMechId.toString()) {
        console.log(`[Matching TIMEOUT] Mechanic ${nextMechId} did not respond within 30s to request ${reqDoc._id}`);
        
        // Add to rejectedBy list
        if (!reqDoc.rejectedBy.includes(nextMechId)) {
          reqDoc.rejectedBy.push(nextMechId);
        }

        // Add timeout log to dispatchHistory
        reqDoc.dispatchHistory.push({
          mechanicId: nextMechId,
          action: 'timeout',
          timestamp: new Date()
        });

        await reqDoc.save();

        // Emit socket events to clear ringing call screen
        if (io) {
          if (mechanic.userId) {
            io.to(`user:${mechanic.userId.toString()}`).emit('incoming_request_timeout', { requestId: reqDoc._id.toString() });
          }
          io.to(`mechanic:${mechanic._id.toString()}`).emit('incoming_request_timeout', { requestId: reqDoc._id.toString() });
        }

        // Trigger next dispatch
        await dispatchNextMechanic(reqDoc, io);
      }
    } catch (err) {
      console.error(`[Matching TIMEOUT ERROR] Failed to handle timeout for request ${request._id}:`, err.message);
    }
  }, 30000);

  activeTimeouts.set(request._id.toString(), timeoutId);
};

/**
 * Initializes matching process on request creation
 * @param {object} request - ServiceRequest mongoose document
 * @param {object} io - Socket.io instance
 * @param {number} [radiusKm=5] - Configurable search radius
 */
const startMatchingProcess = async (request, io, radiusKm = 5) => {
  const [cLng, cLat] = request.customerLocation.coordinates;

  console.log(`[Matching] Starting search for online mechanics near coordinates [${cLng}, ${cLat}] within ${radiusKm}km...`);

  // Query MongoDB for online mechanics using 2dsphere near proximity index
  const nearbyMechanics = await Mechanic.find({
    status: 'online',
    kycStatus: { $ne: 'pending' },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [cLng, cLat]
        },
        $maxDistance: radiusKm * 1000
      }
    }
  });

  if (!nearbyMechanics || nearbyMechanics.length === 0) {
    console.log(`[Matching ALERT] No online mechanics found within ${radiusKm}km of customer location for request ${request._id}.`);
    request.notifiedMechanics = [];
    request.currentNotifiedMechanic = null;
    await request.save();
    return;
  }

  const mechanicIds = nearbyMechanics.map(m => m._id);
  console.log(`[Matching] Found ${nearbyMechanics.length} online mechanics: ${JSON.stringify(mechanicIds)}. Storing on request.`);

  request.notifiedMechanics = mechanicIds;
  await request.save();

  // Offer the request to the first (nearest) mechanic
  await dispatchNextMechanic(request, io);
};

module.exports = {
  startMatchingProcess,
  dispatchNextMechanic,
  clearDispatchTimeout,
  activeTimeouts
};
