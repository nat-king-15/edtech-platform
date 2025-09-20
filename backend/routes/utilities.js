const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { authMiddleware: requireAuth, requireRole, requireTeacherOrAdmin } = require('../middleware/authMiddleware');
const utilityService = require('../services/utilityService');
const { body, param, query, validationResult } = require('express-validator');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error_message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * Generate secure token
 * Similar to pw-extractor's token generation utilities
 */
router.post('/generate-token',
  requireAuth,
  requireTeacherOrAdmin,
  [
    body('length').optional().isInt({ min: 16, max: 128 }).withMessage('Length must be between 16 and 128'),
    body('type').optional().isIn(['hex', 'base64', 'alphanumeric']).withMessage('Invalid token type')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const length = req.body.length || 32;
      const type = req.body.type || 'hex';
      
      const result = await utilityService.generateSecureToken(length, type);
      
      if (result.success) {
        res.json({
          success: true,
          token: result.token,
          type,
          length
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error generating secure token:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Hash password
 */
router.post('/hash-password',
  requireAuth,
  [
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('saltRounds').optional().isInt({ min: 8, max: 15 }).withMessage('Salt rounds must be between 8 and 15')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { password, saltRounds = 12 } = req.body;
      
      const result = await utilityService.hashPassword(password, saltRounds);
      
      if (result.success) {
        res.json({
          success: true,
          hashedPassword: result.hashedPassword
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error hashing password:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Verify password
 */
router.post('/verify-password',
  requireAuth,
  [
    body('password').notEmpty().withMessage('Password is required'),
    body('hashedPassword').notEmpty().withMessage('Hashed password is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { password, hashedPassword } = req.body;
      
      const result = await utilityService.verifyPassword(password, hashedPassword);
      
      if (result.success) {
        res.json({
          success: true,
          isValid: result.isValid
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error verifying password:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Encrypt data
 */
router.post('/encrypt',
  requireAuth,
  requireTeacherOrAdmin,
  [
    body('data').notEmpty().withMessage('Data is required'),
    body('key').optional().isLength({ min: 32, max: 32 }).withMessage('Key must be exactly 32 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { data, key } = req.body;
      
      const result = await utilityService.encryptData(data, key);
      
      if (result.success) {
        res.json({
          success: true,
          encryptedData: result.encryptedData,
          iv: result.iv
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error encrypting data:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Decrypt data
 */
router.post('/decrypt',
  requireAuth,
  requireTeacherOrAdmin,
  [
    body('encryptedData').notEmpty().withMessage('Encrypted data is required'),
    body('iv').notEmpty().withMessage('IV is required'),
    body('key').optional().isLength({ min: 32, max: 32 }).withMessage('Key must be exactly 32 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { encryptedData, iv, key } = req.body;
      
      const result = await utilityService.decryptData(encryptedData, iv, key);
      
      if (result.success) {
        res.json({
          success: true,
          decryptedData: result.decryptedData
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error decrypting data:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Generate OTP
 */
router.post('/generate-otp',
  requireAuth,
  [
    body('length').optional().isInt({ min: 4, max: 8 }).withMessage('OTP length must be between 4 and 8'),
    body('type').optional().isIn(['numeric', 'alphanumeric']).withMessage('Invalid OTP type')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const length = req.body.length || 6;
      const type = req.body.type || 'numeric';
      
      const result = await utilityService.generateOTP(length, type);
      
      if (result.success) {
        res.json({
          success: true,
          otp: result.otp,
          length,
          type
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error generating OTP:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Validate email
 */
router.post('/validate-email',
  [
    body('email').isEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email } = req.body;
      
      const result = await utilityService.validateEmail(email);
      
      res.json({
        success: true,
        isValid: result.isValid,
        email: result.normalizedEmail,
        domain: result.domain
      });
    } catch (error) {
      console.error('Error validating email:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Validate phone number
 */
router.post('/validate-phone',
  [
    body('phoneNumber').notEmpty().withMessage('Phone number is required'),
    body('countryCode').optional().isLength({ min: 2, max: 3 }).withMessage('Invalid country code')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber, countryCode = 'IN' } = req.body;
      
      const result = await utilityService.validatePhoneNumber(phoneNumber, countryCode);
      
      res.json({
        success: true,
        isValid: result.isValid,
        formattedNumber: result.formattedNumber,
        countryCode: result.countryCode
      });
    } catch (error) {
      console.error('Error validating phone number:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Sanitize string
 */
router.post('/sanitize-string',
  [
    body('input').notEmpty().withMessage('Input string is required'),
    body('options').optional().isObject().withMessage('Options must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { input, options = {} } = req.body;
      
      const result = await utilityService.sanitizeString(input, options);
      
      if (result.success) {
        res.json({
          success: true,
          sanitizedString: result.sanitizedString,
          originalLength: input.length,
          sanitizedLength: result.sanitizedString.length
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error sanitizing string:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Generate unique filename
 */
router.post('/generate-filename',
  requireAuth,
  [
    body('originalName').notEmpty().withMessage('Original filename is required'),
    body('prefix').optional().isString().withMessage('Prefix must be a string'),
    body('includeTimestamp').optional().isBoolean().withMessage('Include timestamp must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { originalName, prefix, includeTimestamp = true } = req.body;
      
      const result = await utilityService.generateUniqueFilename(originalName, prefix, includeTimestamp);
      
      if (result.success) {
        res.json({
          success: true,
          uniqueFilename: result.uniqueFilename,
          originalName,
          extension: result.extension
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error generating unique filename:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Check file type
 */
router.post('/check-file-type',
  [
    body('filename').notEmpty().withMessage('Filename is required'),
    body('allowedTypes').optional().isArray().withMessage('Allowed types must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { filename, allowedTypes } = req.body;
      
      const result = await utilityService.checkFileType(filename, allowedTypes);
      
      res.json({
        success: true,
        fileType: result.fileType,
        extension: result.extension,
        isAllowed: result.isAllowed,
        mimeType: result.mimeType
      });
    } catch (error) {
      console.error('Error checking file type:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Format file size
 */
router.post('/format-file-size',
  [
    body('sizeInBytes').isNumeric().withMessage('Size in bytes must be a number'),
    body('precision').optional().isInt({ min: 0, max: 3 }).withMessage('Precision must be between 0 and 3')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sizeInBytes, precision = 2 } = req.body;
      
      const result = await utilityService.formatFileSize(sizeInBytes, precision);
      
      res.json({
        success: true,
        formattedSize: result.formattedSize,
        unit: result.unit,
        originalSize: sizeInBytes
      });
    } catch (error) {
      console.error('Error formatting file size:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Format date and time
 */
router.post('/format-datetime',
  [
    body('date').isISO8601().withMessage('Valid ISO date is required'),
    body('format').optional().isString().withMessage('Format must be a string'),
    body('timezone').optional().isString().withMessage('Timezone must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { date, format, timezone } = req.body;
      
      const result = await utilityService.formatDateTime(admin.firestore.Timestamp.fromDate(new Date(date)), format, timezone);
      
      if (result.success) {
        res.json({
          success: true,
          formattedDate: result.formattedDate,
          originalDate: date,
          format: result.format,
          timezone: result.timezone
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error formatting date time:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Calculate time difference
 */
router.post('/time-difference',
  [
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    body('endDate').isISO8601().withMessage('Valid end date is required'),
    body('unit').optional().isIn(['milliseconds', 'seconds', 'minutes', 'hours', 'days']).withMessage('Invalid unit')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { startDate, endDate, unit = 'minutes' } = req.body;
      
      const result = await utilityService.getTimeDifference(admin.firestore.Timestamp.fromDate(new Date(startDate)), admin.firestore.Timestamp.fromDate(new Date(endDate)), unit);
      
      if (result.success) {
        res.json({
          success: true,
          difference: result.difference,
          unit,
          startDate,
          endDate,
          humanReadable: result.humanReadable
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error calculating time difference:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Rate limiting check
 */
router.post('/rate-limit-check',
  requireAuth,
  [
    body('identifier').notEmpty().withMessage('Identifier is required'),
    body('limit').isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    body('windowMs').isInt({ min: 1000 }).withMessage('Window must be at least 1000ms')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { identifier, limit, windowMs } = req.body;
      
      const result = await utilityService.checkRateLimit(identifier, limit, windowMs);
      
      if (result.success) {
        res.json({
          success: true,
          allowed: result.allowed,
          remaining: result.remaining,
          resetTime: result.resetTime,
          identifier
        });
      } else {
        res.status(result.error_status || 429).json(result);
      }
    } catch (error) {
      console.error('Error checking rate limit:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Save configuration (Admin only)
 */
router.post('/config/save',
  requireAuth,
  requireRole('admin'),
  [
    body('key').notEmpty().withMessage('Configuration key is required'),
    body('value').notEmpty().withMessage('Configuration value is required'),
    body('description').optional().isString().withMessage('Description must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { key, value, description } = req.body;
      
      const result = await utilityService.saveConfig(key, value, description);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Configuration saved successfully',
          key,
          savedAt: result.savedAt
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Load configuration
 */
router.get('/config/:key',
  requireAuth,
  [
    param('key').notEmpty().withMessage('Configuration key is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { key } = req.params;
      
      const result = await utilityService.loadConfig(key);
      
      if (result.success) {
        res.json({
          success: true,
          key,
          value: result.value,
          description: result.description,
          updatedAt: result.updatedAt
        });
      } else {
        res.status(result.error_status || 404).json(result);
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get all configurations (Admin only)
 */
router.get('/config',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { firestore } = require('../config/firebase');
      
      const configSnapshot = await firestore.collection('configurations').get();
      
      const configurations = configSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        updatedAt: doc.data().updatedAt?.toDate()
      }));
      
      res.json({
        success: true,
        configurations,
        count: configurations.length
      });
    } catch (error) {
      console.error('Error getting configurations:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * System health check
 */
router.get('/health',
  async (req, res) => {
    try {
      const { firestore } = require('../config/firebase');
      
      // Check database connectivity
      const testDoc = await firestore.collection('health_check').doc('test').get();
      
      // Check memory usage
      const memoryUsage = process.memoryUsage();
      
      // Check uptime
      const uptime = process.uptime();
      
      res.json({
        success: true,
        status: 'healthy',
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        services: {
          database: 'connected',
          memory: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
          },
          uptime: Math.round(uptime) + ' seconds'
        }
      });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        error_message: 'Service unavailable',
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });
    }
  }
);

module.exports = router;