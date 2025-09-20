const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const NotificationService = require('../services/notificationService');
const fcmService = require('../services/fcmService');
const { authMiddleware, requireRole, requireAdmin, requireTeacherOrAdmin } = require('../middleware/authMiddleware');
const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Validation middleware to check for validation errors
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array()
      }
    });
  }
  next();
};

router.post('/fcm-token', authMiddleware, async (req, res) => {
  try {
    const { token, deviceType = 'web' } = req.body;
    const userId = req.user.uid;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'FCM token is required' }
      });
    }

    const result = await NotificationService.storeFCMToken(userId, token, deviceType);
    
    res.json({
      success: true,
      data: result,
      message: 'FCM token stored successfully'
    });
  } catch (error) {
    console.error('Error storing FCM token:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to store FCM token' }
    });
  }
});

// Remove FCM token for user
router.delete('/fcm-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.uid;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'FCM token is required'
        }
      });
    }

    await NotificationService.removeFCMToken(userId, token);

    res.json({
      success: true,
      message: 'FCM token removed successfully'
    });
  } catch (error) {
    console.error('Error removing FCM token:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to remove FCM token'
      }
    });
  }
});

// Subscribe to topics
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { topics } = req.body;
    const userId = req.user.uid;

    if (!topics || !Array.isArray(topics)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOPICS',
          message: 'Topics must be an array'
        }
      });
    }

    await NotificationService.subscribeToTopics(userId, topics);

    res.json({
      success: true,
      message: 'Subscribed to topics successfully'
    });
  } catch (error) {
    console.error('Error subscribing to topics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to subscribe to topics'
      }
    });
  }
});

// Unsubscribe from topics
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const { topics } = req.body;
    const userId = req.user.uid;

    if (!topics || !Array.isArray(topics)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOPICS',
          message: 'Topics must be an array'
        }
      });
    }

    await NotificationService.unsubscribeFromTopics(userId, topics);

    res.json({
      success: true,
      message: 'Unsubscribed from topics successfully'
    });
  } catch (error) {
    console.error('Error unsubscribing from topics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to unsubscribe from topics'
      }
    });
  }
});

// Get user notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const notifications = await NotificationService.getUserNotifications(
      userId,
      parseInt(page),
      parseInt(limit),
      unreadOnly === 'true'
    );

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch notifications'
      }
    });
  }
});

// Get unread notification count
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    const count = await NotificationService.getUnreadCount(userId);

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch unread count'
      }
    });
  }
});

// Mark notification as read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    await NotificationService.markAsRead(id, userId);

    res.json({
      success: true,
      message: 'Notification marked as read',
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    
    if (error.message === 'Notification not found') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Notification not found'
        },
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });
    }
    
    if (error.message === 'Unauthorized access to notification') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only mark your own notifications as read'
        },
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to mark notification as read'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;

    const result = await NotificationService.markAllAsRead(userId);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: {
        updatedCount: result.updatedCount || 0
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to mark all notifications as read'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

// Send topic notification (admin only)
router.post('/topic', authMiddleware, async (req, res) => {
  try {
    const { topic, title, body, data } = req.body;
    
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only admins can send topic notifications'
        }
      });
    }

    if (!topic || !title || !body) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Topic, title, and body are required'
        }
      });
    }

    await NotificationService.sendTopicNotification(topic, title, body, data);

    res.json({
      success: true,
      message: 'Topic notification sent successfully'
    });
  } catch (error) {
    console.error('Error sending topic notification:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to send topic notification'
      }
    });
  }
});

/**
 * Send notification to a specific user using FCM
 * POST /api/notifications/send-to-user
 * Admin and Teacher only
 */
