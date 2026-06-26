const admin = require('firebase-admin');
// dotenv already loaded by entry point (server.js)

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

let firebaseInitialized = false;

if (projectId && clientEmail && privateKey) {
  try {
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: formattedPrivateKey,
      }),
    });
    firebaseInitialized = true;
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write('[FCM Service] Firebase Admin SDK initialized.\n');
    }
  } catch (error) {
    process.stderr.write(`[FCM Service] Firebase init error: ${error.message}\n`);
  }
} else if (process.env.NODE_ENV !== 'production') {
  process.stdout.write('[FCM Service] Firebase credentials missing — running in mock mode.\n');
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
  /** @type {{ [key: string]: string }} */
  const stringifiedData = {};
  Object.keys(data).forEach(key => {
    stringifiedData[key] = String(data[key]);
  });

  if (firebaseInitialized) {
    try {
      const message = {
        notification: { title, body },
        data: stringifiedData,
        token,
      };
      const response = await admin.messaging().send(message);
      if (process.env.NODE_ENV !== 'production') {
        process.stdout.write(`[FCM] Push sent: ${response}\n`);
      }
      return true;
    } catch (error) {
      process.stderr.write(`[FCM Service] Send error: ${error.message}\n`);
    }
  }

  // Development mock fallback
  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`[MOCK FCM] → ${token} | ${title} | ${body}\n`);
  }
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

  /** @type {{ [key: string]: string }} */
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
      if (process.env.NODE_ENV !== 'production') {
        process.stdout.write(`[FCM] Multicast: ${response.successCount} ok, ${response.failureCount} failed\n`);
      }
      return true;
    } catch (error) {
      process.stderr.write(`[FCM Service] Multicast error: ${error.message}\n`);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`[MOCK FCM] Multicast → ${validTokens.length} devices | ${title}\n`);
  }
  return true;
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification
};
