const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { auditMiddleware } = require('../middleware/auditLogger');
const { body, query, validationResult } = require('express-validator');

// Validation middleware
const validateTimeRange = [
  query('timeRange')
    .optional()
    .isIn(['7d', '30d', '90d', '1y'])
    .withMessage('Invalid time range. Must be one of: 7d, 30d, 90d, 1y')
];

const validateBatchIds = [
  query('batchIds')
    .optional()
    .isArray()
    .withMessage('Batch IDs must be an array')
];

// Student Analytics Routes

/**
 * @route GET /api/analytics/student
 * @desc Get comprehensive analytics for a student
 * @access Private (Student, Teacher, Admin)
 */
router.get('/student', 
  authMiddleware,
  requireRole(['student', 'teacher', 'admin']),
  validateTimeRange,
  [
    query('studentId')
      .optional()
      .isString()
      .withMessage('Student ID must be a string'),
    query('batchId')
      .notEmpty()
      .withMessage('Batch ID is required')
  ],
  auditMiddleware('analytics_student_view'),
  async (req, res) => {
    try {
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

      const { timeRange = '30d', batchId } = req.query;
      let { studentId } = req.query;
      
      // If no studentId provided, use current user's ID (for students viewing their own data)
      if (!studentId) {
        if (req.user.role === 'student') {
          studentId = req.user.uid;
        } else {
          return res.status(400).json({
            success: false,
            error: {
              code: 'MISSING_STUDENT_ID',
              message: 'Student ID is required for non-student users'
            }
          });
        }
      }
      
      // Authorization check: students can only view their own data
      if (req.user.role === 'student' && studentId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED_ACCESS',
            message: 'Students can only view their own analytics'
          }
        });
      }

      const analytics = await analyticsService.getStudentAnalytics(studentId, batchId, timeRange);

      res.json({
        success: true,
        data: { analytics },
        message: 'Student analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting student analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve student analytics'
        }
      });
    }
  }
);

/**
 * @route GET /api/analytics/student/progress
 * @desc Get detailed progress analytics for a student
 * @access Private (Student, Teacher, Admin)
 */
router.get('/student/progress',
  authMiddleware,
  requireRole(['student', 'teacher', 'admin']),
  validateTimeRange,
  [
    query('studentId').optional().isString(),
    query('batchId').notEmpty().withMessage('Batch ID is required'),
    query('subjectId').optional().isString()
  ],
  auditMiddleware('analytics_student_progress_view'),
  async (req, res) => {
    try {
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

      const { timeRange = '30d', batchId, subjectId } = req.query;
      let { studentId } = req.query;
      
      if (!studentId && req.user.role === 'student') {
        studentId = req.user.uid;
      }
      
      if (req.user.role === 'student' && studentId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED_ACCESS',
            message: 'Students can only view their own progress'
          }
        });
      }

      const progressData = await analyticsService.getStudentProgress(studentId, batchId, analyticsService.getStartDate(timeRange));

      res.json({
        success: true,
        data: { progress: progressData },
        message: 'Student progress analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting student progress analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve student progress analytics'
        }
      });
    }
  }
);

// Teacher Analytics Routes

/**
 * @route GET /api/analytics/teacher
 * @desc Get comprehensive analytics for a teacher
 * @access Private (Teacher, Admin)
 */
router.get('/teacher',
  authMiddleware,
  requireRole(['teacher', 'admin']),
  validateTimeRange,
  validateBatchIds,
  auditMiddleware('analytics_teacher_view'),
  async (req, res) => {
    try {
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

      const { timeRange = '30d' } = req.query;
      let { batchIds } = req.query;
      let teacherId = req.user.uid;
      
      // If admin is requesting, they can specify teacherId
      if (req.user.role === 'admin' && req.query.teacherId) {
        teacherId = req.query.teacherId;
      }
      
      // If no batchIds provided, get all batches for the teacher
      if (!batchIds || batchIds.length === 0) {
        // This would typically come from a teacher-batch relationship
        // For now, we'll use an empty array and let the service handle it
        batchIds = [];
      }

      const analytics = await analyticsService.getTeacherAnalytics(teacherId, batchIds, timeRange);

      res.json({
        success: true,
        data: { analytics },
        message: 'Teacher analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting teacher analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve teacher analytics'
        }
      });
    }
  }
);

/**
 * @route GET /api/analytics/teacher/batch/:batchId
 * @desc Get detailed analytics for a specific batch
 * @access Private (Teacher, Admin)
 */
router.get('/teacher/batch/:batchId',
  authMiddleware,
  requireRole(['teacher', 'admin']),
  validateTimeRange,
  auditMiddleware('analytics_batch_view'),
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const { timeRange = '30d' } = req.query;
      const teacherId = req.user.uid;

      const batchAnalytics = await analyticsService.getTeacherBatchAnalytics(teacherId, [batchId], analyticsService.getStartDate(timeRange));

      if (batchAnalytics.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BATCH_NOT_FOUND',
            message: 'Batch not found or access denied'
          }
        });
      }

      res.json({
        success: true,
        data: { batch: batchAnalytics[0] },
        message: 'Batch analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting batch analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve batch analytics'
        }
      });
    }
  }
);

// Admin Analytics Routes

/**
 * @route GET /api/analytics/admin
 * @desc Get comprehensive platform analytics for admin
 * @access Private (Admin only)
 */
router.get('/admin',
  authMiddleware,
  requireRole(['admin']),
  validateTimeRange,
  auditMiddleware('analytics_admin_view'),
  async (req, res) => {
    try {
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

      const { timeRange = '30d' } = req.query;

      const analytics = await analyticsService.getAdminAnalytics(timeRange);

      res.json({
        success: true,
        data: { analytics },
        message: 'Admin analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting admin analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve admin analytics'
        }
      });
    }
  }
);

