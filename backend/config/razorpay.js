const Razorpay = require('razorpay');
require('dotenv').config();

// Initialize Razorpay instance with credentials from environment variables
const instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Validate that required environment variables are present
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('❌ Razorpay configuration error: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment variables');
    process.exit(1);
}

console.log('✅ Razorpay instance initialized successfully');

module.exports = instance;