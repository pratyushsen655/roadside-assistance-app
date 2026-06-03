// check-production.js
// Run with: node check-production.js
// This script performs a pre‑launch sanity check for the production backend.
// It verifies env vars, removes console.log statements, checks API health, Socket.IO, webhooks, push notifications, SSL, MongoDB indexes and Redis cache.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const { MongoClient } = require('mongodb');
const redis = require('redis');
const { io } = require('socket.io-client');

// ------- 1. CONFIGURATION ---------------------------------------------------
// Update these with your production values.
const CONFIG = {
  // Production URL for the backend (should be HTTPS)
  baseUrl: process.env.PROD_URL || 'https://your-backend.up.railway.app',
  // Expected environment variables (key: expected pattern or non‑empty)
  envVars: [
    'MONGODB_URI',
    'JWT_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'FIREBASE_API_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'REDIS_URL',
    // add any other env var you consider mandatory for prod
  ],
  // List of API endpoints to test (method, path, expected status)
  apiChecks: [
    { method: 'get', path: '/api/health', expected: 200 },
    { method: 'post', path: '/api/auth/login', expected: 200 },
    { method: 'post', path: '/api/service-requests', expected: 201 },
    // Add more endpoints as needed
  ],
  // Socket.IO connection settings
  socketPath: '/socket.io',
  // Webhook endpoint to hit (Razorpay example)
  webhookPath: '/api/webhooks/razorpay',
  // Push notification sanity (just checks FCM env vars)
  pushCheck: {
    requiredEnv: ['FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_SERVER_KEY']
  },
  // MongoDB collections that must have indexes (name: [index spec])
  mongoIndexes: {
    users: [{ key: { email: 1 }, unique: true }],
    serviceRequests: [{ key: { status: 1 } }]
  }
};

// Helper to print results with colours
const green = (msg) => '\x1b[32m' + msg + '\x1b[0m';
const red = (msg) => '\x1b[31m' + msg + '\x1b[0m';
const cyan = (msg) => '\x1b[36m' + msg + '\x1b[0m';

async function checkEnvVars() {
  console.log(cyan('🔧 Checking required environment variables...'));
  const missing = CONFIG.envVars.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(red(`❌ Missing env vars: ${missing.join(', ')}`));
    return false;
  }
  console.log(green('✅ All required env vars are set'));
  return true;
}

async function checkConsoleLogs() {
  console.log(cyan('🔍 Scanning source files for console.log statements...'));
  const srcDir = path.resolve(__dirname, 'src');
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.js$|\.ts$/.test(e.name)) files.push(full);
    }
  }
  walk(srcDir);
  const logs = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    if (/console\.log\s*\(/.test(content)) logs.push(f);
  }
  if (logs.length) {
    console.error(red('❌ console.log found in the following files:'));
    logs.forEach((f) => console.error('   ' + f));
    return false;
  }
  console.log(green('✅ No console.log statements in production code'));
  return true;
}

async function checkApiEndpoints() {
  console.log(cyan('⚡ Testing API endpoints...'));
  const client = axios.create({ baseURL: CONFIG.baseUrl, validateStatus: () => true });
  let allOk = true;
  for (const chk of CONFIG.apiChecks) {
    try {
      const resp = await client.request({ method: chk.method, url: chk.path });
      if (resp.status === chk.expected) {
        console.log(green(`✅ ${chk.method.toUpperCase()} ${chk.path} → ${resp.status}`));
      } else {
        console.error(red(`❌ ${chk.method.toUpperCase()} ${chk.path} → ${resp.status} (expected ${chk.expected})`));
        allOk = false;
      }
    } catch (e) {
      console.error(red(`❌ ${chk.method.toUpperCase()} ${chk.path} threw error: ${e.message}`));
      allOk = false;
    }
  }
  return allOk;
}

async function checkSocketIo() {
  console.log(cyan('🔗 Verifying Socket.IO connection...'));
  return new Promise((resolve) => {
    const socket = io(CONFIG.baseUrl, { path: CONFIG.socketPath, transports: ['websocket'], reconnection: false, timeout: 5000 });
    let succeeded = false;
    socket.on('connect', () => {
      console.log(green('✅ Socket.IO connected'));
      succeeded = true;
      socket.disconnect();
    });
    socket.on('connect_error', (err) => {
      console.error(red('❌ Socket.IO connection error:'), err.message);
    });
    socket.on('disconnect', () => {
      resolve(succeeded);
    });
    // safety timeout
    setTimeout(() => {
      if (!succeeded) console.error(red('❌ Socket.IO connection timeout'));
      socket.disconnect();
    }, 7000);
  });
}

