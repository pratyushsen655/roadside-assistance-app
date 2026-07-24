const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../app'); // app is exported from server.js
const PricingConfig = require('../models/PricingConfig');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_env';

const runTests = async () => {
  try {
    console.log('Connecting to database...');
    // Ensure we are connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/roadside-assistance');
    }
    console.log('Database connected.');

    // Clear any existing test configurations
    await PricingConfig.deleteMany({});
    console.log('Cleaned up PricingConfig collection.');

    // Generate test admin token
    const adminToken = jwt.sign({ id: 'admin', role: 'admin', email: 'admin@roadside.com' }, JWT_SECRET);
    const userToken = jwt.sign({ id: 'user123', role: 'user', email: 'user@test.com' }, JWT_SECRET);

    console.log('\n--- 1. Testing GET /api/pricing (Should auto-seed all 63 defaults) ---');
    const getRes = await request(app).get('/api/pricing');
    console.log('Status Code:', getRes.status);
    console.log('Success:', getRes.body.success);
    console.log('Configs count (Should be 63):', getRes.body.configs?.length);
    if (getRes.body.configs?.length > 0) {
      console.log('First 5 configs:', getRes.body.configs.slice(0, 5).map(c => `${c.serviceType} (${c.vehicleType}): ₹${c.baseFare}`).join(', '));
    }

    console.log('\n--- 2. Testing GET /api/pricing/:serviceType (Should return all vehicle variants) ---');
    const getServiceVariantsRes = await request(app).get('/api/pricing/towing');
    console.log('Status Code:', getServiceVariantsRes.status);
    console.log('Success:', getServiceVariantsRes.body.success);
    console.log('Towing Configs count (Should be 7):', getServiceVariantsRes.body.configs?.length);
    if (getServiceVariantsRes.body.configs) {
      console.log('Towing vehicle types fetched:', getServiceVariantsRes.body.configs.map(c => c.vehicleType).join(', '));
    }

    console.log('\n--- 3. Testing GET /api/pricing/:serviceType/:vehicleType (Get single config) ---');
    const getSingleRes = await request(app).get('/api/pricing/towing/car');
    console.log('Status Code:', getSingleRes.status);
    console.log('Success:', getSingleRes.body.success);
    console.log('Towing Car Config:', getSingleRes.body.config);

    console.log('\n--- 4. Testing PUT /api/pricing/:serviceType/:vehicleType (No Auth - Should fail with 401) ---');
    const putNoAuthRes = await request(app)
      .put('/api/pricing/towing/car')
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putNoAuthRes.status);
    console.log('Body:', putNoAuthRes.body);

    console.log('\n--- 5. Testing PUT /api/pricing/:serviceType/:vehicleType (User Auth - Should fail with 403) ---');
    const putUserAuthRes = await request(app)
      .put('/api/pricing/towing/car')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putUserAuthRes.status);
    console.log('Body:', putUserAuthRes.body);

    console.log('\n--- 6. Testing PUT /api/pricing/:serviceType/:vehicleType (Admin Auth - Should succeed) ---');
    const putAdminAuthRes = await request(app)
      .put('/api/pricing/towing/car')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putAdminAuthRes.status);
    console.log('Success:', putAdminAuthRes.body.success);
    console.log('Updated Towing Car Config:', putAdminAuthRes.body.config);

    console.log('\n--- 7. Testing GET /api/pricing/:serviceType/:vehicleType (Verifying Update) ---');
    const getSingleAfterRes = await request(app).get('/api/pricing/towing/car');
    console.log('Status Code:', getSingleAfterRes.status);
    console.log('Base Fare (Should be 1100):', getSingleAfterRes.body.config?.baseFare);
    console.log('Per Km Rate (Should be 35):', getSingleAfterRes.body.config?.perKmRate);
    console.log('Min Charge (Should be 1300):', getSingleAfterRes.body.config?.minCharge);

    console.log('\n--- 8. Testing Request Price Calculation and Estimation for Car ---');
    const estimateCarRes = await request(app)
      .post('/api/requests/estimate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        vehicleType: 'car',
        serviceType: 'towing',
        latitude: 28.6139,
        longitude: 77.2090
      });
    console.log('Car Estimate Status Code:', estimateCarRes.status);
    console.log('Car Estimate Fare Result:', estimateCarRes.body.fare);

    console.log('\n--- 9. Testing Request Price Calculation and Estimation for Bike (Verify different rate) ---');
    const estimateBikeRes = await request(app)
      .post('/api/requests/estimate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        vehicleType: 'bike',
        serviceType: 'towing',
        latitude: 28.6139,
        longitude: 77.2090
      });
    console.log('Bike Estimate Status Code:', estimateBikeRes.status);
    console.log('Bike Estimate Fare Result:', estimateBikeRes.body.fare);

    console.log('\nAll tests completed successfully!');
  } catch (err) {
    console.error('Test run error:', err);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  }
};

runTests();
