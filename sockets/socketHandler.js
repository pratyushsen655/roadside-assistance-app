const jwt = require('jsonwebtoken');

let ioInstance;

const socketHandler = {
  getIo: () => ioInstance,
  sendToMechanic: (mechanicId, event, data) => {
    if (ioInstance) {
      const roomName = `mechanic:${mechanicId}`;
      const roomSockets = ioInstance.sockets.adapter.rooms.get(roomName);
      const activeSocketsCount = roomSockets ? roomSockets.size : 0;
      const socketIds = roomSockets ? Array.from(roomSockets) : [];

      console.log(`[TRACE Step 2 & 3] [Backend Socket Emit & Room Check] Room: "${roomName}" | Active Sockets Count: ${activeSocketsCount} | Socket IDs: [${socketIds.join(', ')}] | Event: "${event}"`);
      console.log(`[TRACE Step 2 Payload]`, JSON.stringify(data));

      ioInstance.to(roomName).emit(event, data);
    } else {
      console.log(`[TRACE Step 2 ERROR] ioInstance is null when attempting to emit to mechanic:${mechanicId}`);
    }
  },
  sendToCustomer: (customerId, event, data) => {
    if (ioInstance) {
      ioInstance.to(`user:${customerId}`).emit(event, data);
    }
  },
  sendToAdmins: (event, data) => {
    if (ioInstance) {
      ioInstance.to('admins').emit(event, data);
    }
  },

  initSocketServer: (io) => {
    ioInstance = io;

    io.on('connection', async (socket) => {
      console.log(`[TRACE Step 4 Server] [Socket Connected] Socket ID: ${socket.id} | Timestamp: ${new Date().toISOString()}`);

      // Decode token if provided in handshake auth
      const token = socket.handshake.auth?.token;
      if (token) {
        try {
          const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_env';
          const decoded = /** @type {any} */ (jwt.verify(token, JWT_SECRET));
          socket.userId = decoded.id;
          socket.join(`user:${decoded.id}`);
          console.log(`[TRACE Step 4 Server] [Room Join] Customer/User joined room: "user:${decoded.id}" | Socket ID: ${socket.id}`);

          const Mechanic = require('../models/Mechanic');
          const mechanic = await Mechanic.findOne({ $or: [{ _id: decoded.id }, { userId: decoded.id }] });
          if (mechanic) {
            socket.mechanicId = mechanic._id.toString();
            socket.join(`mechanic:${mechanic._id.toString()}`);
            socket.join('mechanics');
            console.log(`[TRACE Step 4 Server] [Room Join] Mechanic joined rooms: "mechanic:${mechanic._id.toString()}" & "mechanics" | Socket ID: ${socket.id}`);
          }
        } catch (err) {
          console.log('[TRACE Step 4 Server] Handshake auth token verification failed:', err.message);
        }
      }

      // Join job room
      socket.on('join:job:room', ({ jobId }) => {
        socket.join(`job:${jobId}`);
        console.log(`[Socket] Customer/User Socket joined room: job:${jobId} | Socket ID: ${socket.id}`);
      });

      // Join mechanic specific room
      socket.on('join:mechanic:room', async (data) => {
        let mechanicId = typeof data === 'string' ? data : (data?.mechanicId || data?.id);
        if (mechanicId === 'null' || mechanicId === 'undefined' || mechanicId === '0') {
          mechanicId = null;
        }
        if (!mechanicId && socket.userId) {
          try {
            const Mechanic = require('../models/Mechanic');
            const mechanic = await Mechanic.findOne({ $or: [{ _id: socket.userId }, { userId: socket.userId }] });
            if (mechanic) mechanicId = mechanic._id.toString();
          } catch (err) {}
        }
        if (!mechanicId && socket.mechanicId) {
          mechanicId = socket.mechanicId;
        }
        if (mechanicId && mechanicId !== 'null' && mechanicId !== 'undefined') {
          socket.mechanicId = mechanicId;
          const roomName = `mechanic:${mechanicId}`;
          socket.join(roomName);
          console.log(`[TRACE Step 3 Server Socket Joined Room] Socket ${socket.id} joined room: "${roomName}"`);
        } else {
          console.warn(`[Socket WARNING] Socket ${socket.id} attempted to join room with invalid/null mechanicId: ${JSON.stringify(data)}`);
        }
      });

      socket.on('join:mechanic', async (data) => {
        let mechanicId = typeof data === 'string' ? data : (data?.mechanicId || data?.id);
        if (mechanicId === 'null' || mechanicId === 'undefined' || mechanicId === '0') {
          mechanicId = null;
        }
        if (!mechanicId && socket.userId) {
          try {
            const Mechanic = require('../models/Mechanic');
            const mechanic = await Mechanic.findOne({ $or: [{ _id: socket.userId }, { userId: socket.userId }] });
            if (mechanic) mechanicId = mechanic._id.toString();
          } catch (err) {}
        }
        if (mechanicId && mechanicId !== 'null' && mechanicId !== 'undefined') {
          socket.mechanicId = mechanicId;
          const roomName = `mechanic:${mechanicId}`;
          socket.join(roomName);
          console.log(`[TRACE Step 3 Server Socket Joined Room] Socket ${socket.id} joined room: "${roomName}"`);
        } else {
          console.warn(`[Socket WARNING] Socket ${socket.id} attempted to join room with invalid/null mechanicId: ${JSON.stringify(data)}`);
        }
      });

      // Join mechanics room
      socket.on('join:mechanics:room', () => {
        socket.join('mechanics');
        console.log(`[Socket] Socket ${socket.id} joined room: mechanics`);
      });

      // Join admins room
      socket.on('join:admins:room', () => {
        socket.join('admins');
        console.log(`[Socket] Socket ${socket.id} joined room: admins`);
      });

      // Mechanic broadcasts location
      socket.on('mechanic:location', ({ jobId, lat, lng }) => {
        console.log(`[Socket] Mechanic location for job:${jobId} -> ${lat}, ${lng}`);
        io.to(`job:${jobId}`).emit('mechanic:location:update', { lat, lng });
      });

      // Job status updates
      socket.on('job:status:update', ({ jobId, status }) => {
        console.log(`[Socket] Job status update for job:${jobId} -> ${status}`);
        io.to(`job:${jobId}`).emit('job:status:changed', { status });
      });

      // Notify customer when mechanic accepts
      socket.on('job:accepted', ({ jobId, mechanicId, mechanicName, mechanicPhone }) => {
        console.log(`[Socket] Job accepted for job:${jobId} by ${mechanicName}`);
        io.to(`job:${jobId}`).emit('job:accepted:notify', { mechanicId: mechanicId ?? null, mechanicName, mechanicPhone });
      });

      // Chat message send
      socket.on('chat:send', async ({ jobId, message, senderType, senderId }) => {
        try {
          const Message = require('../models/Message');
          const ServiceRequest = require('../models/ServiceRequest');
          const User = require('../models/User');
          const Mechanic = require('../models/Mechanic');
          const { sendPushNotification } = require('../services/pushNotificationService');

          // Save message to MongoDB
          const msg = await Message.create({ jobId, senderId, senderType, message });
          console.log(`[Socket] Saved message for job:${jobId} from ${senderType}`);

          // Broadcast to job room
          io.to(`job:${jobId}`).emit('chat:message', {
            _id: msg._id,
            message,
            senderType,
            senderId,
            createdAt: msg.createdAt
          });

          // Fetch the job to get recipient tokens
          const job = await ServiceRequest.findById(jobId);
          if (job) {
            if (senderType === 'mechanic') {
              const customerUser = await User.findById(job.customer);
              const token = customerUser?.pushToken || customerUser?.fcmToken;
              if (token) {
                const mechanic = await Mechanic.findById(job.mechanic);
                await sendPushNotification(
                  token,
                  `💬 ${mechanic?.name || 'Mechanic'}`,
                  message,
                  { screen: 'Chat', params: { jobId, receiverName: mechanic?.name || 'Mechanic' } }
                );
              }
            } else if (senderType === 'customer') {
              const mechanic = await Mechanic.findById(job.mechanic);
              const token = mechanic?.pushToken || mechanic?.fcmToken;
              if (token) {
                const customerUser = await User.findById(job.customer);
                await sendPushNotification(
                  token,
                  `💬 ${customerUser?.name || 'Customer'}`,
                  message,
                  { screen: 'Chat', params: { jobId, receiverName: customerUser?.name || 'Customer' } }
                );
              }
            }
          }
        } catch (error) {
          console.error('[Socket Chat Send Error]', error.message);
        }
      });

      // Typing indicators
      socket.on('chat:typing', ({ jobId, senderType }) => {
        socket.to(`job:${jobId}`).emit('chat:typing', { senderType });
      });

      socket.on('chat:stop:typing', ({ jobId }) => {
        socket.to(`job:${jobId}`).emit('chat:stop:typing');
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
      });
    });

    // Start matchmaking / search radius expansion loop
    setInterval(async () => {
      try {
        const ServiceRequest = require('../models/ServiceRequest');
        const SOS = require('../models/SOS');
        const Mechanic = require('../models/Mechanic');
        const { calculateHaversineDistance } = require('../services/mapService');
        const { sendPushNotification } = require('../services/pushNotificationService');

        // 1. ServiceRequests matching and radius expansion (UI feedback only)
        const pendingRequests = await ServiceRequest.find({ status: 'pending' });
        for (const reqItem of pendingRequests) {
          const elapsedSeconds = (Date.now() - new Date(reqItem.createdAt).getTime()) / 1000;
          let currentRadius = 5;

          if (elapsedSeconds >= 120) {
            currentRadius = 15;
          } else if (elapsedSeconds >= 60) {
            currentRadius = 10;
          } else {
            currentRadius = 5;
          }

          // Emit to customer's job room to update their UI map overlay circle & status text
          io.to(`job:${reqItem._id}`).emit('request:search_radius_update', {
            radiusKm: currentRadius
          });
        }

        // 2. SOS matching and radius expansion
        const pendingSOS = await SOS.find({ status: 'pending' });
        for (const sosItem of pendingSOS) {
          const elapsedSeconds = (Date.now() - new Date(sosItem.createdAt).getTime()) / 1000;
          let currentRadius = 5;
          let prevRadius = 0;

          if (elapsedSeconds >= 120) {
            currentRadius = 15;
            prevRadius = 10;
          } else if (elapsedSeconds >= 60) {
            currentRadius = 10;
            prevRadius = 5;
          } else {
            currentRadius = 5;
            prevRadius = 0;
          }

          io.to(`job:${sosItem._id}`).emit('request:search_radius_update', {
            radiusKm: currentRadius
          });

          if (prevRadius > 0) {
            const onlineMechanics = await Mechanic.find({ isOnline: true });
            const { lat: cLat, lng: cLng } = sosItem.location;

            for (const mech of onlineMechanics) {
              const [mLng, mLat] = mech.location?.coordinates || [0, 0];
              if (mLng === 0 && mLat === 0) continue;
              const dist = calculateHaversineDistance(cLat, cLng, mLat, mLng);

              if (dist > prevRadius && dist <= currentRadius) {
                io.to(`mechanic:${mech._id}`).emit('sos:new', sosItem);

                if (mech.pushToken || mech.fcmToken) {
                  sendPushNotification(
                    mech.pushToken || mech.fcmToken,
                    '🚨 EMERGENCY SOS Alert',
                    `An emergency SOS request is available within ${currentRadius} km!`,
                    { sosId: sosItem._id.toString() }
                  ).catch(() => {});
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Socket matching loop error]', err.message);
      }
    }, 10000);
  },
};

module.exports = socketHandler;
