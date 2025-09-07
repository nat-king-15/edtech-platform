const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK with environment variables
const initializeFirebase = () => {
  try {
    console.log('🚀 Initializing Firebase with real credentials...');
    
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // Validate required environment variables
      const requiredEnvVars = [
        'FIREBASE_PROJECT_ID',
        'FIREBASE_PRIVATE_KEY',
        'FIREBASE_CLIENT_EMAIL'
      ];
      
      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
      }

      // Parse the private key (handle newlines properly)
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      
      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: privateKey,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
        token_uri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      
      console.log('✅ Firebase Admin SDK initialized successfully');
      console.log('📊 Project ID:', process.env.FIREBASE_PROJECT_ID);
      console.log('📧 Service Account:', process.env.FIREBASE_CLIENT_EMAIL);
    }

    return admin;
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin SDK:', error.message);
    throw error; // Re-throw to stop server startup if real credentials fail
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
  database: firebaseAdmin.database(),
  FieldValue: admin.firestore.FieldValue,
  // Legacy exports for backward compatibility
  db: firebaseAdmin.firestore()
};