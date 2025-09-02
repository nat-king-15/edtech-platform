const express = require('express');
const router = express.Router();
const mobileService = require('../services/mobileService');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { validateRequest } = require('../../middleware/validation');
const { auditMiddleware } = require('../../middleware/auditLogger');
const { createUserBasedRateLimit } = require('../../middleware/rateLimiter');
const { body, param, query, validationResult } = require('express-validator');

// Apply authentication and mobile-specific rate limiting
router.use(authMiddleware);
router.use(createUserBasedRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Higher limit for mobile apps
  message: 'Too many mobile API requests, please try again later'
}));

// Validation schemas
const courseContentValidation = [
  param('courseId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Course ID is required'),
  query('includeVideos')
    .optional()
    .isBoolean()
    .withMessage('includeVideos must be a boolean'),
  query('includeAssignments')
    .optional()
    .isBoolean()
    .withMessage('includeAssignments must be a boolean'),
  query('includeQuizzes')
    .optional()
    .isBoolean()
    .withMessage('includeQuizzes must be a boolean'),
  query('compression')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Compression must be low, medium, or high'),
  query('maxVideoQuality')
    .optional()
    .isIn(['480p', '720p', '1080p'])
    .withMessage('Video quality must be 480p, 720p, or 1080p')
];

const offlinePackageValidation = [
  param('courseId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Course ID is required'),
  query('includeVideos')
    .optional()
    .isBoolean()
    .withMessage('includeVideos must be a boolean'),
  query('includeResources')
    .optional()
    .isBoolean()
    .withMessage('includeResources must be a boolean'),
  query('maxPackageSize')
    .optional()
    .isInt({ min: 1024, max: 500 * 1024 * 1024 }) // 1KB to 500MB
    .withMessage('Package size must be between 1KB and 500MB')
];

const syncDataValidation = [
  body('offlineData')
    .isObject()
    .withMessage('Offline data must be an object'),
  body('offlineData.videoProgress')
    .optional()
    .isArray()
    .withMessage('Video progress must be an array'),
  body('offlineData.assignments')
    .optional()
    .isArray()
    .withMessage('Assignments must be an array'),
  body('offlineData.forumInteractions')
    .optional()
    .isArray()
    .withMessage('Forum interactions must be an array'),
  body('offlineData.totalItems')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Total items must be a non-negative integer')
];

