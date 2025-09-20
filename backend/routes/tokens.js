const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth } = require('../middleware/authMiddleware');
const tokenService = require('../services/tokenService');
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
 * Generate OTP for phone number
 * Similar to pw-extractor's OTP generation
 */
router.post('/generate-otp',
  [
    body('phoneNumber').isMobilePhone('any').withMessage('Valid phone number is required'),
    body('purpose').optional().isIn(['login', 'registration', 'password_reset']).withMessage('Invalid purpose')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber, purpose = 'login' } = req.body;
      
      const result = await tokenService.generateOTP(phoneNumber, purpose);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'OTP sent successfully',
          otpId: result.otpId,
          expiresAt: result.expiresAt,
          // Don't send actual OTP in production
          ...(process.env.NODE_ENV === 'development' && { otp: result.otp })
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
 * Verify OTP and generate access token
 * Similar to pw-extractor's OTP verification
 */
router.post('/verify-otp',
  [
    body('phoneNumber').isMobilePhone('any').withMessage('Valid phone number is required'),
    body('otp').isLength({ min: 4, max: 6 }).withMessage('OTP must be 4-6 digits'),
    body('otpId').notEmpty().withMessage('OTP ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { phoneNumber, otp, otpId } = req.body;
      
      const verificationResult = await tokenService.verifyOTP(phoneNumber, otp, otpId);
      
      if (!verificationResult.success) {
        return res.status(verificationResult.error_status || 400).json(verificationResult);
      }
      
      // Check if user exists
      const { firestore } = require('../config/firebase');
      const usersSnapshot = await firestore.collection('users')
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();
      
      let userId, userData;
      
      if (usersSnapshot.empty) {
        // Create new user
        const newUserRef = firestore.collection('users').doc();
        userId = newUserRef.id;
        userData = {
          phoneNumber,
          role: 'student',
          createdAt: admin.firestore.Timestamp.fromDate(new Date()),
          isActive: true,
          profile: {
            isComplete: false
          }
        };
        
        await newUserRef.set(userData);
      } else {
        const userDoc = usersSnapshot.docs[0];
        userId = userDoc.id;
        userData = userDoc.data();
      }
      
      // Generate access token
      const tokenResult = await tokenService.generateAccessToken(userId, {
        phoneNumber: userData.phoneNumber,
        role: userData.role,
        email: userData.email || null
      });
      
      if (tokenResult.success) {
        res.json({
          success: true,
          message: 'OTP verified successfully',
          user: {
            id: userId,
            phoneNumber: userData.phoneNumber,
            role: userData.role,
            email: userData.email || null,
            name: userData.name || null,
            profileComplete: userData.profile?.isComplete || false
          },
          token: tokenResult.token,
          expiresAt: tokenResult.expiresAt
        });
      } else {
        res.status(tokenResult.error_status || 500).json(tokenResult);
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Refresh access token
 * Similar to pw-extractor's token refresh
 */
router.post('/refresh',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      // Get current user data
      const { firestore } = require('../config/firebase');
      const userDoc = await firestore.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          error_message: 'User not found'
        });
      }
      
      const userData = userDoc.data();
      
      const result = await tokenService.refreshToken(userId, {
        phoneNumber: userData.phoneNumber,
        role: userData.role,
        email: userData.email || null
      });
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Token refreshed successfully',
          token: result.token,
          expiresAt: result.expiresAt
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error refreshing token:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get token information
 */
router.get('/info',
  requireAuth,
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error_message: 'No token provided'
        });
      }
      
      const result = await tokenService.getTokenExpiry(token);
      
      if (result.success) {
        res.json({
          success: true,
          tokenInfo: {
            isValid: result.isValid,
            expiresAt: result.expiresAt,
            timeUntilExpiry: result.timeUntilExpiry,
            user: {
              id: req.user.uid,
              email: req.user.email,
              role: req.user.role
            }
          }
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting token info:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Verify token validity
 */
router.post('/verify',
  [
    body('token').notEmpty().withMessage('Token is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.body;
      
      const result = await tokenService.verifyAccessToken(token);
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Token is valid',
          user: result.user,
          expiresAt: result.expiresAt
        });
      } else {
        res.status(result.error_status || 401).json(result);
      }
    } catch (error) {
      console.error('Error verifying token:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Logout and invalidate token
 */
router.post('/logout',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      // Add token to blacklist (if implementing token blacklisting)
      const { firestore } = require('../config/firebase');
      
      if (token) {
        await firestore.collection('token_blacklist').add({
          token,
          userId,
          blacklistedAt: admin.firestore.Timestamp.fromDate(new Date()),
          expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)) // 24 hours
        });
      }
      
      // Log logout activity
      await firestore.collection('user_activities').add({
        userId,
        type: 'logout',
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        metadata: {
          userAgent: req.headers['user-agent'] || '',
          ip: req.ip || req.connection.remoteAddress
        }
      });
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get authentication headers for API requests
 */
router.get('/auth-headers',
  requireAuth,
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error_message: 'No token provided'
        });
      }
      
      const result = await tokenService.getAuthHeaders(token);
      
      if (result.success) {
        res.json({
          success: true,
          headers: result.headers
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting auth headers:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Clean up expired OTPs (Admin only)
 */
router.post('/cleanup-otps',
  requireAuth,
  async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error_message: 'Admin access required'
        });
      }
      
      const result = await tokenService.cleanupExpiredOTPs();
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Expired OTPs cleaned up successfully',
          cleanedCount: result.cleanedCount
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error cleaning up OTPs:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get OTP statistics (Admin only)
 */
router.get('/otp-stats',
  requireAuth,
  [
    query('days').optional().isInt({ min: 1, max: 90 }).withMessage('Days must be between 1 and 90')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error_message: 'Admin access required'
        });
      }
      
      const days = parseInt(req.query.days) || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const { firestore } = require('../config/firebase');
      
      // Get OTP statistics
      const otpsSnapshot = await firestore.collection('otps')
        .where('createdAt', '>=', startDate)
        .get();
      
      const otps = otpsSnapshot.docs.map(doc => doc.data());
      
      const stats = {
        totalGenerated: otps.length,
        totalVerified: otps.filter(otp => otp.isVerified).length,
        totalExpired: otps.filter(otp => otp.expiresAt.toDate() < new Date()).length,
        byPurpose: {},
        byDay: {},
        successRate: 0
      };
      
      // Group by purpose
      otps.forEach(otp => {
        stats.byPurpose[otp.purpose] = (stats.byPurpose[otp.purpose] || 0) + 1;
        
        // Group by day
        const dayStr = otp.createdAt.toDate().toISOString().split('T')[0];
        stats.byDay[dayStr] = (stats.byDay[dayStr] || 0) + 1;
      });
      
      // Calculate success rate
      if (stats.totalGenerated > 0) {
        stats.successRate = Math.round((stats.totalVerified / stats.totalGenerated) * 100);
      }
      
      res.json({
        success: true,
        stats,
        period: `${days} days`
      });
    } catch (error) {
      console.error('Error getting OTP statistics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

module.exports = router;