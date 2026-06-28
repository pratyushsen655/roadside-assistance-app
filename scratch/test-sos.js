// backend/scratch/test-sos.js
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const ClientIO = require('socket.io-client');
const dotenv = require('dotenv');

dotenv.config({ path: './backend/.env' });

const connectDB = require('../config/db');
const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const SOS = require('../models/SOS');
const socketHandler = require('../sockets/socketHandler');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: '*' }
});

socketHandler.initSocketServer(io);

app.use((req, res, next) => {
  req.io = io;
  next();
});

const sosRoutes = require('../routes/sos');
app.use('/api/sos', sosRoutes);

let serverInstance;
const PORT = 5999;

async function runTrace() {
  console.log(`[Trace ${new Date().toISOString()}] Connecting to MongoDB...`);
  await connectDB();

  // Clean up previous test entries
  await User.deleteMany({ email: /test-sos-/ });
  await Mechanic.deleteMany({ email: /test-sos-/ });
  await SOS.deleteMany({});

  // 1. Create a Customer and Mechanic in the DB
  console.log(`[Trace ${new Date().toISOString()}] Creating mock Customer & Mechanic...`);
  const customer = await User.create({
    name: 'SOS Customer',
    email: 'test-sos-cust@example.com',
    password: 'password123',
    phone: '+919999999991',
    role: 'user'
  });

  const mechanic = await Mechanic.create({
    userId: new mongoose.Types.ObjectId(), // dummy user id
    name: 'SOS Mechanic',
    email: 'test-sos-mech@example.com',
    phone: '+919999999992',
    isOnline: true,
    status: 'online',
    location: {
      type: 'Point',
      coordinates: [77.2090, 28.6139] // Delhi location matching customer exactly
    }
  });

  // 2. Start mock HTTP/Socket Server
  serverInstance = server.listen(PORT, () => {
    console.log(`[Trace] Server running on port ${PORT}`);
  });

  // 3. Generate tokens
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_env';
  const customerToken = jwt.sign({ id: customer._id, role: 'user' }, JWT_SECRET);
  const mechanicToken = jwt.sign({ id: mechanic._id, role: 'mechanic' }, JWT_SECRET);

  // 4. Establish Socket connections
  const socketUrl = `http://localhost:${PORT}`;
  console.log(`[Trace ${new Date().toISOString()}] Establishing customer & mechanic socket connections...`);

  const customerSocket = ClientIO(socketUrl, {
    transports: ['websocket'],
    auth: { token: customerToken }
  });

  const mechanicSocket = ClientIO(socketUrl, {
    transports: ['websocket'],
    auth: { token: mechanicToken }
  });

  await new Promise((resolve) => {
    let connectedCount = 0;
    const checkConnect = () => {
      connectedCount++;
      if (connectedCount === 2) resolve();
    };
    customerSocket.on('connect', checkConnect);
    mechanicSocket.on('connect', checkConnect);
  });

  console.log(`[Trace ${new Date().toISOString()}] Sockets connected. Mechanic joining room...`);

  // Manually join mechanic room for test socket
  mechanicSocket.emit('join:mechanics:room');

  // Listen for broadcasts on Mechanic
  mechanicSocket.on('sos:new', (data) => {
    console.log(`[Mechanic Socket Event ${new Date().toISOString()}] Received 'sos:new' alert! SOS ID: ${data._id}`);
  });

  // Create SOS request via route simulation
  console.log(`[Trace ${new Date().toISOString()}] Tapping SOS / Triggering POST /api/sos...`);
  
  const sosPayload = {
    lat: 28.6139,
    lng: 77.2090,
    serviceType: 'tire_repair',
    description: 'SOS: Tyre Puncture'
  };

  const agent = require('superagent');
  let sosRecord;
  try {
    const res = await agent
      .post(`http://localhost:${PORT}/api/sos`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(sosPayload);
    
    sosRecord = res.body;
    console.log(`[Trace ${new Date().toISOString()}] POST response received. SOS Created:`, sosRecord);
  } catch (err) {
    console.error('API call failed:', err.message);
  }

  if (sosRecord) {
    // Customer joins job room
    console.log(`[Trace ${new Date().toISOString()}] Customer joining room job:${sosRecord._id}...`);
    customerSocket.emit('join:job:room', { jobId: sosRecord._id });

    // Listen for radius updates on Customer
    customerSocket.on('request:search_radius_update', (radiusData) => {
      console.log(`[Customer Socket Event ${new Date().toISOString()}] Received 'request:search_radius_update':`, radiusData);
    });

    // Listen for mechanic acceptance on Customer
    customerSocket.on('job:accepted:notify', (details) => {
      console.log(`[Customer Socket Event ${new Date().toISOString()}] Received 'job:accepted:notify':`, details);
    });

    // 5. Simulate Mechanic Acceptance after 2 seconds
    await new Promise(r => setTimeout(r, 2000));
    console.log(`[Trace ${new Date().toISOString()}] Mechanic accepting SOS job...`);
    try {
      const acceptRes = await agent
        .put(`http://localhost:${PORT}/api/sos/${sosRecord._id}/accept`)
        .set('Authorization', `Bearer ${mechanicToken}`)
        .send();
      console.log(`[Trace ${new Date().toISOString()}] Mechanic accept response received:`, acceptRes.body);
    } catch (err) {
      console.error('Accept API call failed:', err.message);
    }
  }

  // Wait a moment before exit
  await new Promise(r => setTimeout(r, 1000));

  console.log(`[Trace ${new Date().toISOString()}] Closing connections...`);
  customerSocket.disconnect();
  mechanicSocket.disconnect();
  serverInstance.close();
  await mongoose.disconnect();
  console.log('[Trace] Done.');
}

runTrace().catch(err => {
  console.error('Trace crashed:', err);
  if (serverInstance) serverInstance.close();
  mongoose.disconnect();
});
