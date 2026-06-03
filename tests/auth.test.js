// tests/auth.test.js
const request = require('supertest');
const app = require('../server'); // assuming server.js exports the Express app

// Helper to generate a random email for each test run
function randomEmail(prefix) {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}

describe('Auth Endpoints', () => {
  let customerToken = '';
  let mechanicToken = '';
  let refreshToken = '';

  // Register a customer
  test('POST /api/auth/register (customer)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test Customer',
        email: randomEmail('customer'),
        password: 'Password123!',
        role: 'customer',
      })
      .expect(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    customerToken = res.body.token;
    refreshToken = res.body.refreshToken;
  });

  // Register a mechanic
  test('POST /api/auth/register (mechanic)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test Mechanic',
        email: randomEmail('mechanic'),
        password: 'Password123!',
        role: 'mechanic',
        // any mechanic‑specific fields can be added here
      })
      .expect(201);
    expect(res.body).toHaveProperty('token');
    mechanicToken = res.body.token;
  });

  // Login (customer)
  test('POST /api/auth/login', async () => {
    // Use the same credentials we used for registration above
    const email = res => res.body.email; // placeholder – we will reuse the first email
    // For simplicity re‑register a fresh user to guarantee login works
    const loginEmail = randomEmail('login');
    const password = 'Password123!';
    // Register first so the user exists
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Login User', email: loginEmail, password, role: 'customer' })
      .expect(201);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: loginEmail, password })
      .expect(200);
    expect(loginRes.body).toHaveProperty('token');
    expect(loginRes.body).toHaveProperty('refreshToken');
    customerToken = loginRes.body.token;
    refreshToken = loginRes.body.refreshToken;
  });

  // Get profile with JWT token
  test('GET /api/auth/profile', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(res.body).toHaveProperty('email');
    expect(res.body).toHaveProperty('role');
  });

  // Refresh token
  test('POST /api/auth/refresh-token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken })
      .expect(200);
    expect(res.body).toHaveProperty('token');
    // replace token for subsequent calls
    customerToken = res.body.token;
  });

  // Logout
  test('POST /api/auth/logout', async () => {
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
  });
});
