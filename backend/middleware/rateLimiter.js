const rateLimit = require('express-rate-limit');
const { db } = require('../config/firebase');

/**
 * Rate limiting configurations for different endpoints
 */
const rateLimitConfigs = {
  // General API rate limit
  general: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res) => {
      // Log rate limit violations for security monitoring
      await logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests from this IP, please try again later.',
          retryAfter: '15 minutes'
        },
        timestamp: new Date().toISOString()
      });
    }
  }),

  // Strict rate limit for authentication endpoints
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 login attempts per windowMs
    message: {
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
      },
      timestamp: new Date().toISOString()
    },
    skipSuccessfulRequests: true,
    handler: async (req, res) => {
      await logSecurityEvent({
        type: 'AUTH_RATE_LIMIT_EXCEEDED',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'AUTH_RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts, please try again later.',
          retryAfter: '15 minutes'
        },
        timestamp: new Date().toISOString()
      });
    }
  }),

  // File upload rate limit
  upload: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each IP to 20 uploads per hour
    message: {
      success: false,
      error: {
        code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
        message: 'Too many file uploads, please try again later.',
        retryAfter: '1 hour'
      },
      timestamp: new Date().toISOString()
    }
  }),

  // Payment endpoints - very strict
  payment: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 payment attempts per hour
    message: {
      success: false,
      error: {
        code: 'PAYMENT_RATE_LIMIT_EXCEEDED',
        message: 'Too many payment attempts, please try again later.',
        retryAfter: '1 hour'
      },
      timestamp: new Date().toISOString()
    }
  })
};

/**
 * Log security events to Firestore for monitoring
 */
async function logSecurityEvent(eventData) {
  try {
    await db.collection('security_logs').add({
      ...eventData,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Advanced rate limiter with user-based tracking
 */
const createUserBasedRateLimit = (options) => {
  const store = new Map();
  
  return async (req, res, next) => {
    const key = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - options.windowMs;
    
    // Clean old entries
    if (store.has(key)) {
      const userRequests = store.get(key).filter(time => time > windowStart);
      store.set(key, userRequests);
    }
    
    const requests = store.get(key) || [];
    
    if (requests.length >= options.max) {
      await logSecurityEvent({
        type: 'USER_RATE_LIMIT_EXCEEDED',
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message || 'Too many requests, please try again later.',
          retryAfter: Math.ceil(options.windowMs / 1000 / 60) + ' minutes'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    requests.push(now);
    store.set(key, requests);
    next();
  };
};

module.exports = {
  rateLimitConfigs,
  createUserBasedRateLimit,
  logSecurityEvent
};