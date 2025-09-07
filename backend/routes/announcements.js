const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth, requireRole, requireTeacherOrAdmin } = require('../middleware/authMiddleware');
const announcementService = require('../services/announcementService');
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
 * Get announcements for a specific batch
 * Similar to pw-extractor's announcement fetching
 */
router.get('/batch/:batchId',
  requireAuth,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      
      const result = await announcementService.fetchBatchAnnouncements(batchId, page, limit);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching batch announcements:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get all announcements for user's enrolled batches
 */
router.get('/user',
  requireAuth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      
      const result = await announcementService.fetchUserAnnouncements(userId, page, limit);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching user announcements:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Track and get new announcements for user
 * Similar to pw-extractor's announcement tracking
 */
router.get('/user/new',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await announcementService.trackAndNotifyNewAnnouncements(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error tracking new announcements:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get unread announcements count
 */
router.get('/user/unread-count',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await announcementService.getUnreadAnnouncementsCount(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting unread announcements count:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Mark announcement as read
 */
router.post('/:announcementId/read',
  requireAuth,
  [
    param('announcementId').notEmpty().withMessage('Announcement ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { announcementId } = req.params;
      
      const result = await announcementService.markAnnouncementAsRead(userId, announcementId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error marking announcement as read:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Create new announcement (Admin/Teacher only)
 */
router.post('/',
  requireAuth,
  requireTeacherOrAdmin,
  [
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('message').notEmpty().withMessage('Announcement message is required')
      .isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters'),
    body('batchName').optional().isString().withMessage('Batch name must be a string'),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority level'),
    body('type').optional().isIn(['general', 'academic', 'exam', 'event', 'technical']).withMessage('Invalid announcement type'),
    body('scheduleTime').optional().isISO8601().withMessage('Schedule time must be a valid ISO date'),
    body('attachment').optional().isObject().withMessage('Attachment must be an object'),
    body('attachment.name').optional().isString().withMessage('Attachment name must be a string'),
    body('attachment.url').optional().isURL().withMessage('Attachment URL must be valid'),
    body('attachment.size').optional().isNumeric().withMessage('Attachment size must be a number'),
    body('attachment.type').optional().isString().withMessage('Attachment type must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const creatorId = req.user.uid;
      const announcementData = {
        batchId: req.body.batchId,
        message: req.body.message,
        batchName: req.body.batchName,
        priority: req.body.priority || 'normal',
        type: req.body.type || 'general',
        scheduleTime: req.body.scheduleTime ? new Date(req.body.scheduleTime) : new Date(),
        attachment: req.body.attachment || null
      };
      
      const result = await announcementService.createAnnouncement(creatorId, announcementData);
      
      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error creating announcement:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Update announcement (Admin/Teacher only)
 */
router.put('/:announcementId',
  requireAuth,
  requireTeacherOrAdmin,
  [
    param('announcementId').notEmpty().withMessage('Announcement ID is required'),
    body('message').optional().notEmpty().withMessage('Announcement message cannot be empty')
      .isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters'),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']).withMessage('Invalid priority level'),
    body('type').optional().isIn(['general', 'academic', 'exam', 'event', 'technical']).withMessage('Invalid announcement type'),
    body('scheduleTime').optional().isISO8601().withMessage('Schedule time must be a valid ISO date'),
    body('attachment').optional().isObject().withMessage('Attachment must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { announcementId } = req.params;
      const updateData = {
        ...req.body,
        updatedAt: new Date()
      };
      
      if (req.body.scheduleTime) {
        updateData.scheduleTime = new Date(req.body.scheduleTime);
      }
      
      // Update announcement in Firestore
      const { firestore } = require('../config/firebase');
      await firestore.collection('announcements').doc(announcementId).update(updateData);
      
      res.json({
        success: true,
        message: 'Announcement updated successfully',
        announcementId: announcementId
      });
    } catch (error) {
      console.error('Error updating announcement:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Delete announcement (Admin only)
 */
router.delete('/:announcementId',
  requireAuth,
  requireRole('admin'),
  [
    param('announcementId').notEmpty().withMessage('Announcement ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { announcementId } = req.params;
      
      // Delete announcement from Firestore
      const { firestore } = require('../config/firebase');
      await firestore.collection('announcements').doc(announcementId).delete();
      
      res.json({
        success: true,
        message: 'Announcement deleted successfully',
        announcementId: announcementId
      });
    } catch (error) {
      console.error('Error deleting announcement:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get announcement statistics (Admin/Teacher only)
 */
router.get('/stats/batch/:batchId',
  requireAuth,
  requireTeacherOrAdmin,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required'),
    query('days').optional().isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const days = parseInt(req.query.days) || 30;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const { firestore } = require('../config/firebase');
      
      // Get announcements count
      const announcementsSnapshot = await firestore.collection('announcements')
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate)
        .get();
      
      // Get read statistics
      const readSnapshot = await firestore.collection('user_announcement_reads')
        .where('readAt', '>=', startDate)
        .get();
      
      const announcementIds = announcementsSnapshot.docs.map(doc => doc.id);
      const readCounts = {};
      
      readSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (announcementIds.includes(data.announcementId)) {
          readCounts[data.announcementId] = (readCounts[data.announcementId] || 0) + 1;
        }
      });
      
      // Get enrolled students count
      const enrollmentsSnapshot = await firestore.collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();
      
      const totalStudents = enrollmentsSnapshot.size;
      const totalAnnouncements = announcementsSnapshot.size;
      const totalReads = Object.values(readCounts).reduce((sum, count) => sum + count, 0);
      const averageReadRate = totalAnnouncements > 0 && totalStudents > 0 ? 
        Math.round((totalReads / (totalAnnouncements * totalStudents)) * 100) : 0;
      
      res.json({
        success: true,
        stats: {
          totalAnnouncements,
          totalStudents,
          totalReads,
          averageReadRate,
          period: `${days} days`,
          readCounts
        }
      });
    } catch (error) {
      console.error('Error getting announcement statistics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Bulk mark announcements as read
 */
router.post('/bulk/mark-read',
  requireAuth,
  [
    body('announcementIds').isArray({ min: 1 }).withMessage('Announcement IDs must be a non-empty array'),
    body('announcementIds.*').notEmpty().withMessage('Each announcement ID must be non-empty')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { announcementIds } = req.body;
      
      const results = await Promise.all(
        announcementIds.map(announcementId => 
          announcementService.markAnnouncementAsRead(userId, announcementId)
        )
      );
      
      const successCount = results.filter(result => result.success).length;
      const failureCount = results.length - successCount;
      
      res.json({
        success: true,
        message: `Marked ${successCount} announcements as read`,
        successCount,
        failureCount,
        totalProcessed: results.length
      });
    } catch (error) {
      console.error('Error bulk marking announcements as read:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

module.exports = router;