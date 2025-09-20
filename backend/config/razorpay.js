const Razorpay = require('razorpay');

let razorpayInstance = null;
let isInitialized = false;
let initializationError = null;

/**
 * Lazy initialization of Razorpay instance
 * @returns {Razorpay} Razorpay instance
 * @throws {Error} When credentials are missing or invalid
 */
function getRazorpayInstance() {
  if (isInitialized) {
    if (initializationError) {
      throw initializationError;
    }
    return razorpayInstance;
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      const error = new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.');
      error.code = 'RAZORPAY_CREDENTIALS_MISSING';
      initializationError = error;
      isInitialized = true;
      throw error;
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    console.log('✅ Razorpay initialized successfully');
    isInitialized = true;
    return razorpayInstance;

  } catch (error) {
    console.error('❌ Failed to initialize Razorpay:', error.message);
    initializationError = error;
    isInitialized = true;
    throw error;
  }
}

/**
 * Check if Razorpay is available (credentials are configured)
 * @returns {boolean} True if Razorpay is available, false otherwise
 */
function isRazorpayAvailable() {
  try {
    getRazorpayInstance();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get Razorpay availability status and error details
 * @returns {Object} Status object with availability and error info
 */
function getRazorpayStatus() {
  try {
    getRazorpayInstance();
    return {
      available: true,
      error: null
    };
  } catch (error) {
    return {
      available: false,
      error: {
        message: error.message,
        code: error.code || 'RAZORPAY_ERROR'
      }
    };
  }
}

// Create a proxy object that lazily initializes Razorpay
const razorpayProxy = new Proxy({
  isRazorpayAvailable,
  getRazorpayStatus
}, {
  get(target, prop) {
    // If it's one of our utility functions, return it directly
    if (prop === 'isRazorpayAvailable' || prop === 'getRazorpayStatus') {
      return target[prop];
    }
    
    // For Razorpay methods, get the instance first
    const instance = getRazorpayInstance();
    const value = instance[prop];
    
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    
    return value;
  }
});

module.exports = razorpayProxy;