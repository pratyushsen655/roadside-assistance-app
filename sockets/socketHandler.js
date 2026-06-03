const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const Chat = require('../models/Chat');
const ServiceRequest = require('../models/ServiceRequest');

let io = null;

// Global socket mapping to trace connected clients
const userSockets = new Map(); // userId -> socketId
const mechanicSockets = new Map(); // mechanicId -> socketId

/**
 * Setup socket authentication middleware
 */
const authenticateSocket = async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication error: Token missing'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_jwt_secret_token_12345');
    socket.user = decoded; // { id, role }
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid Token'));
  }
};

/**
 * Initialize Socket.io Server logic
 * @param {object} ioInstance - Socket.io Server instance
 */
const initSocketServer = (ioInstance) => {
  io = ioInstance;
  console.log('[Socket Server] Initialized. Awaiting connections...');

  // Use auth middleware
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role; // 'customer' or 'mechanic' or 'admin'

    console.log(`[Socket Server] Client connected: ${userId} (${userRole}), Socket: ${socket.id}`);

    // Map connection
    if (userRole === 'mechanic') {
      mechanicSockets.set(userId, socket.id);
      socket.join(`mechanic_${userId}`);
      
      // Update mechanic's socketId in DB
      try {
        await Mechanic.findByIdAndUpdate(userId, { socketId: socket.id });
      } catch (err) {
        console.error('[Socket Server] Failed to update mechanic socket ID:', err.message);
      }
    } else if (userRole === 'customer') {
      userSockets.set(userId, socket.id);
      socket.join(`user_${userId}`);
      
      // Update user location update socket association if needed
      try {
        await User.findByIdAndUpdate(userId, { socketId: socket.id });
      } catch (err) {
        console.error('[Socket Server] Failed to update customer socket association:', err.message);
      }
    } else if (userRole === 'admin') {
      socket.join('admins');
    }

    // 1. Join request specific room (for chat & precise updates)
    socket.on('join_request_room', ({ requestId }) => {
      socket.join(`request_${requestId}`);
      console.log(`[Socket Server] Socket ${socket.id} joined request room: request_${requestId}`);
    });

    // 2. Handle Mechanic Live Location Update
    socket.on('update_location', async (data) => {
      const { latitude, longitude, heading } = data;
      if (!latitude || !longitude) return;

      if (userRole !== 'mechanic') {
        return socket.emit('error_message', { message: 'Only mechanics can update driver coordinates' });
      }

      try {
        // Update database with new GeoJSON coordinates
        const updatedMechanic = await Mechanic.findByIdAndUpdate(
          userId,
          {
            location: {
              type: 'Point',
              coordinates: [longitude, latitude], // Longitude first in GeoJSON
            }
          },
          { new: true }
        );

        // If mechanic is busy on an active request, relay coordinate feed directly to the customer
        if (updatedMechanic && updatedMechanic.activeRequestId) {
          const reqId = updatedMechanic.activeRequestId.toString();
          const request = await ServiceRequest.findById(reqId);
          
          if (request) {
            const customerId = request.customer.toString();
            // Emit to customer's specific room
            io.to(`user_${customerId}`).emit('mechanic_location_update', {
              requestId: reqId,
              mechanicId: userId,
              latitude,
              longitude,
              heading: heading || 0
            });
          }
        }

        // Broadcaster for admin real-time map feed
        io.to('admins').emit('admin_mechanic_location_update', {
          mechanicId: userId,
          latitude,
          longitude,
          status: updatedMechanic ? updatedMechanic.status : 'online'
        });

      } catch (err) {
        console.error('[Socket Server] Failed handling update_location:', err.message);
      }
    });

    // 3. Handle Live In-App Chat Message
    socket.on('send_message', async (data) => {
      const { requestId, message, imageUrl } = data;
      if (!requestId || (!message && !imageUrl)) return;

      try {
        const request = await ServiceRequest.findById(requestId);
        if (!request) return;

        const chatMessage = new Chat({
          serviceRequest: requestId,
          sender: userId,
          senderModel: userRole === 'mechanic' ? 'Mechanic' : 'User',
          message: message || '',
          imageUrl: imageUrl || ''
        });

        await chatMessage.save();

        // Broadcast to request room (includes customer and mechanic joined)
        io.to(`request_${requestId}`).emit('receive_message', {
          _id: chatMessage._id,
          serviceRequest: requestId,
          sender: userId,
          senderModel: chatMessage.senderModel,
          message: chatMessage.message,
          imageUrl: chatMessage.imageUrl,
          createdAt: chatMessage.createdAt
        });

      } catch (err) {
        console.error('[Socket Server] Failed saving chat message:', err.message);
      }
    });

    // 4. Handle Disconnection
    socket.on('disconnect', async () => {
      console.log(`[Socket Server] Client disconnected: ${socket.id}`);
      if (userRole === 'mechanic') {
        mechanicSockets.delete(userId);
        try {
          // Reset socketId inside MongoDB
          await Mechanic.findByIdAndUpdate(userId, { socketId: null });
        } catch (err) {
          console.error('[Socket Server] Error clearing mechanic socket ID:', err.message);
        }
      } else if (userRole === 'customer') {
        userSockets.delete(userId);
      }
    });
  });
};

/**
 * Send an event directly to a mechanic
 * @param {string} mechanicId
 * @param {string} event
 * @param {object} payload
 */
const sendToMechanic = (mechanicId, event, payload) => {
  if (io) {
    io.to(`mechanic_${mechanicId}`).emit(event, payload);
    return true;
  }
  return false;
};

/**
 * Send an event directly to a customer
 * @param {string} customerId
 * @param {string} event
 * @param {object} payload
 */
const sendToCustomer = (customerId, event, payload) => {
  if (io) {
    io.to(`user_${customerId}`).emit(event, payload);
    return true;
  }
  return false;
};

/**
 * Broadcast event to admins
 * @param {string} event
 * @param {object} payload
 */
const sendToAdmins = (event, payload) => {
  if (io) {
    io.to('admins').emit(event, payload);
    return true;
  }
  return false;
};

module.exports = {
  initSocketServer,
  sendToMechanic,
  sendToCustomer,
  sendToAdmins,
  getIo: () => io
};