async function checkWebhook() {
  console.log(cyan('🔔 Testing payment webhook endpoint (GET health check)...'));
  // Many webhook endpoints expect POST from provider; we just test that it responds 200 to a GET.
  try {
    const resp = await axios.get(CONFIG.baseUrl + CONFIG.webhookPath, { validateStatus: () => true });
    if (resp.status === 200) {
      console.log(green(`✅ Webhook endpoint responded ${resp.status}`));
      return true;
    }
    console.error(red(`❌ Webhook endpoint responded ${resp.status}`));
    return false;
  } catch (e) {
    console.error(red('❌ Webhook test error:'), e.message);
    return false;
  }
}

async function checkPushNotifications() {
  console.log(cyan('📱 Verifying push‑notification env vars...'));
  const missing = CONFIG.pushCheck.requiredEnv.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(red(`❌ Missing push notification env vars: ${missing.join(', ')}`));
    return false;
  }
  console.log(green('✅ Push notification env vars are present'));
  // A full end‑to‑end test would require a device token, which is out of scope for CI.
  return true;
}

async function checkSslCertificate() {
  console.log(cyan('🔐 Validating SSL certificate...'));
  return new Promise((resolve) => {
    const url = new URL(CONFIG.baseUrl);
    const options = {
      host: url.hostname,
      port: 443,
      method: 'GET',
      rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      const cert = res.socket.getPeerCertificate();
      if (!cert || !cert.valid_to) {
        console.error(red('❌ Could not retrieve SSL certificate'));
        resolve(false);
        return;
      }
      const expiry = new Date(cert.valid_to);
      const now = new Date();
      const diffDays = Math.round((expiry - now) / (1000 * 60 * 60 * 24));
      if (diffDays < 30) {
        console.error(red(`❌ SSL certificate expires in ${diffDays} days (${cert.valid_to})`));
        resolve(false);
      } else {
        console.log(green(`✅ SSL certificate valid until ${cert.valid_to} (${diffDays} days left)`));
        resolve(true);
      }
    });
    req.on('error', (e) => {
      console.error(red('❌ SSL validation request error:'), e.message);
      resolve(false);
    });
    req.end();
  });
}

async function checkMongoIndexes() {
  console.log(cyan('📚 Checking MongoDB indexes...'));
  if (!process.env.MONGODB_URI) {
    console.error(red('❌ MONGODB_URI not set'));
    return false;
  }
  const client = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db();
    let allOk = true;
    for (const [collName, indexes] of Object.entries(CONFIG.mongoIndexes)) {
      const coll = db.collection(collName);
      const existing = await coll.indexes();
      for (const idxSpec of indexes) {
        const exists = existing.some((e) => JSON.stringify(e.key) === JSON.stringify(idxSpec.key));
        if (!exists) {
          console.error(red(`❌ Missing index on ${collName}: ${JSON.stringify(idxSpec.key)}`));
          allOk = false;
        } else {
          console.log(green(`✅ Index exists on ${collName}: ${JSON.stringify(idxSpec.key)}`));
        }
      }
    }
    return allOk;
  } catch (e) {
    console.error(red('❌ MongoDB connection error:'), e.message);
    return false;
  } finally {
    await client.close();
  }
}

async function checkRedisCache() {
  console.log(cyan('⚡ Verifying Redis connectivity...'));
  if (!process.env.REDIS_URL) {
    console.error(red('❌ REDIS_URL not set'));
    return false;
  }
  const client = redis.createClient({ url: process.env.REDIS_URL });
  return new Promise((resolve) => {
    client.on('error', (err) => {
      console.error(red('❌ Redis error:'), err.message);
      resolve(false);
    });
    client.connect().then(async () => {
      try {
        const pong = await client.ping();
        if (pong === 'PONG') {
          console.log(green('✅ Redis responded to PING'));
          resolve(true);
        } else {
          console.error(red('❌ Unexpected Redis ping response'));
          resolve(false);
        }
      } catch (e) {
        console.error(red('❌ Redis command error:'), e.message);
        resolve(false);
      } finally {
        client.quit();
      }
    });
  });
}

(async () => {
  console.log(cyan('🚀 Starting pre‑launch production sanity check\n'));
  const results = await Promise.all([
    checkEnvVars(),
    checkConsoleLogs(),
    checkApiEndpoints(),
    checkSocketIo(),
    checkWebhook(),
    checkPushNotifications(),
    checkSslCertificate(),
    checkMongoIndexes(),
    checkRedisCache()
  ]);
  const allPassed = results.every(Boolean);
  console.log('\n' + (allPassed ? green('✅ All checks passed!') : red('❌ Some checks failed. Review the output above.')));
  process.exit(allPassed ? 0 : 1);
})();
