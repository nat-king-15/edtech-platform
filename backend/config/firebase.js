const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    console.log('🚀 Initializing Firebase Admin SDK...');
    
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // Check if service account credentials are available
      if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        // Initialize with service account credentials
        const serviceAccount = {
          type: 'service_account',
          project_id: process.env.FIREBASE_PROJECT_ID || 'educaty-4651e',
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
          client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
        };

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
        
        console.log('✅ Firebase Admin SDK initialized with service account credentials');
      } else {
        // Initialize with storage bucket configuration only (for basic operations)
        admin.initializeApp({
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
        
        console.log('⚠️ Firebase Admin SDK initialized with limited configuration (no service account)');
      }
    }

    return admin;
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin SDK:', error.message);
    throw error;
  }
};

// Initialize Firebase
const firebaseAdmin = initializeFirebase();

// Export Firebase services (real services only)
module.exports = {
  admin: firebaseAdmin,
  auth: firebaseAdmin.auth(),
  firestore: firebaseAdmin.firestore(),
  storage: firebaseAdmin.storage(),
  FieldValue: admin.firestore.FieldValue,
  // Legacy exports for backward compatibility
  db: firebaseAdmin.firestore()
};