router.post('/send-to-user',
  authMiddleware,
  requireTeacherOrAdmin,
  [
    body('userId')
      .notEmpty()
      .withMessage('User ID is required')
      .isString()
      .withMessage('User ID must be a string'),
    body('notification')
      .isObject()
      .withMessage('Notification object is required'),
    body('notification.title')
      .notEmpty()
      .withMessage('Notification title is required')
      .isString()
      .withMessage('Notification title must be a string'),
    body('notification.body')
      .notEmpty()
      .withMessage('Notification body is required')
      .isString()
      .withMessage('Notification body must be a string'),
    body('notification.icon')
      .optional()
      .isString()
      .withMessage('Notification icon must be a string'),
    body('notification.imageUrl')
      .optional()
      .isURL()
      .withMessage('Image URL must be a valid URL'),
    body('data')
      .optional()
      .isObject()
      .withMessage('Data must be an object'),
    body('options')
      .optional()
      .isObject()
      .withMessage('Options must be an object')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userId, notification, data = {}, options = {} } = req.body;

      // Add sender information to data
      const enrichedData = {
        ...data,
        sentBy: req.user.uid,
        sentByRole: req.user.role,
        sentAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const result = await fcmService.sendToUser(userId, notification, enrichedData, options);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Notification sent successfully',
          data: {
            successCount: result.successCount,
            failureCount: result.failureCount,
            results: result.results
          },
          timestamp: admin.firestore.Timestamp.fromDate(new Date())
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'SEND_FAILED',
            message: result.error || 'Failed to send notification',
            details: result.results
          }
        });
      }
    } catch (error) {
      logger.error('Error sending notification to user:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

/**
 * Send notification to multiple users using FCM
 * POST /api/notifications/send-to-users
 * Admin and Teacher only
 */
router.post('/send-to-users',
  authMiddleware,
  requireTeacherOrAdmin,
  [
    body('userIds')
      .isArray({ min: 1 })
      .withMessage('User IDs array is required and must not be empty'),
    body('userIds.*')
      .isString()
      .withMessage('Each user ID must be a string'),
    body('notification')
      .isObject()
      .withMessage('Notification object is required'),
    body('notification.title')
      .notEmpty()
      .withMessage('Notification title is required')
      .isString()
      .withMessage('Notification title must be a string'),
    body('notification.body')
      .notEmpty()
      .withMessage('Notification body is required')
      .isString()
      .withMessage('Notification body must be a string'),
    body('data')
      .optional()
      .isObject()
      .withMessage('Data must be an object'),
    body('options')
      .optional()
      .isObject()
      .withMessage('Options must be an object')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userIds, notification, data = {}, options = {} } = req.body;

      // Limit the number of users to prevent abuse
      if (userIds.length > 1000) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOO_MANY_USERS',
            message: 'Cannot send to more than 1000 users at once'
          }
        });
      }

      // Add sender information to data
      const enrichedData = {
        ...data,
        sentBy: req.user.uid,
        sentByRole: req.user.role,
        sentAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const result = await fcmService.sendToUsers(userIds, notification, enrichedData, options);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Notifications sent successfully',
          data: {
            successCount: result.successCount,
            failureCount: result.failureCount,
            totalUsers: userIds.length,
            results: result.results
          },
          timestamp: admin.firestore.Timestamp.fromDate(new Date())
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'SEND_FAILED',
            message: result.error || 'Failed to send notifications',
            details: result.results
          }
        });
      }
    } catch (error) {
      logger.error('Error sending notifications to users:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

/**
 * Send notification to a topic using FCM
 * POST /api/notifications/send-to-topic
 * Admin only
 */
router.post('/send-to-topic',
  authMiddleware,
  requireAdmin,
  [
    body('topic')
      .notEmpty()
      .withMessage('Topic is required')
      .isString()
      .withMessage('Topic must be a string')
      .matches(/^[a-zA-Z0-9-_.~%]+$/)
      .withMessage('Topic contains invalid characters'),
    body('notification')
      .isObject()
      .withMessage('Notification object is required'),
    body('notification.title')
      .notEmpty()
      .withMessage('Notification title is required')
      .isString()
      .withMessage('Notification title must be a string'),
    body('notification.body')
      .notEmpty()
      .withMessage('Notification body is required')
      .isString()
      .withMessage('Notification body must be a string'),
    body('data')
      .optional()
      .isObject()
      .withMessage('Data must be an object'),
    body('options')
      .optional()
      .isObject()
      .withMessage('Options must be an object')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topic, notification, data = {}, options = {} } = req.body;

      // Add sender information to data
      const enrichedData = {
        ...data,
        sentBy: req.user.uid,
        sentByRole: req.user.role,
        sentAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const result = await fcmService.sendToTopic(topic, notification, enrichedData, options);

      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Topic notification sent successfully',
          data: {
            messageId: result.messageId,
            topic: topic
          },
          timestamp: admin.firestore.Timestamp.fromDate(new Date())
        });
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'SEND_FAILED',
            message: result.error || 'Failed to send topic notification'
          }
        });
      }
    } catch (error) {
      logger.error('Error sending topic notification:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

/**
 * Get notification statistics
 * GET /api/notifications/stats
 * Admin only
 */
router.get('/stats',
  authMiddleware,
  requireAdmin,
  [
    query('userId')
      .optional()
      .isString()
      .withMessage('User ID must be a string'),
    query('days')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Days must be between 1 and 365')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { userId, days = 30 } = req.query;
      const stats = await fcmService.getNotificationStats(userId, parseInt(days));

      if (stats) {
        res.status(200).json({
          success: true,
          data: stats,
          message: 'Notification statistics retrieved successfully',
          timestamp: admin.firestore.Timestamp.fromDate(new Date())
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: 'STATS_ERROR',
            message: 'Failed to retrieve notification statistics'
          }
        });
      }
    } catch (error) {
      logger.error('Error getting notification stats:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

module.exports = router;