const admin = require('firebase-admin');

// Ensure firebase-admin is initialized only once
if (admin.apps.length === 0) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

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
      console.log('[FCM Service] Firebase Admin SDK initialized successfully.');
    } catch (error) {
      console.error('[FCM Service] Firebase init error:', error.message);
    }
  } else {
    console.log('[FCM Service] Firebase credentials missing — running in mock mode.');
  }
}

/**
 * Send push notification to a specific device token
 * @param {string} pushToken - FCM Device Token
 * @param {string} title - Notification Title
 * @param {string} body - Notification Body
 * @param {object} [data] - Optional metadata payload
 */
const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!pushToken) return;

  // Convert all data properties to strings (Firebase messaging requirement)
  /** @type {Record<string, string>} */
  const stringifiedData = {};
  Object.keys(data).forEach(key => {
    if (typeof data[key] === 'object') {
      stringifiedData[key] = JSON.stringify(data[key]);
    } else {
      stringifiedData[key] = String(data[key]);
    }
  });

  const message = {
    token: pushToken,
    notification: { title, body },
    data: stringifiedData,
    android: {
      notification: {
        icon: 'notification_icon',
        color: '#B34700',
        sound: 'default'
      }
    }
  };

  if (admin.apps.length > 0) {
    try {
      const response = await admin.messaging().send(message);
      console.log(`[FCM] Push sent: ${response}`);
      return response;
    } catch (error) {
      console.error(`[FCM Service] Send error: ${error.message}`);
    }
  }

  // Development mock fallback
  console.log(`[MOCK FCM] → ${pushToken} | ${title} | ${body} | Data: ${JSON.stringify(stringifiedData)}`);
  return { mock: true, pushToken, title, body, data: stringifiedData };
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
  if (!validTokens || validTokens.length === 0) return;

  /** @type {Record<string, string>} */
  const stringifiedData = {};
  Object.keys(data).forEach(key => {
    if (typeof data[key] === 'object') {
      stringifiedData[key] = JSON.stringify(data[key]);
    } else {
      stringifiedData[key] = String(data[key]);
    }
  });

  const message = {
    tokens: validTokens,
    notification: { title, body },
    data: stringifiedData,
  };

  if (admin.apps.length > 0) {
    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[FCM] Multicast sent: ${response.successCount} ok, ${response.failureCount} failed`);
      return response;
    } catch (error) {
      console.error(`[FCM Service] Multicast error: ${error.message}`);
    }
  }

  // Development mock fallback
  console.log(`[MOCK FCM] Multicast → ${validTokens.length} devices | ${title} | ${body} | Data: ${JSON.stringify(stringifiedData)}`);
  return { mock: true, successCount: validTokens.length, failureCount: 0 };
};

/**
 * Send a high-priority, data-only FCM message for incoming requests
 * @param {string} token - FCM device token
 * @param {object} payload - Key-value pair strings
 */
const sendRingingRequestNotification = async (token, payload) => {
  if (!token) return { success: false, error: 'Token is null or undefined' };

  // Convert payload values to strings
  /** @type {Record<string, string>} */
  const stringifiedData = {};
  Object.keys(payload).forEach(key => {
    stringifiedData[key] = String(payload[key]);
  });

  const message = {
    token,
    data: stringifiedData,
    android: {
      priority: 'high',
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'background',
      },
      payload: {
        aps: {
          'content-available': 1,
        },
      },
    },
  };

  if (admin.apps.length > 0) {
    try {
      const response = await admin.messaging().send(/** @type {any} */ (message));
      console.log(`[FCM Success] Sent ringing alert. Message ID: ${response} for token: ${token}`);
      return { success: true, messageId: response };
    } catch (error) {
      console.error(`[FCM Failure] Error sending to token: ${token}. Error: ${error.message}`);
      
      // If FCM returns NotRegistered error, invalidate token in DB
      if (error.code === 'messaging/registration-token-not-registered' || 
          error.message.includes('NotRegistered') || 
          error.message.includes('invalid-registration')) {
        console.log(`[FCM Invalidation] Token ${token} is not registered. Removing from DB...`);
        const Mechanic = require('../models/Mechanic');
        await Mechanic.updateOne(
          { $or: [{ fcmToken: token }, { pushToken: token }] },
          { $set: { fcmToken: null, pushToken: null } }
        );
      }
      return { success: false, error: error.message, code: error.code };
    }
  }

  // Development mock fallback
  console.log(`[MOCK FCM] Ringing Alert → ${token} | Payload: ${JSON.stringify(stringifiedData)}`);
  return { success: true, mock: true, messageId: `mock-msg-id-${Date.now()}` };
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
  sendRingingRequestNotification
};
