// backend/scripts/seed.js
// Run with: node scripts/seed.js
// This script seeds the MongoDB database with development test data.

require('dotenv').config({ path: './backend/.env' });
const mongoose = require('mongoose');

const User = require('../models/User');
const Mechanic = require('../models/Mechanic');
const ServiceRequest = require('../models/ServiceRequest');
const Rating = require('../models/Rating');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/roadside_assistance';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('🔗 Connected to MongoDB');
}

function randomCoord(baseLat, baseLng, radiusKm = 5) {
  const rad = radiusKm / 111; // rough conversion km to degrees
  const u = Math.random();
  const v = Math.random();
  const w = rad * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const x = w * Math.cos(t);
  const y = w * Math.sin(t);
  const newLat = baseLat + y;
  const newLng = baseLng + x;
  return [parseFloat(newLng.toFixed(6)), parseFloat(newLat.toFixed(6))]; // GeoJSON [lng, lat]
}

async function createCustomers() {
  const customers = [
    { name: 'Aarav Sharma', phone: '9890000001', email: 'aarav@example.com' },
    { name: 'Riya Patel', phone: '9890000002', email: 'riya@example.com' },
    { name: 'Manish Gupta', phone: '9890000003', email: 'manish@example.com' },
  ];

  const created = await User.insertMany(
    customers.map(c => ({ ...c, role: 'customer', location: { type: 'Point', coordinates: randomCoord(28.6139, 77.2090) } }))
  );
  console.log('👥 Created customers:', created.map(u => u._id));
  return created;
}

async function createMechanics() {
  const baseLat = 28.6139;
  const baseLng = 77.2090;
  const mechanics = [
    { name: 'Vikram Singh', phone: '9891000001', email: 'vikram@example.com' },
    { name: 'Sneha Kapoor', phone: '9891000002', email: 'sneha@example.com' },
    { name: 'Amit Joshi', phone: '9891000003', email: 'amit@example.com' },
  ];

  const created = await Mechanic.insertMany(
    mechanics.map(m => ({
      ...m,
      role: undefined,
      vehicleSpecializations: ['car', 'bike'],
      kyc: { status: 'approved', docType: 'driver_license', docUrl: '', rejectionReason: '' },
      location: { type: 'Point', coordinates: randomCoord(baseLat, baseLng) },
      status: 'online',
    }))
  );
  console.log('🛠️ Created mechanics:', created.map(m => m._id));
  return created;
}

async function createServiceRequests(customers, mechanics) {
  // We'll create two completed requests, each assigned to a mechanic.
  const requests = [];
  for (let i = 0; i < 2; i++) {
    const cust = customers[i];
    const mech = mechanics[i];
    const startOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const request = new ServiceRequest({
      customer: cust._id,
      mechanic: mech._id,
      vehicleType: i % 2 === 0 ? 'car' : 'bike',
      issueDescription: 'Engine not starting',
      customerLocation: { type: 'Point', coordinates: randomCoord(28.6139, 77.2090) },
      customerAddress: `${cust.name} Street, Delhi`,
      mechanicLocationAtAcceptance: { type: 'Point', coordinates: randomCoord(28.6139, 77.2090) },
      status: 'completed',
      pricing: { baseFare: 150, distanceFare: 50, dynamicMultiplier: 1.0, totalAmount: 200 },
      paymentStatus: 'paid',
      paymentMethod: 'card',
      startOTP,
      completedAt: new Date(),
    });
    await request.save();
    requests.push(request);
  }
  console.log('✅ Created service requests:', requests.map(r => r._id));
  return requests;
}

async function createRatings(requests) {
  const ratings = [];
  for (const req of requests) {
    const rating = new Rating({
      serviceRequest: req._id,
      from: req.customer,
      fromModel: 'User',
      to: req.mechanic,
      toModel: 'Mechanic',
      rating: 5,
      review: 'Excellent service, quick response!',
    });
    await rating.save();
    ratings.push(rating);
  }
  console.log('⭐ Created ratings:', ratings.map(r => r._id));
}

async function main() {
  try {
    await connectDB();
    await mongoose.connection.db.dropDatabase(); // start clean for dev
    const customers = await createCustomers();
    const mechanics = await createMechanics();
    const requests = await createServiceRequests(customers, mechanics);
    await createRatings(requests);
    console.log('🎉 Seed data generation complete');
  } catch (err) {
    console.error('❌ Error during seeding:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
  }
}

main();
