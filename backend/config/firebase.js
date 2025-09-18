const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK
const initializeFirebase = () => {
  try {
    console.log('🚀 Initializing Firebase Admin SDK...');
    
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // In Firebase Functions, credentials are automatically provided
      // We don't need to manually configure service account
      admin.initializeApp();
      
      console.log('✅ Firebase Admin SDK initialized successfully');
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
  database: firebaseAdmin.database(),
  FieldValue: admin.firestore.FieldValue,
  // Legacy exports for backward compatibility
  db: firebaseAdmin.firestore()
};