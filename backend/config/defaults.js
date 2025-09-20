/**
 * Default Platform Settings
 * 
 * This file contains fallback values for all platform settings.
 * These defaults ensure the application always has predictable values
 * even if settings are missing from the database.
 * 
 * CRITICAL: This is the safety net that prevents backend errors
 * from affecting the application functionality.
 */

const defaultSettings = {
  // Application Settings
  appName: "Educaty",
  appDescription: "Modern EdTech Platform for Online Learning",
  appVersion: "1.0.0",
  maintenanceMode: false,
  maintenanceMessage: "We are currently performing scheduled maintenance. Please check back soon.",
  
  // System Settings
  maxFileSize: 50 * 1024 * 1024, // 50MB in bytes
  allowedFileTypes: [".jpg", ".jpeg", ".png", ".gif", ".pdf", ".doc", ".docx", ".mp4", ".mov", ".avi"],
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  
  // Payment Settings
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  paymentGatewayEnabled: true,
  
  // Email Settings
  emailFrom: process.env.SMTP_USER || "noreply@educaty.com",
  emailReplyTo: process.env.SMTP_USER || "support@educaty.com",
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: parseInt(process.env.SMTP_PORT) || 587,
  smtpSecure: false,
  
  // Course Settings
  defaultCourseDuration: 30, // days
  maxStudentsPerBatch: 1000,
  allowSelfEnrollment: true,
  
  // User Settings
  requireEmailVerification: true,
  passwordMinLength: 8,
  allowSocialLogin: false,
  
  // Notification Settings
  enableEmailNotifications: true,
  enablePushNotifications: true,
  notificationRetentionDays: 30,
  
  // Content Settings
  videoQualityOptions: ["360p", "480p", "720p", "1080p"],
  enableVideoDownload: true,
  contentCacheExpiry: 5 * 60 * 1000, // 5 minutes
  
  // Security Settings
  enableTwoFactorAuth: false,
  loginAttemptLimit: 5,
  accountLockoutDuration: 15 * 60 * 1000, // 15 minutes
  
  // UI Settings
  defaultTheme: "light",
  enableDarkMode: true,
  primaryColor: "#3B82F6", // blue-500
  secondaryColor: "#10B981", // green-500
  
  // Contact Information
  contactEmail: "support@educaty.com",
  contactPhone: "+1-234-567-8900",
  contactAddress: "123 Education Street, Learning City, LC 12345",
  supportUrl: "https://educaty.com/support",
  
  // Timestamps
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Get default settings with environment variable overrides
 * @returns {Object} Complete settings object with defaults
 */
function getDefaultSettings() {
  return {
    ...defaultSettings,
    // Override with environment variables if available
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || defaultSettings.razorpayKeyId,
    emailFrom: process.env.SMTP_USER || defaultSettings.emailFrom,
    emailReplyTo: process.env.SMTP_USER || defaultSettings.emailReplyTo,
    smtpHost: process.env.SMTP_HOST || defaultSettings.smtpHost,
    smtpPort: parseInt(process.env.SMTP_PORT) || defaultSettings.smtpPort,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Merge database settings with defaults
 * @param {Object} dbSettings - Settings from database
 * @returns {Object} Merged settings with defaults as fallback
 */
function mergeWithDefaults(dbSettings = {}) {
  const defaults = getDefaultSettings();
  
  // Deep merge function to handle nested objects
  function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  return deepMerge(defaults, dbSettings);
}

module.exports = {
  defaultSettings,
  getDefaultSettings,
  mergeWithDefaults
};