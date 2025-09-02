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
  // Application Configuration
  appName: "Educaty",
  appDescription: "Modern EdTech Platform for Online Learning",
  appVersion: "1.0.0",
  
  // System Settings
  maintenanceMode: false,
  maintenanceMessage: "We are currently performing scheduled maintenance. Please check back soon.",
  
  // Payment Configuration
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  paymentEnabled: true,
  
  // Email Configuration
  emailEnabled: true,
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: parseInt(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || "",
  smtpPassword: process.env.SMTP_PASSWORD || "",
  
  // File Upload Settings
  maxFileSize: 50 * 1024 * 1024, // 50MB in bytes
  allowedFileTypes: [".jpg", ".jpeg", ".png", ".gif", ".pdf", ".doc", ".docx", ".mp4", ".mov", ".avi"],
  
  // Course Settings
  maxCoursesPerBatch: 100,
  maxStudentsPerBatch: 1000,
  defaultCourseDuration: 30, // days
  
  // User Settings
  maxLoginAttempts: 5,
  sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  passwordMinLength: 8,
  
  // Notification Settings
  emailNotificationsEnabled: true,
  pushNotificationsEnabled: true,
  smsNotificationsEnabled: false,
  
  // Content Settings
  videoQuality: "720p",
  autoPlayVideos: false,
  downloadEnabled: true,
  
  // Security Settings
  twoFactorAuthEnabled: false,
  ipWhitelistEnabled: false,
  rateLimitEnabled: true,
  rateLimitRequests: 100,
  rateLimitWindow: 15 * 60 * 1000, // 15 minutes
  
  // Analytics Settings
  analyticsEnabled: true,
  trackingEnabled: true,
  
  // Social Media Links
  socialMedia: {
    facebook: "",
    twitter: "",
    instagram: "",
    linkedin: "",
    youtube: ""
  },
  
  // Contact Information
  contactInfo: {
    email: "support@educaty.com",
    phone: "+1-234-567-8900",
    address: "123 Education Street, Learning City, LC 12345",
    supportHours: "Monday - Friday, 9 AM - 6 PM"
  },
  
  // Feature Flags
  features: {
    liveStreaming: true,
    assignments: true,
    quizzes: true,
    certificates: true,
    discussions: true,
    calendar: true,
    reports: true
  },
  
  // UI Customization
  theme: {
    primaryColor: "#3B82F6", // blue-500
    secondaryColor: "#10B981", // green-500
    accentColor: "#F59E0B", // yellow-500
    backgroundColor: "#F9FAFB", // gray-50
    textColor: "#111827", // gray-900
    logoUrl: "",
    faviconUrl: ""
  },
  
  // API Configuration
  apiSettings: {
    timeout: 30000, // 30 seconds
    retryAttempts: 3,
    cacheEnabled: true,
    cacheDuration: 5 * 60 * 1000 // 5 minutes
  },
  
  // Backup Settings
  backupEnabled: true,
  backupFrequency: "daily", // daily, weekly, monthly
  backupRetention: 30, // days
  
  // Logging Settings
  logLevel: "info", // error, warn, info, debug
  logRetention: 90, // days
  
  // Performance Settings
  cacheEnabled: true,
  compressionEnabled: true,
  minifyAssets: true,
  
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
    smtpHost: process.env.SMTP_HOST || defaultSettings.smtpHost,
    smtpPort: parseInt(process.env.SMTP_PORT) || defaultSettings.smtpPort,
    smtpUser: process.env.SMTP_USER || defaultSettings.smtpUser,
    smtpPassword: process.env.SMTP_PASSWORD || defaultSettings.smtpPassword
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