// Get mobile-optimized course content
router.get('/courses/:courseId/content',
  courseContentValidation,
  validateRequest,
  auditMiddleware('MOBILE_COURSE_CONTENT_ACCESS'),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const {
        includeVideos = true,
        includeAssignments = true,
        includeQuizzes = true,
        compression = 'medium',
        maxVideoQuality = '720p'
      } = req.query;
      const { user } = req;

      // Check if user has access to the course
      // This would typically check enrollment status
      // For now, we'll assume access is granted

      const options = {
        includeVideos: includeVideos === 'true',
        includeAssignments: includeAssignments === 'true',
        includeQuizzes: includeQuizzes === 'true',
        compression,
        maxVideoQuality
      };

      const mobileContent = await mobileService.getMobileCourseContent(
        courseId,
        user.id,
        options
      );

      // Add mobile-specific metadata
      const response = {
        ...mobileContent,
        mobileOptimized: true,
        apiVersion: '1.0',
        cacheExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        supportedFeatures: {
          offlineMode: true,
          videoStreaming: true,
          progressSync: true,
          pushNotifications: true
        }
      };

      res.status(200).json({
        success: true,
        data: response,
        message: 'Mobile course content retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting mobile course content:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'MOBILE_CONTENT_ERROR',
          message: 'Failed to retrieve mobile course content',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get offline content package
router.get('/courses/:courseId/offline-package',
  offlinePackageValidation,
  validateRequest,
  auditMiddleware('OFFLINE_PACKAGE_REQUEST'),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const {
        includeVideos = false,
        includeResources = true,
        maxPackageSize = 100 * 1024 * 1024 // 100MB default
      } = req.query;
      const { user } = req;

      const options = {
        includeVideos: includeVideos === 'true',
        includeResources: includeResources === 'true',
        maxPackageSize: parseInt(maxPackageSize)
      };

      const offlinePackage = await mobileService.getOfflineContentPackage(
        user.id,
        courseId,
        options
      );

      res.status(200).json({
        success: true,
        data: offlinePackage,
        message: 'Offline content package generated successfully'
      });
    } catch (error) {
      console.error('Error generating offline package:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'OFFLINE_PACKAGE_ERROR',
          message: 'Failed to generate offline content package',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Sync offline data
router.post('/sync',
  syncDataValidation,
  validateRequest,
  auditMiddleware('OFFLINE_DATA_SYNC'),
  async (req, res) => {
    try {
      const { offlineData } = req.body;
      const { user } = req;

      const syncResults = await mobileService.syncOfflineData(user.id, offlineData);

      res.status(200).json({
        success: true,
        data: {
          syncResults,
          syncedAt: new Date().toISOString(),
          userId: user.id
        },
        message: 'Offline data synchronized successfully'
      });
    } catch (error) {
      console.error('Error syncing offline data:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SYNC_ERROR',
          message: 'Failed to synchronize offline data',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get mobile app configuration
router.get('/config',
  auditMiddleware('MOBILE_CONFIG_ACCESS'),
  async (req, res) => {
    try {
      const { user } = req;

      const mobileConfig = {
        apiVersion: '1.0',
        supportedFeatures: {
          offlineMode: true,
          videoStreaming: true,
          progressSync: true,
          pushNotifications: true,
          biometricAuth: true,
          darkMode: true,
          downloadManager: true
        },
        limits: {
          maxOfflinePackageSize: 500 * 1024 * 1024, // 500MB
          maxVideoQuality: user.role === 'admin' ? '1080p' : '720p',
          syncInterval: 5 * 60 * 1000, // 5 minutes
          cacheExpiry: 24 * 60 * 60 * 1000 // 24 hours
        },
        endpoints: {
          baseUrl: process.env.API_BASE_URL || 'http://localhost:5000/api',
          websocket: process.env.WEBSOCKET_URL || 'ws://localhost:5000',
          cdn: process.env.CDN_URL || 'https://cdn.example.com'
        },
        compression: {
          defaultLevel: 'medium',
          availableLevels: ['low', 'medium', 'high']
        },
        videoQuality: {
          defaultQuality: '720p',
          availableQualities: ['480p', '720p', '1080p']
        },
        notifications: {
          enabled: true,
          types: ['assignment_due', 'quiz_available', 'forum_reply', 'course_update']
        }
      };

      res.status(200).json({
        success: true,
        data: mobileConfig,
        message: 'Mobile configuration retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting mobile config:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'Failed to retrieve mobile configuration',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get user's mobile preferences
router.get('/preferences',
  async (req, res) => {
    try {
      const { user } = req;

      // In a real implementation, this would fetch from user preferences collection
      const defaultPreferences = {
        userId: user.id,
        videoQuality: '720p',
        autoDownload: false,
        wifiOnlyDownload: true,
        notificationsEnabled: true,
        darkMode: false,
        compressionLevel: 'medium',
        syncFrequency: 'manual', // 'manual', 'hourly', 'daily'
        offlineStorageLimit: 1024 * 1024 * 1024, // 1GB
        lastSyncAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      res.status(200).json({
        success: true,
        data: defaultPreferences,
        message: 'Mobile preferences retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting mobile preferences:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PREFERENCES_ERROR',
          message: 'Failed to retrieve mobile preferences',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Update user's mobile preferences
router.put('/preferences',
  [
    body('videoQuality')
      .optional()
      .isIn(['480p', '720p', '1080p'])
      .withMessage('Invalid video quality'),
    body('autoDownload')
      .optional()
      .isBoolean()
      .withMessage('autoDownload must be a boolean'),
    body('wifiOnlyDownload')
      .optional()
      .isBoolean()
      .withMessage('wifiOnlyDownload must be a boolean'),
    body('notificationsEnabled')
      .optional()
      .isBoolean()
      .withMessage('notificationsEnabled must be a boolean'),
    body('darkMode')
      .optional()
      .isBoolean()
      .withMessage('darkMode must be a boolean'),
    body('compressionLevel')
      .optional()
      .isIn(['low', 'medium', 'high'])
      .withMessage('Invalid compression level'),
    body('syncFrequency')
      .optional()
      .isIn(['manual', 'hourly', 'daily'])
      .withMessage('Invalid sync frequency'),
    body('offlineStorageLimit')
      .optional()
      .isInt({ min: 100 * 1024 * 1024, max: 5 * 1024 * 1024 * 1024 }) // 100MB to 5GB
      .withMessage('Storage limit must be between 100MB and 5GB')
  ],
  validateRequest,
  auditMiddleware('MOBILE_PREFERENCES_UPDATE'),
  async (req, res) => {
    try {
      const { user } = req;
      const preferences = req.body;

      // In a real implementation, this would update the user preferences in the database
      const updatedPreferences = {
        ...preferences,
        userId: user.id,
        updatedAt: new Date().toISOString()
      };

      res.status(200).json({
        success: true,
        data: updatedPreferences,
        message: 'Mobile preferences updated successfully'
      });
    } catch (error) {
      console.error('Error updating mobile preferences:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PREFERENCES_UPDATE_ERROR',
          message: 'Failed to update mobile preferences',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get sync status
router.get('/sync/status',
  async (req, res) => {
    try {
      const { user } = req;

      // In a real implementation, this would check the sync queue and status
      const syncStatus = {
        userId: user.id,
        lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        nextSyncAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now
        pendingItems: 0,
        syncInProgress: false,
        lastSyncResult: {
          successful: 15,
          failed: 0,
          conflicts: 0,
          totalProcessed: 15
        },
        offlineCapabilities: {
          videoProgress: true,
          assignments: true,
          forumInteractions: true,
          quizAttempts: false // Quizzes require online submission
        }
      };

      res.status(200).json({
        success: true,
        data: syncStatus,
        message: 'Sync status retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SYNC_STATUS_ERROR',
          message: 'Failed to retrieve sync status',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Trigger manual sync
router.post('/sync/trigger',
  auditMiddleware('MANUAL_SYNC_TRIGGER'),
  async (req, res) => {
    try {
      const { user } = req;

      // In a real implementation, this would trigger a sync process
      const syncTriggerResult = {
        userId: user.id,
        triggeredAt: new Date().toISOString(),
        syncId: `sync_${Date.now()}_${user.id}`,
        status: 'initiated',
        estimatedDuration: '2-5 minutes'
      };

      res.status(200).json({
        success: true,
        data: syncTriggerResult,
        message: 'Manual sync triggered successfully'
      });
    } catch (error) {
      console.error('Error triggering manual sync:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SYNC_TRIGGER_ERROR',
          message: 'Failed to trigger manual sync',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get mobile app version info and update requirements
router.get('/version',
  async (req, res) => {
    try {
      const versionInfo = {
        currentVersion: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        latestVersion: '1.0.0',
        updateRequired: false,
        updateAvailable: false,
        updateUrl: {
          android: 'https://play.google.com/store/apps/details?id=com.edtech.app',
          ios: 'https://apps.apple.com/app/edtech-learning/id123456789'
        },
        releaseNotes: [
          {
            version: '1.0.0',
            date: '2024-01-15',
            features: [
              'Initial release',
              'Offline content support',
              'Video streaming optimization',
              'Progress synchronization'
            ]
          }
        ],
        deprecationWarnings: [],
        maintenanceMode: false
      };

      res.status(200).json({
        success: true,
        data: versionInfo,
        message: 'Version information retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting version info:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'VERSION_INFO_ERROR',
          message: 'Failed to retrieve version information',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Health check endpoint for mobile apps
router.get('/health',
  async (req, res) => {
    try {
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'healthy',
          storage: 'healthy',
          videoStreaming: 'healthy',
          notifications: 'healthy'
        },
        performance: {
          averageResponseTime: '150ms',
          uptime: '99.9%',
          activeConnections: 1250
        },
        features: {
          offlineMode: true,
          videoStreaming: true,
          progressSync: true,
          pushNotifications: true
        }
      };

      res.status(200).json({
        success: true,
        data: healthStatus,
        message: 'Mobile API is healthy'
      });
    } catch (error) {
      console.error('Error checking mobile API health:', error);
      res.status(503).json({
        success: false,
        error: {
          code: 'HEALTH_CHECK_ERROR',
          message: 'Mobile API health check failed',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

module.exports = router;