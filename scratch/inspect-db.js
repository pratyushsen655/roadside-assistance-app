const mongoose = require('mongoose');
const ServiceRequest = require('../models/ServiceRequest');
const Mechanic = require('../models/Mechanic');

const MONGODB_URI = 'mongodb://localhost:27017/roadside_assistance';

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to database');

    const mechanics = await Mechanic.find({});
    console.log(`\n=== Online/Total Mechanics: ${mechanics.filter(m => m.isOnline).length}/${mechanics.length} ===`);
    mechanics.forEach(m => {
      console.log(`Mechanic ID: ${m._id} | User ID: ${m.userId} | Phone: ${m.phone} | Status: ${m.status} | Online: ${m.isOnline}`);
    });

    const requests = await ServiceRequest.find({}).sort({ createdAt: -1 }).limit(5);
    console.log(`\n=== Latest 5 Requests ===`);
    requests.forEach(r => {
      console.log(`Request ID: ${r._id} | Status: ${r.status} | Current Notified Mech: ${r.currentNotifiedMechanic} | Notified Mechs: ${JSON.stringify(r.notifiedMechanics)} | Rejected By: ${JSON.stringify(r.rejectedBy)}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

run();
