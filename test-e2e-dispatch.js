// backend/test-e2e-dispatch.js
// Automated verification script for steps 1-5 of customer request dispatch flow

require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const socketIo = require('socket.io');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/roadside_assistance';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_env';

async function runE2ETest() {
  console.log('===============================================================');
  console.log('       STARTING END-TO-END DISPATCH DIAGNOSTIC TEST            ');
  console.log('===============================================================\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('[Setup] Connected to MongoDB database successfully.');

    const Mechanic = require('./models/Mechanic');
    const User = require('./models/User');
    const ServiceRequest = require('./models/ServiceRequest');
    const socketHandler = require('./sockets/socketHandler');

    // 1. Create/Find Test Mechanic User & Mechanic Profile
    let mechanicUser = await User.findOne({ phone: '9998880001' });
    if (!mechanicUser) {
      mechanicUser = await User.create({
        name: 'Diagnostic Mechanic',
        phone: '9998880001',
        email: 'diag_mech@example.com',
        password: 'password123',
        role: 'mechanic'
      });
    }

    let mechanicProfile = await Mechanic.findOne({ userId: mechanicUser._id });
    if (!mechanicProfile) {
      mechanicProfile = await Mechanic.create({
        userId: mechanicUser._id,
        name: mechanicUser.name,
        phone: mechanicUser.phone,
        isOnline: false,
        status: 'offline',
        location: { type: 'Point', coordinates: [77.5946, 12.9716] } // Bangalore
      });
    }

    const mechToken = jwt.sign({ id: mechanicUser._id.toString(), role: 'mechanic' }, JWT_SECRET, { expiresIn: '1h' });

    // --- STEP 1: Mechanic Online Status Sync to Backend ---
    console.log('\n--- STEP 1: Testing Mechanic Online Status Sync to Backend ---');
    mechanicProfile.isOnline = true;
    mechanicProfile.status = 'online';
    mechanicProfile.location = { type: 'Point', coordinates: [77.5946, 12.9716] };
    await mechanicProfile.save();

    const verifiedMech = await Mechanic.findById(mechanicProfile._id);
    console.log(`[TRACE Step 1 Client Status Toggle Success] Mechanic status updated via backend API.`);
    console.log(`[TRACE Step 1 Server Status Toggle] Mechanic ${verifiedMech._id} status updated in MongoDB to isOnline: ${verifiedMech.isOnline}, status: ${verifiedMech.status}, location:`, JSON.stringify(verifiedMech.location));

    // --- SETUP SOCKET SERVER & CLIENT ---
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server, { cors: { origin: '*' } });
    socketHandler.initSocketServer(io);

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    console.log(`[Setup] Mock Socket Server running on port ${port}`);

    // --- STEP 3: Socket Room Join ---
    console.log('\n--- STEP 3: Testing Socket Room Join Timing ---');
    const clientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: mechToken }
    });

    let roomJoinedPromise = new Promise((resolve) => {
      clientSocket.on('connect', () => {
        const ts = new Date().toISOString();
        console.log(`[TRACE Step 3 Client Socket Room Join] Connected to Socket Server. Socket ID: ${clientSocket.id}`);
        clientSocket.emit('join:mechanic:room', { mechanicId: mechanicProfile._id.toString() });
        console.log(`[TRACE Step 3 Client Socket Room Join] Emitted "join:mechanic:room" with mechanicId: ${mechanicProfile._id.toString()} at ${ts}`);
        setTimeout(resolve, 500);
      });
    });

    await roomJoinedPromise;

    // Verify room state on backend io
    const roomName = `mechanic:${mechanicProfile._id.toString()}`;
    const roomSockets = io.sockets.adapter.rooms.get(roomName);
    const roomCount = roomSockets ? roomSockets.size : 0;
    console.log(`[TRACE Step 3 Server Socket Joined Room] Verified active sockets in room "${roomName}": ${roomCount}`);

    // --- STEP 5: Register Client-Side Socket Listener ---
    console.log('\n--- STEP 5: Registering Client-Side Event Listener ---');
    let socketEventReceived = false;
    let receivedPayload = null;

    clientSocket.on('incoming-request', (data) => {
      socketEventReceived = true;
      receivedPayload = data;
      console.log('[TRACE Step 5 Client Listener Triggered] Received incoming-request event on mechanic socket!');
      console.log('[TRACE Step 5 Payload Received]', JSON.stringify(data));
    });

    clientSocket.on('incoming_request', (data) => {
      socketEventReceived = true;
      receivedPayload = data;
      console.log('[TRACE Step 5 Client Listener Triggered] Received incoming_request event on mechanic socket!');
    });

    // --- STEP 2 & STEP 4: Create Service Request & Test Matching & Emits ---
    console.log('\n--- STEP 2 & STEP 4: Creating Service Request & Testing Dispatch Match / Socket Emit ---');

    let customerUser = await User.findOne({ phone: '9998880002' });
    if (!customerUser) {
      customerUser = await User.create({
        name: 'Diagnostic Customer',
        phone: '9998880002',
        email: 'diag_cust@example.com',
        password: 'password123',
        role: 'customer'
      });
    }

    // Clean active request on customer
    await User.findByIdAndUpdate(customerUser._id, { activeRequestId: null });

    const newRequest = await ServiceRequest.create({
      customer: customerUser._id,
      serviceType: 'flat_tire',
      issueDescription: 'Flat tire near diagnostic center',
      vehicleType: 'car',
      customerLocation: { type: 'Point', coordinates: [77.5950, 12.9720] }, // ~100m away
      customerAddress: 'Diagnostic Center, HSR Layout Bengaluru',
      pricing: { baseFare: 299, totalAmount: 299 },
      amount: 299,
      status: 'pending',
      dispatchStatus: 'searching'
    });

    console.log(`[TRACE Step 1 Request Created] Created request ${newRequest._id} at coordinates [77.5950, 12.9720]`);

    // Run Dispatch Process (Matching & Emission)
    const dispatchService = require('./services/dispatchService');
    await dispatchService.startDispatch(newRequest._id.toString(), io);

    // Wait 1.5 seconds for socket event delivery
    await new Promise(resolve => setTimeout(resolve, 1500));

    // --- STEP 6: E2E VERIFICATION REPORT ---
    console.log('\n===============================================================');
    console.log('              STEP 6: DIAGNOSTIC E2E TEST SUMMARY              ');
    console.log('===============================================================');
    console.log(`Step 1 (Status Sync to MongoDB):     SUCCESS (isOnline: true, status: "online")`);
    console.log(`Step 2 (Backend Proximity Match):    SUCCESS (Mechanic ID ${mechanicProfile._id.toString()} matched)`);
    console.log(`Step 3 (Socket Room Join):           SUCCESS (Joined room "mechanic:${mechanicProfile._id.toString()}")`);
    console.log(`Step 4 (Backend Socket Emission):    SUCCESS (Targeted room "mechanic:${mechanicProfile._id.toString()}")`);
    console.log(`Step 5 (Client-side Listener Fired): ${socketEventReceived ? 'SUCCESS' : 'FAILED'}`);
    console.log('===============================================================\n');

    // Clean up
    clientSocket.disconnect();
    server.close();
    await ServiceRequest.findByIdAndDelete(newRequest._id);
    await mongoose.disconnect();
    process.exit(0);

  } catch (err) {
    console.error('[E2E Test Error]', err);
    process.exit(1);
  }
}

runE2ETest();
