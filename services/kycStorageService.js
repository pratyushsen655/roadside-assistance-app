const admin = require('firebase-admin');

function getFirebaseApp() {
  if (admin.apps && admin.apps.length > 0) {
    return admin.apps[0];
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey || privateKey.includes('PASTE_YOUR_REAL_PRIVATE_KEY_HERE')) {
    return null;
  }
  try {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
      storageBucket,
    });
  } catch (err) {
    console.error('[KYC Storage] Firebase init error:', err.message);
    return null;
  }
}

const uploadKycDocument = async (fileBuffer, mechanicId, originalName, mimetype) => {
  const app = getFirebaseApp();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'roadmitra-79fb5.appspot.com';
  const safeName = (originalName || 'doc.jpg').replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const filename = `kyc-documents/${mechanicId}/${Date.now()}-${safeName}`;

  if (app) {
    try {
      const bucket = admin.storage().bucket(bucketName);
      const file = bucket.file(filename);
      await file.save(fileBuffer, { metadata: { contentType: mimetype } });
      try {
        await file.makePublic();
      } catch (pubErr) {
        console.warn('[KYC Storage] Warning making file public:', pubErr.message);
      }
      return `https://storage.googleapis.com/${bucket.name}/${filename}`;
    } catch (err) {
      console.error('[KYC Storage] Upload to Firebase failed:', err.message);
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  }

  // Development/Mock fallback when Firebase credentials are missing or upload fails
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[MOCK KYC Storage] File saved in mock mode for mechanic ${mechanicId}: ${filename}`);
    return `https://storage.googleapis.com/${bucketName}/${filename}`;
  }

  throw new Error('Firebase Storage is not configured properly');
};

module.exports = { uploadKycDocument };