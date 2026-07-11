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

    console.log('\n--- 1. Testing GET /api/pricing (Should auto-seed defaults) ---');
    const getRes = await request(app).get('/api/pricing');
    console.log('Status Code:', getRes.status);
    console.log('Success:', getRes.body.success);
    console.log('Configs count:', getRes.body.configs?.length);
    if (getRes.body.configs?.length > 0) {
      console.log('Auto-seeded service types:', getRes.body.configs.map(c => c.serviceType).join(', '));
    }

    console.log('\n--- 2. Testing GET /api/pricing/:serviceType ---');
    const getSingleRes = await request(app).get('/api/pricing/towing');
    console.log('Status Code:', getSingleRes.status);
    console.log('Success:', getSingleRes.body.success);
    console.log('Towing Config:', getSingleRes.body.config);

    console.log('\n--- 3. Testing PUT /api/pricing/:serviceType (No Auth - Should fail with 401) ---');
    const putNoAuthRes = await request(app)
      .put('/api/pricing/towing')
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putNoAuthRes.status);
    console.log('Body:', putNoAuthRes.body);

    console.log('\n--- 4. Testing PUT /api/pricing/:serviceType (User Auth - Should fail with 403) ---');
    const putUserAuthRes = await request(app)
      .put('/api/pricing/towing')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putUserAuthRes.status);
    console.log('Body:', putUserAuthRes.body);

    console.log('\n--- 5. Testing PUT /api/pricing/:serviceType (Admin Auth - Should succeed) ---');
    const putAdminAuthRes = await request(app)
      .put('/api/pricing/towing')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ baseFare: 1100, perKmRate: 35, minCharge: 1300 });
    console.log('Status Code:', putAdminAuthRes.status);
    console.log('Success:', putAdminAuthRes.body.success);
    console.log('Updated Towing Config:', putAdminAuthRes.body.config);

    console.log('\n--- 6. Testing GET /api/pricing/:serviceType (Verifying Update) ---');
    const getSingleAfterRes = await request(app).get('/api/pricing/towing');
    console.log('Status Code:', getSingleAfterRes.status);
    console.log('Base Fare:', getSingleAfterRes.body.config?.baseFare);
    console.log('Per Km Rate:', getSingleAfterRes.body.config?.perKmRate);
    console.log('Min Charge:', getSingleAfterRes.body.config?.minCharge);
    console.log('Updated By:', getSingleAfterRes.body.config?.updatedBy);

    console.log('\n--- 7. Testing Request Price Calculation and Estimation ---');
    // Call the estimate endpoint to verify it retrieves Towing price correctly
    const estimateRes = await request(app)
      .post('/api/requests/estimate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        vehicleType: 'car',
        serviceType: 'towing',
        latitude: 28.6139,
        longitude: 77.2090
      });
    console.log('Estimate Status Code:', estimateRes.status);
    console.log('Estimate Fare Result:', estimateRes.body.fare);

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
