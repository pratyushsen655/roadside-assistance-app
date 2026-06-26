const Mechanic = require('../models/Mechanic');
const User = require('../models/User');
const { calculateHaversineDistance } = require('./mapService');
const { sendRingingRequestNotification } = require('./pushNotificationService');

/**
 * Offering a request to the next-nearest mechanic in sequence
 * @param {object} request - ServiceRequest mongoose document
 * @param {object} io - Socket.io instance
 */
const dispatchNextMechanic = async (request, io) => {
  // Guard: Request is no longer pending or already assigned
  if (request.status !== 'pending') {
    console.log(`[Matching] Request ${request._id} status is "${request.status}" — skipping sequential dispatch.`);
    return;
  }

  const rejectedIds = (request.rejectedBy || []).map(id => id.toString());
  
  // Find first mechanic in the notified list who hasn't rejected it yet
  const nextMechId = request.notifiedMechanics.find(mechId => !rejectedIds.includes(mechId.toString()));

  if (!nextMechId) {
    console.log(`[Matching ALERT] No more eligible mechanics left to notify for request ${request._id}.`);
    request.currentNotifiedMechanic = null;
    await request.save();
    return;
  }

  // Update current notified mechanic
  request.currentNotifiedMechanic = nextMechId;
  await request.save();

  // Fetch the mechanic profile
  const mechanic = await Mechanic.findById(nextMechId);
  if (!mechanic) {
    console.error(`[Matching ERROR] Mechanic ${nextMechId} in notifiedMechanics not found in DB.`);
    return;
  }

  console.log(`[Matching] Offering request ${request._id} to next-nearest mechanic: ${mechanic.name || mechanic._id} (ID: ${mechanic._id})`);

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
    serviceType: request.serviceType || 'breakdown',
    vehicleType: request.vehicleType || 'car',
    distanceKm: distanceKm.toString(),
    timestamp: new Date().toISOString()
  };

  // 1. Direct FCM Push Alert (Layer 2)
  if (mechanic.fcmToken || mechanic.pushToken) {
    const token = mechanic.fcmToken || mechanic.pushToken;
    console.log(`[FCM Matching] Dispatching data-only FCM push to mechanic: ${mechanic._id}`);
    await sendRingingRequestNotification(token, fcmPayload);
  } else {
    console.warn(`[FCM Matching Warning] Mechanic ${mechanic._id} has no FCM token saved.`);
  }

  // 2. Parallel Socket.io Alert (Layer 3)
  if (io) {
    const socketPayload = {
      requestId: request._id.toString(),
      customerName: customerName,
      customerLocation: { latitude: cLat, longitude: cLng },
      serviceType: request.serviceType || 'breakdown',
      vehicleType: request.vehicleType || 'car',
      distanceKm: distanceKm,
      timestamp: new Date()
    };

    // Emit to mechanic user's personal room (keyed by user ID)
    if (mechanic.userId) {
      const userRoom = `user:${mechanic.userId.toString()}`;
      io.to(userRoom).emit('incoming_request', socketPayload);
      console.log(`[Socket.io Matching] Emitted event to user room: ${userRoom}`);
    }

    // Also emit to mechanic room (keyed by mechanic ID)
    const mechanicRoom = `mechanic:${mechanic._id.toString()}`;
    io.to(mechanicRoom).emit('incoming_request', socketPayload);
    console.log(`[Socket.io Matching] Emitted event to mechanic room: ${mechanicRoom}`);
  } else {
    console.warn(`[Socket.io Matching Warning] Socket server instance (io) is not available.`);
  }
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

  // Query MongoDB for online mechanics using 2dsphere $near geospatial index
  const nearbyMechanics = await Mechanic.find({
    status: 'online',
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

  // Save the list of matching mechanics
  request.notifiedMechanics = mechanicIds;
  await request.save();

  // Offer the request to the first (nearest) mechanic
  await dispatchNextMechanic(request, io);
};

module.exports = {
  startMatchingProcess,
  dispatchNextMechanic
};
