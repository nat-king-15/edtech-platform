const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth, requireRole, requireTeacherOrAdmin } = require('../middleware/authMiddleware');
const trackingService = require('../services/trackingService');
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
 * Track video progress
 * Similar to pw-extractor's video tracking
 */
router.post('/video',
  requireAuth,
  [
    body('videoId').notEmpty().withMessage('Video ID is required'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('topicId').notEmpty().withMessage('Topic ID is required'),
    body('currentTime').isNumeric().withMessage('Current time must be a number'),
    body('duration').isNumeric().withMessage('Duration must be a number'),
    body('watchedPercentage').optional().isNumeric().withMessage('Watched percentage must be a number'),
    body('isCompleted').optional().isBoolean().withMessage('Is completed must be boolean'),
    body('quality').optional().isIn(['240p', '360p', '480p', '720p', '1080p']).withMessage('Invalid video quality'),
    body('playbackSpeed').optional().isNumeric().withMessage('Playback speed must be a number')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const progressData = {
        videoId: req.body.videoId,
        batchId: req.body.batchId,
        subjectId: req.body.subjectId,
        topicId: req.body.topicId,
        currentTime: req.body.currentTime,
        duration: req.body.duration,
        watchedPercentage: req.body.watchedPercentage || Math.round((req.body.currentTime / req.body.duration) * 100),
        isCompleted: req.body.isCompleted || false,
        quality: req.body.quality || '720p',
        playbackSpeed: req.body.playbackSpeed || 1.0
      };
      
      const result = await trackingService.trackVideoProgress(userId, progressData);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error tracking video progress:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Track notes access
 * Similar to pw-extractor's notes tracking
 */
router.post('/notes',
  requireAuth,
  [
    body('notesId').notEmpty().withMessage('Notes ID is required'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('topicId').notEmpty().withMessage('Topic ID is required'),
    body('accessType').isIn(['view', 'download']).withMessage('Access type must be view or download'),
    body('timeSpent').optional().isNumeric().withMessage('Time spent must be a number'),
    body('pageCount').optional().isNumeric().withMessage('Page count must be a number'),
    body('currentPage').optional().isNumeric().withMessage('Current page must be a number')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const accessData = {
        notesId: req.body.notesId,
        batchId: req.body.batchId,
        subjectId: req.body.subjectId,
        topicId: req.body.topicId,
        accessType: req.body.accessType,
        timeSpent: req.body.timeSpent || 0,
        pageCount: req.body.pageCount || 0,
        currentPage: req.body.currentPage || 1
      };
      
      const result = await trackingService.trackNotesAccess(userId, accessData);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error tracking notes access:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Track quiz attempt
 * Similar to pw-extractor's quiz tracking
 */
router.post('/quiz',
  requireAuth,
  [
    body('quizId').notEmpty().withMessage('Quiz ID is required'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('topicId').optional().notEmpty().withMessage('Topic ID cannot be empty'),
    body('attemptId').notEmpty().withMessage('Attempt ID is required'),
    body('score').isNumeric().withMessage('Score must be a number'),
    body('totalQuestions').isNumeric().withMessage('Total questions must be a number'),
    body('correctAnswers').isNumeric().withMessage('Correct answers must be a number'),
    body('timeSpent').isNumeric().withMessage('Time spent must be a number'),
    body('isCompleted').isBoolean().withMessage('Is completed must be boolean'),
    body('answers').optional().isArray().withMessage('Answers must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const attemptData = {
        quizId: req.body.quizId,
        batchId: req.body.batchId,
        subjectId: req.body.subjectId,
        topicId: req.body.topicId || null,
        attemptId: req.body.attemptId,
        score: req.body.score,
        totalQuestions: req.body.totalQuestions,
        correctAnswers: req.body.correctAnswers,
        timeSpent: req.body.timeSpent,
        isCompleted: req.body.isCompleted,
        percentage: Math.round((req.body.correctAnswers / req.body.totalQuestions) * 100),
        answers: req.body.answers || []
      };
      
      const result = await trackingService.trackQuizAttempt(userId, attemptData);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error tracking quiz attempt:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Track assignment submission
 * Similar to pw-extractor's assignment tracking
 */
router.post('/assignment',
  requireAuth,
  [
    body('assignmentId').notEmpty().withMessage('Assignment ID is required'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('submissionId').notEmpty().withMessage('Submission ID is required'),
    body('status').isIn(['submitted', 'draft', 'late']).withMessage('Invalid status'),
    body('submissionTime').isISO8601().withMessage('Submission time must be a valid date'),
    body('attachments').optional().isArray().withMessage('Attachments must be an array'),
    body('score').optional().isNumeric().withMessage('Score must be a number'),
    body('feedback').optional().isString().withMessage('Feedback must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const submissionData = {
        assignmentId: req.body.assignmentId,
        batchId: req.body.batchId,
        subjectId: req.body.subjectId,
        submissionId: req.body.submissionId,
        status: req.body.status,
        submissionTime: new Date(req.body.submissionTime),
        attachments: req.body.attachments || [],
        score: req.body.score || null,
        feedback: req.body.feedback || null
      };
      
      const result = await trackingService.trackAssignmentSubmission(userId, submissionData);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error tracking assignment submission:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get user progress statistics
 */
router.get('/progress/:userId',
  requireAuth,
  [
    param('userId').notEmpty().withMessage('User ID is required'),
    query('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty'),
    query('subjectId').optional().notEmpty().withMessage('Subject ID cannot be empty'),
    query('period').optional().isIn(['week', 'month', 'quarter', 'year', 'all']).withMessage('Invalid period')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { batchId, subjectId, period = 'month' } = req.query;
      
      // Check if user can access this data
      if (req.user.uid !== userId && !['admin', 'teacher'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error_message: 'Access denied'
        });
      }
      
      const result = await trackingService.getUserProgressStats(userId, {
        batchId,
        subjectId,
        period
      });
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting user progress:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get video progress for specific video
 */
router.get('/video/:videoId/progress',
  requireAuth,
  [
    param('videoId').notEmpty().withMessage('Video ID is required'),
    query('userId').optional().notEmpty().withMessage('User ID cannot be empty')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { videoId } = req.params;
      const userId = req.query.userId || req.user.uid;
      
      // Check if user can access this data
      if (req.user.uid !== userId && !['admin', 'teacher'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error_message: 'Access denied'
        });
      }
      
      const { firestore } = require('../config/firebase');
      
      const progressSnapshot = await firestore.collection('video_progress')
        .where('userId', '==', userId)
        .where('videoId', '==', videoId)
        .orderBy('lastWatched', 'desc')
        .limit(1)
        .get();
      
      if (progressSnapshot.empty) {
        return res.json({
          success: true,
          progress: null,
          message: 'No progress found for this video'
        });
      }
      
      const progressDoc = progressSnapshot.docs[0];
      const progressData = {
        id: progressDoc.id,
        ...progressDoc.data(),
        lastWatched: progressDoc.data().lastWatched.toDate()
      };
      
      res.json({
        success: true,
        progress: progressData
      });
    } catch (error) {
      console.error('Error getting video progress:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get quiz attempts for specific quiz
 */
router.get('/quiz/:quizId/attempts',
  requireAuth,
  [
    param('quizId').notEmpty().withMessage('Quiz ID is required'),
    query('userId').optional().notEmpty().withMessage('User ID cannot be empty'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { quizId } = req.params;
      const userId = req.query.userId || req.user.uid;
      const limit = parseInt(req.query.limit) || 10;
      
      // Check if user can access this data
      if (req.user.uid !== userId && !['admin', 'teacher'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error_message: 'Access denied'
        });
      }
      
      const { firestore } = require('../config/firebase');
      
      const attemptsSnapshot = await firestore.collection('quiz_attempts')
        .where('userId', '==', userId)
        .where('quizId', '==', quizId)
        .orderBy('attemptedAt', 'desc')
        .limit(limit)
        .get();
      
      const attempts = attemptsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        attemptedAt: doc.data().attemptedAt.toDate()
      }));
      
      // Calculate statistics
      const stats = {
        totalAttempts: attempts.length,
        bestScore: attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : 0,
        averageScore: attempts.length > 0 ? 
          Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length) : 0,
        lastAttempt: attempts.length > 0 ? attempts[0].attemptedAt : null,
        completedAttempts: attempts.filter(a => a.isCompleted).length
      };
      
      res.json({
        success: true,
        attempts,
        stats
      });
    } catch (error) {
      console.error('Error getting quiz attempts:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Export tracking data (Admin/Teacher only)
 */
router.get('/export',
  requireAuth,
  requireTeacherOrAdmin,
  [
    query('userId').optional().notEmpty().withMessage('User ID cannot be empty'),
    query('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty'),
    query('type').optional().isIn(['video', 'notes', 'quiz', 'assignment', 'all']).withMessage('Invalid export type'),
    query('format').optional().isIn(['json', 'csv']).withMessage('Invalid format'),
    query('startDate').optional().isISO8601().withMessage('Start date must be valid'),
    query('endDate').optional().isISO8601().withMessage('End date must be valid')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        userId,
        batchId,
        type = 'all',
        format = 'json',
        startDate,
        endDate
      } = req.query;
      
      const filters = {
        userId,
        batchId,
        type,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null
      };
      
      const result = await trackingService.exportTrackingData(filters, format);
      
      if (result.success) {
        if (format === 'csv') {
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="tracking_data_${Date.now()}.csv"`);
          res.send(result.data);
        } else {
          res.json({
            success: true,
            data: result.data,
            exportInfo: result.exportInfo
          });
        }
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error exporting tracking data:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Clean up old tracking data (Admin only)
 */
router.post('/cleanup',
  requireAuth,
  requireRole('admin'),
  [
    body('olderThanDays').isInt({ min: 30 }).withMessage('Must be at least 30 days'),
    body('dataTypes').optional().isArray().withMessage('Data types must be an array'),
    body('dryRun').optional().isBoolean().withMessage('Dry run must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        olderThanDays,
        dataTypes = ['video', 'notes', 'quiz', 'assignment'],
        dryRun = true
      } = req.body;
      
      const result = await trackingService.cleanupTrackingData(olderThanDays, dataTypes, dryRun);
      
      if (result.success) {
        res.json({
          success: true,
          message: dryRun ? 'Cleanup simulation completed' : 'Cleanup completed successfully',
          cleanupInfo: result.cleanupInfo
        });
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error cleaning up tracking data:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get batch-wise tracking analytics (Teacher/Admin only)
 */
router.get('/analytics/batch/:batchId',
  requireAuth,
  requireTeacherOrAdmin,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required'),
    query('period').optional().isIn(['week', 'month', 'quarter']).withMessage('Invalid period'),
    query('metric').optional().isIn(['engagement', 'completion', 'performance']).withMessage('Invalid metric')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const period = req.query.period || 'month';
      const metric = req.query.metric || 'engagement';
      
      const { firestore } = require('../config/firebase');
      
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      
      switch (period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3);
          break;
      }
      
      // Get enrolled students
      const enrollmentsSnapshot = await firestore.collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();
      
      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().userId);
      
      if (studentIds.length === 0) {
        return res.json({
          success: true,
          analytics: {
            totalStudents: 0,
            activeStudents: 0,
            engagementRate: 0,
            completionRate: 0,
            averageScore: 0
          }
        });
      }
      
      // Get tracking data for the period
      const collections = ['video_progress', 'notes_access', 'quiz_attempts', 'assignment_submissions'];
      const trackingData = {};
      
      for (const collection of collections) {
        const snapshot = await firestore.collection(collection)
          .where('batchId', '==', batchId)
          .where('timestamp', '>=', startDate)
          .where('timestamp', '<=', endDate)
          .get();
        
        trackingData[collection] = snapshot.docs.map(doc => doc.data());
      }
      
      // Calculate analytics
      const activeStudents = new Set();
      let totalActivities = 0;
      let completedActivities = 0;
      let totalScore = 0;
      let scoredActivities = 0;
      
      Object.values(trackingData).forEach(activities => {
        activities.forEach(activity => {
          activeStudents.add(activity.userId);
          totalActivities++;
          
          if (activity.isCompleted) {
            completedActivities++;
          }
          
          if (activity.score !== undefined && activity.score !== null) {
            totalScore += activity.score;
            scoredActivities++;
          }
        });
      });
      
      const analytics = {
        totalStudents: studentIds.length,
        activeStudents: activeStudents.size,
        engagementRate: Math.round((activeStudents.size / studentIds.length) * 100),
        completionRate: totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0,
        averageScore: scoredActivities > 0 ? Math.round(totalScore / scoredActivities) : 0,
        totalActivities,
        period,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      console.error('Error getting batch analytics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

module.exports = router;