/**
 * @route GET /api/analytics/admin/users
 * @desc Get detailed user analytics for admin
 * @access Private (Admin only)
 */
router.get('/admin/users',
  authMiddleware,
  requireRole(['admin']),
  validateTimeRange,
  [
    query('userType')
      .optional()
      .isIn(['student', 'teacher', 'admin'])
      .withMessage('Invalid user type')
  ],
  auditMiddleware('analytics_admin_users_view'),
  async (req, res) => {
    try {
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

      const { timeRange = '30d', userType } = req.query;

      const userMetrics = await analyticsService.getUserMetrics(analyticsService.getStartDate(timeRange), userType);

      res.json({
        success: true,
        data: { users: userMetrics },
        message: 'User analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting user analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve user analytics'
        }
      });
    }
  }
);

// Real-time Analytics Routes

/**
 * @route GET /api/analytics/realtime
 * @desc Get real-time platform metrics
 * @access Private (Teacher, Admin)
 */
router.get('/realtime',
  authMiddleware,
  requireRole(['teacher', 'admin']),
  auditMiddleware('analytics_realtime_view'),
  async (req, res) => {
    try {
      // Get cached real-time data
      const realtimeData = await analyticsService.getAnalyticsCache('realtime');
      
      if (!realtimeData) {
        return res.json({
          success: true,
          data: {
            activeUsers: 0,
            onlineStudents: 0,
            currentSessions: 0,
            lastUpdated: admin.firestore.Timestamp.fromDate(new Date())
          },
          message: 'Real-time analytics retrieved successfully'
        });
      }

      res.json({
        success: true,
        data: realtimeData.data,
        message: 'Real-time analytics retrieved successfully'
      });
    } catch (error) {
      console.error('Error getting real-time analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'ANALYTICS_ERROR',
          message: 'Failed to retrieve real-time analytics'
        }
      });
    }
  }
);

/**
 * @route POST /api/analytics/cache/update
 * @desc Update analytics cache (internal use)
 * @access Private (Admin only)
 */
router.post('/cache/update',
  authMiddleware,
  requireRole(['admin']),
  [
    body('type')
      .notEmpty()
      .withMessage('Cache type is required'),
    body('data')
      .notEmpty()
      .withMessage('Cache data is required')
  ],
  auditMiddleware('analytics_cache_update'),
  async (req, res) => {
    try {
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

      const { type, data } = req.body;

      await analyticsService.updateAnalyticsCache(type, data);

      res.json({
        success: true,
        message: 'Analytics cache updated successfully'
      });
    } catch (error) {
      console.error('Error updating analytics cache:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'CACHE_UPDATE_ERROR',
          message: 'Failed to update analytics cache'
        }
      });
    }
  }
);

// Export Analytics Data

/**
 * @route GET /api/analytics/export
 * @desc Export analytics data in various formats
 * @access Private (Teacher, Admin)
 */
router.get('/export',
  authMiddleware,
  requireRole(['teacher', 'admin']),
  [
    query('type')
      .notEmpty()
      .isIn(['student', 'teacher', 'admin'])
      .withMessage('Export type is required and must be valid'),
    query('format')
      .optional()
      .isIn(['json', 'csv'])
      .withMessage('Format must be json or csv')
  ],
  validateTimeRange,
  auditMiddleware('analytics_export'),
  async (req, res) => {
    try {
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

      const { type, format = 'json', timeRange = '30d' } = req.query;
      let analytics;

      switch (type) {
        case 'student':
          if (req.user.role === 'student') {
            analytics = await analyticsService.getStudentAnalytics(req.user.uid, req.query.batchId, timeRange);
          } else {
            return res.status(400).json({
              success: false,
              error: {
                code: 'MISSING_PARAMETERS',
                message: 'Student ID and Batch ID required for student analytics export'
              }
            });
          }
          break;
        case 'teacher':
          analytics = await analyticsService.getTeacherAnalytics(req.user.uid, req.query.batchIds || [], timeRange);
          break;
        case 'admin':
          if (req.user.role !== 'admin') {
            return res.status(403).json({
              success: false,
              error: {
                code: 'UNAUTHORIZED_ACCESS',
                message: 'Admin access required for admin analytics export'
              }
            });
          }
          analytics = await analyticsService.getAdminAnalytics(timeRange);
          break;
      }

      if (format === 'csv') {
        // Convert to CSV format
        const csv = convertToCSV(analytics);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-${type}-${timeRange}.csv"`);
        res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-${type}-${timeRange}.json"`);
        res.json({
          success: true,
          data: analytics,
          exportedAt: admin.firestore.Timestamp.fromDate(new Date()),
          type,
          timeRange
        });
      }
    } catch (error) {
      console.error('Error exporting analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'EXPORT_ERROR',
          message: 'Failed to export analytics data'
        }
      });
    }
  }
);

// Helper function to convert JSON to CSV
function convertToCSV(data) {
  // This is a simplified CSV conversion
  // In a real implementation, you'd want a more robust CSV library
  const flattenObject = (obj, prefix = '') => {
    let flattened = {};
    for (let key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(flattened, flattenObject(obj[key], `${prefix}${key}_`));
      } else {
        flattened[`${prefix}${key}`] = obj[key];
      }
    }
    return flattened;
  };
  
  const flattened = flattenObject(data);
  const headers = Object.keys(flattened).join(',');
  const values = Object.values(flattened).map(v => 
    typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
  ).join(',');
  
  return `${headers}\n${values}`;
}

module.exports = router;