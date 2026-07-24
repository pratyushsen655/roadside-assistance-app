const request = require('supertest');
const app = require('../server');
const mongoose = require('mongoose');
const Mechanic = require('../models/Mechanic');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');

function randomPhone() {
  return `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
}

function randomEmail(prefix) {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}

describe('Dispatch Service and Endpoints', () => {
  let customerToken = '';
  let mechanicToken = '';
  let mechanicId = '';
  let mechanicUserId = '';
  let serviceRequestId = '';

  beforeAll(async () => {
    // Register customer
    const custEmail = randomEmail('cust');
    const custPhone = randomPhone();
    const custRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test Customer',
        email: custEmail,
        password: 'Password123!',
        phone: custPhone,
        role: 'customer'
      })
      .expect(201);
    customerToken = custRes.body.token;

    // Register mechanic
    const mechEmail = randomEmail('mech');
    const mechPhone = randomPhone();
    const mechRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test Mechanic',
        email: mechEmail,
        password: 'Password123!',
        phone: mechPhone,
        role: 'mechanic',
        vehicleSpecializations: ['car']
      })
      .expect(201);
    mechanicToken = mechRes.body.token;
    mechanicUserId = mechRes.body.user?.id || mechRes.body.userId;

    // Retrieve mechanic profile details and update location / status to online
    const mechanicProfile = await Mechanic.findOne({ userId: mechanicUserId });
    expect(mechanicProfile).toBeTruthy();
    mechanicId = mechanicProfile._id.toString();

    mechanicProfile.status = 'online';
    mechanicProfile.location = { type: 'Point', coordinates: [77.2090, 28.6139] };
    await mechanicProfile.save();
  });

  test('Create Service Request should trigger sequential dispatch', async () => {
    const reqRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        serviceType: 'breakdown',
        issueDescription: 'Car engine overheating',
        vehicleType: 'car',
        vehicleModel: 'Honda Civic',
        vehicleNumber: 'DL-1C-AA-1234',
        customerLocation: { type: 'Point', coordinates: [77.2091, 28.6138] },
        customerAddress: 'Delhi'
      })
      .expect(201);

    expect(reqRes.body).toHaveProperty('request');
    const serviceRequest = reqRes.body.request;
    serviceRequestId = serviceRequest._id;

    // Wait a brief moment to let async startDispatch process run
    await new Promise(resolve => setTimeout(resolve, 500));

    const updatedRequest = await ServiceRequest.findById(serviceRequestId);
    expect(updatedRequest.dispatchStatus).toBe('searching');
    expect(updatedRequest.currentCandidateMechanic.toString()).toBe(mechanicId);
    expect(updatedRequest.dispatchedMechanics.length).toBe(1);
    expect(updatedRequest.dispatchedMechanics[0].mechanicId.toString()).toBe(mechanicId);
    expect(updatedRequest.dispatchedMechanics[0].status).toBe('pending');
  });

  test('Reject dispatch endpoint should trigger immediate next candidate', async () => {
    // If we reject, it will attempt next, and since no more online mechanics, it should become unfulfilled
    const rejectRes = await request(app)
      .post(`/api/requests/${serviceRequestId}/dispatch/reject`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .expect(200);

    expect(rejectRes.body.success).toBe(true);

    // Wait for the next async cycle to mark unfulfilled since there are no other mechanics
    await new Promise(resolve => setTimeout(resolve, 500));

    const updatedRequest = await ServiceRequest.findById(serviceRequestId);
    expect(updatedRequest.status).toBe('unfulfilled');
    expect(updatedRequest.dispatchStatus).toBe('unfulfilled');
  });

  test('Accept dispatch endpoint works with atomic update checks', async () => {
    // Create a new request and reset mechanic status
    await Mechanic.findByIdAndUpdate(mechanicId, { status: 'online', activeRequestId: null });

    const reqRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        serviceType: 'breakdown',
        issueDescription: 'Flat tire',
        vehicleType: 'car',
        vehicleModel: 'Honda Accord',
        vehicleNumber: 'DL-1C-BB-5678',
        customerLocation: { type: 'Point', coordinates: [77.2091, 28.6138] },
        customerAddress: 'Delhi'
      })
      .expect(201);

    const newRequestId = reqRes.body.request._id;
    await new Promise(resolve => setTimeout(resolve, 500));

    // Call accept endpoint
    const acceptRes = await request(app)
      .post(`/api/requests/${newRequestId}/dispatch/accept`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .expect(200);

    expect(acceptRes.body.success).toBe(true);
    expect(acceptRes.body.request.status).toBe('accepted');
    expect(acceptRes.body.request.dispatchStatus).toBe('assigned');

    const updatedMech = await Mechanic.findById(mechanicId);
    expect(updatedMech.status).toBe('busy');
    expect(updatedMech.activeRequestId.toString()).toBe(newRequestId.toString());
  });
});
