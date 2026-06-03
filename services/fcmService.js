const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

let firebaseInitialized = false;

if (projectId && clientEmail && privateKey) {
  try {
    // Process private key linebreaks
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: formattedPrivateKey,
      }),
    });
    firebaseInitialized = true;
    console.log('[FCM Service] Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.warn('[FCM Service] Failed to initialize Firebase Admin SDK:', error.message);
  }
} else {
  console.log('[FCM Service] Firebase credentials missing. Running in mock mode.');
}

/**
 * Send push notification to a specific device token
 * @param {string} token - FCM Device Token
 * @param {string} title - Notification Title
 * @param {string} body - Notification Body
 * @param {object} [data] - Optional metadata payload
 */
const sendPushNotification = async (token, title, body, data = {}) => {
  if (!token) return false;

  // Cast all data properties to string (Firebase requirement)
  const stringifiedData = {};
  Object.keys(data).forEach(key => {
    stringifiedData[key] = String(data[key]);
  });

  if (firebaseInitialized) {
    try {
      const message = {
        notification: { title, body },
        data: stringifiedData,
        token: token,
      };
      const response = await admin.messaging().send(message);
      console.log(`[FCM Service] Push Notification successfully sent: ${response}`);
      return true;
    } catch (error) {
      console.error('[FCM Service] Firebase sending error:', error.message);
    }
  }

  // Fallback Mock Logger
  console.log('\n==================================================');
  console.log(`[MOCK FCM SERVICE] Push Sent to token: ${token}`);
  console.log(`[MOCK FCM SERVICE] Title: ${title}`);
  console.log(`[MOCK FCM SERVICE] Body: ${body}`);
  console.log('[MOCK FCM SERVICE] Data:', stringifiedData);
  console.log('==================================================\n');
  return true;
};

/**
 * Send push notification to multiple device tokens
 * @param {string[]} tokens - Array of FCM Device Tokens
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 */
const sendMulticastNotification = async (tokens, title, body, data = {}) => {
  const validTokens = tokens.filter(t => !!t);
  if (!validTokens || validTokens.length === 0) return false;

  const stringifiedData = {};
  Object.keys(data).forEach(key => {
    stringifiedData[key] = String(data[key]);
  });

  if (firebaseInitialized) {
    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens: validTokens,
        notification: { title, body },
        data: stringifiedData,
      });
      console.log(`[FCM Service] Multicast sent. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);
      return true;
    } catch (error) {
      console.error('[FCM Service] Multicast error:', error.message);
    }
  }

  console.log('\n==================================================');
  console.log(`[MOCK FCM SERVICE] Multicast Sent to ${validTokens.length} devices.`);
  console.log(`[MOCK FCM SERVICE] Title: ${title}`);
  console.log(`[MOCK FCM SERVICE] Body: ${body}`);
  console.log('[MOCK FCM SERVICE] Data:', stringifiedData);
  console.log('==================================================\n');
  return true;
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification
};
