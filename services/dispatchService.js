const Mechanic = require('../models/Mechanic');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const { getRouteDetails } = require('./mapService');
const { sendRingingRequestNotification } = require('./pushNotificationService');
const socketHandler = require('../sockets/socketHandler');

const activeDispatchTimers = new Map(); // key: serviceRequestId (string), value: timeoutId

/**
 * Clears the 15-second dispatch timeout for a request.
 * @param {string|object} serviceRequestId 
 */
const cleanActiveTimer = (serviceRequestId) => {
  if (!serviceRequestId) return;
  const key = serviceRequestId.toString();
  const timeoutId = activeDispatchTimers.get(key);
  if (timeoutId) {
    clearTimeout(timeoutId);
    activeDispatchTimers.delete(key);
    console.log(`[Dispatch] Cleared dispatch timeout for request ${key}`);
  }
};

/**
 * Find nearby online mechanics matching the requested vehicleType.
 * @param {object|number[]} customerLocation - GeoJSON Point or [lng, lat]
 * @param {number} radiusInMeters - Configurable search radius
 * @param {string[]} excludeIds - Mechanic IDs to exclude
 * @param {string} [vehicleType] - The request's vehicle type
 */
const findNearbyMechanics = async (customerLocation, radiusInMeters, excludeIds = [], vehicleType = null) => {
  const coordinates = customerLocation.coordinates || customerLocation;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    console.error('[Dispatch ERROR] Invalid customer coordinates:', coordinates);
    return [];
  }

  const [lng, lat] = coordinates;
  const defaultRadius = radiusInMeters || Number(process.env.DEFAULT_DISPATCH_RADIUS) || 10000;

  const query = {
    status: 'online',
    _id: { $nin: excludeIds },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        $maxDistance: defaultRadius,
      },
    },
  };

  if (vehicleType) {
    query.vehicleSpecializations = vehicleType;
  }

  try {
    return await Mechanic.find(query);
  } catch (error) {
    console.error('[Dispatch ERROR] Failed to query nearby mechanics:', error.message);
    return [];
  }
};

/**
 * Start the sequential dispatch process for a request.
 * @param {string} serviceRequestId 
 * @param {object} [io] - Optional socket.io instance
 */
const startDispatch = async (serviceRequestId, io = null) => {
  try {
    console.log(`[Dispatch] Initializing dispatch for request ${serviceRequestId}`);
    const request = await ServiceRequest.findById(serviceRequestId);
    if (!request) {
      console.error(`[Dispatch ERROR] Request ${serviceRequestId} not found.`);
      return;
    }

    request.dispatchStatus = 'searching';
    request.status = 'pending';
    request.dispatchedMechanics.splice(0, request.dispatchedMechanics.length);
    request.currentCandidateMechanic = null;
    await request.save();

    await dispatchNext(serviceRequestId, io);
  } catch (err) {
    console.error(`[Dispatch ERROR] Failed to start dispatch for request ${serviceRequestId}:`, err.message);
  }
};

/**
 * Sequences matching to the next-nearest mechanic.
 * @param {string} serviceRequestId 
 * @param {object} [io] - Optional socket.io instance
 */
