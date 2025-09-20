const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth, requireRole, requireTeacherOrAdmin } = require('../middleware/authMiddleware');
const dashboardService = require('../services/dashboardService');
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
 * Get comprehensive dashboard data for user
 * Similar to pw-extractor's dashboard functionality
 */
router.get('/user',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await dashboardService.getDashboardData(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get user profile information
 */
router.get('/profile',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await dashboardService.getUserProfile(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get enrolled batches with progress
 */
router.get('/batches',
  requireAuth,
  [
    query('includeProgress').optional().isBoolean().withMessage('Include progress must be boolean'),
    query('status').optional().isIn(['active', 'completed', 'paused', 'all']).withMessage('Invalid status filter')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const includeProgress = req.query.includeProgress === 'true';
      const status = req.query.status || 'active';
      
      const result = await dashboardService.getEnrolledBatchesWithProgress(userId, includeProgress, status);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching enrolled batches:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get recent activity for user
 */
router.get('/activity',
  requireAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('days').optional().isInt({ min: 1, max: 90 }).withMessage('Days must be between 1 and 90'),
    query('type').optional().isIn(['video', 'notes', 'quiz', 'assignment', 'all']).withMessage('Invalid activity type')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const limit = parseInt(req.query.limit) || 20;
      const days = parseInt(req.query.days) || 7;
      const type = req.query.type || 'all';
      
      const result = await dashboardService.getRecentActivity(userId, limit, days, type);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching recent activity:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get recent announcements for user
 */
router.get('/announcements',
  requireAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('unreadOnly').optional().isBoolean().withMessage('Unread only must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const limit = parseInt(req.query.limit) || 10;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const result = await dashboardService.getRecentAnnouncements(userId, limit, unreadOnly);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching recent announcements:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get progress statistics
 */
router.get('/progress',
  requireAuth,
  [
    query('period').optional().isIn(['weekly', 'monthly', 'yearly']).withMessage('Invalid period'),
    query('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const period = req.query.period || 'weekly';
      const batchId = req.query.batchId || null;
      
      const result = await dashboardService.getProgressStatistics(userId, period, batchId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching progress statistics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get learning streak information
 */
router.get('/streak',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const { firestore } = require('../config/firebase');
      
      // Get user activities for streak calculation
      const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(new Date());
      thirtyDaysAgo.toDate().setDate(thirtyDaysAgo.toDate().getDate() - 30);
      
      const activitiesSnapshot = await firestore.collection('user_activities')
        .where('userId', '==', userId)
        .where('timestamp', '>=', thirtyDaysAgo.toDate())
        .orderBy('timestamp', 'desc')
        .get();
      
      // Calculate streak
      const activities = activitiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate()
      }));
      
      // Group activities by date
      const activityDates = new Set();
      activities.forEach(activity => {
        const dateStr = activity.timestamp.toDate().toISOString().split('T')[0];
        activityDates.add(dateStr);
      });
      
      // Calculate current streak
      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;
      
      const today = new Date();
      let checkDate = new Date(today);
      
      // Check current streak (consecutive days from today backwards)
      while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (activityDates.has(dateStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
      
      // Calculate longest streak
      const sortedDates = Array.from(activityDates).sort();
      for (let i = 0; i < sortedDates.length; i++) {
        if (i === 0) {
          tempStreak = 1;
        } else {
          const prevDate = new Date(sortedDates[i - 1]);
          const currDate = new Date(sortedDates[i]);
          const dayDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
          
          if (dayDiff === 1) {
            tempStreak++;
          } else {
            longestStreak = Math.max(longestStreak, tempStreak);
            tempStreak = 1;
          }
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak);
      
      res.json({
        success: true,
        streak: {
          current: currentStreak,
          longest: longestStreak,
          activeDays: activityDates.size,
          totalActivities: activities.length,
          lastActivity: activities.length > 0 ? activities[0].timestamp : null
        }
      });
    } catch (error) {
      console.error('Error fetching learning streak:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Log user activity
 */
router.post('/activity',
  requireAuth,
  [
    body('type').isIn(['video_watch', 'notes_access', 'quiz_attempt', 'assignment_submit', 'login', 'course_access'])
      .withMessage('Invalid activity type'),
    body('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty'),
    body('subjectId').optional().notEmpty().withMessage('Subject ID cannot be empty'),
    body('topicId').optional().notEmpty().withMessage('Topic ID cannot be empty'),
    body('contentId').optional().notEmpty().withMessage('Content ID cannot be empty'),
    body('duration').optional().isNumeric().withMessage('Duration must be a number'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const activityData = {
        type: req.body.type,
        batchId: req.body.batchId || null,
        subjectId: req.body.subjectId || null,
        topicId: req.body.topicId || null,
        contentId: req.body.contentId || null,
        duration: req.body.duration || 0,
        metadata: req.body.metadata || {}
      };
      
      const result = await dashboardService.logUserActivity(userId, activityData);
      
      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error logging user activity:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get dashboard summary with key metrics
 */
router.get('/summary',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await dashboardService.getDashboardSummary(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching dashboard summary:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get performance analytics (Teacher/Admin only)
 */
router.get('/analytics/performance',
  requireAuth,
  requireTeacherOrAdmin,
  [
    query('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty'),
    query('period').optional().isIn(['week', 'month', 'quarter', 'year']).withMessage('Invalid period'),
    query('metric').optional().isIn(['engagement', 'completion', 'performance', 'all']).withMessage('Invalid metric')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const batchId = req.query.batchId;
      const period = req.query.period || 'month';
      const metric = req.query.metric || 'all';
      
      const { firestore } = require('../config/firebase');
      
      // Calculate date range based on period
      const endDate = admin.firestore.Timestamp.fromDate(new Date());
      const startDate = admin.firestore.Timestamp.fromDate(new Date());
      
      switch (period) {
        case 'week':
          startDate.toDate().setDate(startDate.toDate().getDate() - 7);
          break;
        case 'month':
          startDate.toDate().setMonth(startDate.toDate().getMonth() - 1);
          break;
        case 'quarter':
          startDate.toDate().setMonth(startDate.toDate().getMonth() - 3);
          break;
        case 'year':
          startDate.toDate().setFullYear(startDate.toDate().getFullYear() - 1);
          break;
      }
      
      let query = firestore.collection('user_activities')
        .where('timestamp', '>=', startDate.toDate())
        .where('timestamp', '<=', endDate.toDate());
      
      if (batchId) {
        query = query.where('batchId', '==', batchId);
      }
      
      const activitiesSnapshot = await query.get();
      const activities = activitiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate()
      }));
      
      // Calculate metrics
      const analytics = {
        totalActivities: activities.length,
        uniqueUsers: new Set(activities.map(a => a.userId)).size,
        activityTypes: {},
        dailyActivity: {},
        averageSessionDuration: 0
      };
      
      // Group by activity type
      activities.forEach(activity => {
        analytics.activityTypes[activity.type] = (analytics.activityTypes[activity.type] || 0) + 1;
        
        // Group by date
        const dateStr = activity.timestamp.toDate().toISOString().split('T')[0];
        analytics.dailyActivity[dateStr] = (analytics.dailyActivity[dateStr] || 0) + 1;
      });
      
      // Calculate average session duration
      const sessionsWithDuration = activities.filter(a => a.duration && a.duration > 0);
      if (sessionsWithDuration.length > 0) {
        analytics.averageSessionDuration = Math.round(
          sessionsWithDuration.reduce((sum, a) => sum + a.duration, 0) / sessionsWithDuration.length
        );
      }
      
      res.json({
        success: true,
        analytics,
        period,
        dateRange: {
          start: admin.firestore.Timestamp.fromDate(startDate),
          end: admin.firestore.Timestamp.fromDate(endDate)
        }
      });
    } catch (error) {
      console.error('Error fetching performance analytics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get batch-wise student progress (Teacher/Admin only)
 */
router.get('/analytics/batch/:batchId/progress',
  requireAuth,
  requireTeacherOrAdmin,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      
      const { firestore } = require('../config/firebase');
      
      // Get enrolled students
      const enrollmentsSnapshot = await firestore.collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();
      
      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().userId);
      
      if (studentIds.length === 0) {
        return res.json({
          success: true,
          progress: [],
          summary: {
            totalStudents: 0,
            averageProgress: 0,
            activeStudents: 0
          }
        });
      }
      
      // Get progress for each student
      const progressPromises = studentIds.map(async (studentId) => {
        // Get user profile
        const userDoc = await firestore.collection('users').doc(studentId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        
        // Get recent activities
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const activitiesSnapshot = await firestore.collection('user_activities')
          .where('userId', '==', studentId)
          .where('batchId', '==', batchId)
          .where('timestamp', '>=', sevenDaysAgo)
          .get();
        
        const activities = activitiesSnapshot.docs.map(doc => doc.data());
        
        // Calculate progress metrics
        const videoWatched = activities.filter(a => a.type === 'video_watch').length;
        const notesAccessed = activities.filter(a => a.type === 'notes_access').length;
        const quizAttempts = activities.filter(a => a.type === 'quiz_attempt').length;
        const totalActivities = activities.length;
        
        return {
          userId: studentId,
          name: userData.name || 'Unknown',
          email: userData.email || '',
          progress: {
            videoWatched,
            notesAccessed,
            quizAttempts,
            totalActivities,
            lastActive: activities.length > 0 ? 
              Math.max(...activities.map(a => a.timestamp.toDate().getTime())) : null
          }
        };
      });
      
      const progressData = await Promise.all(progressPromises);
      
      // Calculate summary
      const totalStudents = progressData.length;
      const activeStudents = progressData.filter(p => p.progress.totalActivities > 0).length;
      const averageProgress = totalStudents > 0 ? 
        Math.round(progressData.reduce((sum, p) => sum + p.progress.totalActivities, 0) / totalStudents) : 0;
      
      res.json({
        success: true,
        progress: progressData,
        summary: {
          totalStudents,
          averageProgress,
          activeStudents,
          engagementRate: totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0
        }
      });
    } catch (error) {
      console.error('Error fetching batch progress:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

module.exports = router;