const dispatchNext = async (serviceRequestId, io = null) => {
  try {
    // Clear any active timer for this request
    cleanActiveTimer(serviceRequestId);

    const request = await ServiceRequest.findById(serviceRequestId);
    if (!request) {
      console.log(`[Dispatch] Request ${serviceRequestId} not found. Stopping dispatch loop.`);
      return;
    }

    // Stop if request is no longer pending/searching
    if (request.status !== 'pending' || request.dispatchStatus !== 'searching') {
      console.log(`[Dispatch] Request ${serviceRequestId} status is ${request.status} / ${request.dispatchStatus}. Stopping dispatch loop.`);
      return;
    }

    const ioInstance = io || socketHandler.getIo();

    // Determine mechanics already targeted (rejected, timed out, or accepted)
    const excludeIds = request.dispatchedMechanics
      .filter(dm => ['rejected', 'timedout', 'accepted'].includes(dm.status))
      .map(dm => dm.mechanicId.toString());

    const radiusInMeters = Number(process.env.DEFAULT_DISPATCH_RADIUS) || 10000;
    const candidates = await findNearbyMechanics(request.customerLocation, radiusInMeters, excludeIds, request.vehicleType);

    // If no candidate online mechanics are found, request goes unfulfilled
    if (candidates.length === 0) {
      console.log(`[Dispatch Alert] Candidate mechanics list exhausted for request ${request._id}. Marking unfulfilled.`);
      request.status = 'unfulfilled';
      request.dispatchStatus = 'unfulfilled';
      request.currentCandidateMechanic = null;
      await request.save();

      if (ioInstance) {
        ioInstance.to(`job:${request._id}`).emit('request_matching_exhausted', { requestId: request._id.toString() });
        ioInstance.to(`user:${request.customer}`).emit('request_matching_exhausted', { requestId: request._id.toString() });
      }
      return;
    }

    // Select the nearest candidate
    const candidate = candidates[0];
    console.log(`[Dispatch] Offering request ${request._id} to candidate mechanic: ${candidate.name || candidate._id} (ID: ${candidate._id})`);

    // Update request state with current targeted candidate
    request.currentCandidateMechanic = candidate._id;

    const existingIndex = request.dispatchedMechanics.findIndex(dm => dm.mechanicId.toString() === candidate._id.toString());
    if (existingIndex > -1) {
      request.dispatchedMechanics[existingIndex].status = 'pending';
      request.dispatchedMechanics[existingIndex].dispatchedAt = new Date();
    } else {
      request.dispatchedMechanics.push({
        mechanicId: candidate._id,
        dispatchedAt: new Date(),
        status: 'pending',
      });
    }

    await request.save();

    // Calculate distance and ETA
    const route = await getRouteDetails(candidate.location.coordinates, request.customerLocation.coordinates);
    const customerUser = await User.findById(request.customer);
    const customerName = customerUser?.name || 'Customer';

    // Construct Socket/FCM payloads
    const socketPayload = {
      requestId: request._id.toString(),
      customerLocation: {
        latitude: request.customerLocation.coordinates[1],
        longitude: request.customerLocation.coordinates[0],
      },
      customerName,
      customerAddress: request.customerAddress || 'Nearby Coordinates',
      vehicleType: request.vehicleType || 'car',
      issueDescription: request.issueDescription || 'No description',
      distanceKm: route.distanceKm,
      durationMins: route.durationMins,
      timestamp: new Date(),
    };

    const fcmPayload = {
      requestId: request._id.toString(),
      customerName,
      customerLocation: JSON.stringify({
        latitude: request.customerLocation.coordinates[1],
        longitude: request.customerLocation.coordinates[0],
      }),
      customerAddress: request.customerAddress || 'Nearby Coordinates',
      vehicleType: request.vehicleType || 'car',
      issueDescription: request.issueDescription || 'Roadside breakdown assistance needed',
      distanceKm: route.distanceKm.toString(),
      durationMins: route.durationMins.toString(),
      timestamp: new Date().toISOString(),
    };

    // Emit Socket.io events
    if (ioInstance) {
      ioInstance.to(`mechanic:${candidate._id.toString()}`).emit('incoming-request', socketPayload);
      if (candidate.userId) {
        ioInstance.to(`user:${candidate.userId.toString()}`).emit('incoming-request', socketPayload);
      }
    }

    // Send high-priority FCM Push Notification
    const token = candidate.fcmToken || candidate.pushToken;
    if (token) {
      await sendRingingRequestNotification(token, fcmPayload);
    } else {
      console.warn(`[Dispatch Warning] Candidate mechanic ${candidate._id} has no FCM token saved.`);
    }

    // Schedule 15-second timeout for next dispatch step
    const timeoutId = setTimeout(async () => {
      try {
        console.log(`[Dispatch Timeout] 15-second response window expired for mechanic ${candidate._id} on request ${request._id}`);
        const currentReq = await ServiceRequest.findById(request._id);
        
        // Ensure request is still active and mechanic hasn't responded
        if (
          currentReq &&
          currentReq.status === 'pending' &&
          currentReq.dispatchStatus === 'searching' &&
          currentReq.currentCandidateMechanic?.toString() === candidate._id.toString()
        ) {
          // Update status to timedout
          const matchIdx = currentReq.dispatchedMechanics.findIndex(dm => dm.mechanicId.toString() === candidate._id.toString());
          if (matchIdx > -1) {
            currentReq.dispatchedMechanics[matchIdx].status = 'timedout';
          }
          await currentReq.save();

          // Dismiss call UI via socket
          if (ioInstance) {
            ioInstance.to(`mechanic:${candidate._id.toString()}`).emit('request-expired', { requestId: request._id.toString() });
            if (candidate.userId) {
              ioInstance.to(`user:${candidate.userId.toString()}`).emit('request-expired', { requestId: request._id.toString() });
            }
          }

          // Call dispatchNext recursively
          await dispatchNext(request._id.toString(), ioInstance);
        }
      } catch (err) {
        console.error(`[Dispatch Timeout Error] Failed inside timeout handler for request ${request._id}:`, err.message);
      }
    }, 15000);

    activeDispatchTimers.set(request._id.toString(), timeoutId);
  } catch (err) {
    console.error(`[Dispatch ERROR] Failed to dispatch next for request ${serviceRequestId}:`, err.message);
  }
};

module.exports = {
  findNearbyMechanics,
  startDispatch,
  dispatchNext,
  cleanActiveTimer,
  activeDispatchTimers,
};
