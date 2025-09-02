const express = require('express');
const router = express.Router();
const reportService = require('../services/reportService');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { validateRequest } = require('../../middleware/validation');
const { auditMiddleware } = require('../../middleware/auditLogger');
const { createUserBasedRateLimit } = require('../../middleware/rateLimiter');
const { body, param, query, validationResult } = require('express-validator');

// Apply authentication and rate limiting to all routes
router.use(authMiddleware);
router.use(createUserBasedRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: 'Too many report requests, please try again later'
}));

// Validation schemas
const timeRangeValidation = [
  query('timeRange')
    .optional()
    .isIn(['7d', '30d', '90d', '1y', 'month'])
    .withMessage('Invalid time range')
];

const formatValidation = [
  query('format')
    .optional()
    .isIn(['pdf', 'excel'])
    .withMessage('Format must be pdf or excel')
];

const studentReportValidation = [
  param('studentId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Student ID is required'),
  query('batchId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Batch ID is required'),
  ...timeRangeValidation,
  ...formatValidation
];

const batchReportValidation = [
  param('batchId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Batch ID is required'),
  ...timeRangeValidation,
  ...formatValidation
];

const assignmentReportValidation = [
  param('assignmentId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Assignment ID is required'),
  ...formatValidation
];

// Student Progress Report
router.get('/student/:studentId',
  studentReportValidation,
  validateRequest,
  auditMiddleware('GENERATE_STUDENT_REPORT'),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { batchId, timeRange = '30d', format = 'pdf' } = req.query;
      const { user } = req;

      // Authorization check
      if (user.role === 'student' && user.id !== studentId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Students can only access their own reports'
          }
        });
      }

      if (user.role === 'teacher') {
        // Verify teacher has access to this batch
        const hasAccess = user.batchIds && user.batchIds.includes(batchId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied to this batch'
            }
          });
        }
      }

      const reportBuffer = await reportService.generateStudentProgressReport(
        studentId,
        batchId,
        format,
        timeRange
      );

      // Log report generation
      await reportService.logReportGeneration(user.id, 'student_progress', format, {
        studentId,
        batchId,
        timeRange,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      const filename = `student-progress-${studentId}-${timeRange}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      const contentType = format === 'excel' ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': reportBuffer.length
      });

      res.status(200).send(reportBuffer);
    } catch (error) {
      console.error('Error generating student progress report:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: 'Failed to generate student progress report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Batch Performance Report
router.get('/batch/:batchId',
  batchReportValidation,
  validateRequest,
  auditMiddleware('GENERATE_BATCH_REPORT'),
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const { timeRange = '30d', format = 'pdf' } = req.query;
      const { user } = req;

      // Authorization check
      if (user.role === 'teacher') {
        const hasAccess = user.batchIds && user.batchIds.includes(batchId);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied to this batch'
            }
          });
        }
      } else if (user.role === 'student') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Students cannot access batch reports'
          }
        });
      }

      const reportBuffer = await reportService.generateBatchPerformanceReport(
        batchId,
        format,
        timeRange
      );

      // Log report generation
      await reportService.logReportGeneration(user.id, 'batch_performance', format, {
        batchId,
        timeRange,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      const filename = `batch-performance-${batchId}-${timeRange}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      const contentType = format === 'excel' ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': reportBuffer.length
      });

      res.status(200).send(reportBuffer);
    } catch (error) {
      console.error('Error generating batch performance report:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: 'Failed to generate batch performance report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Platform Analytics Report (Admin only)
router.get('/platform',
  [...timeRangeValidation, ...formatValidation],
  validateRequest,
  auditMiddleware('GENERATE_PLATFORM_REPORT'),
  async (req, res) => {
    try {
      const { timeRange = '30d', format = 'pdf' } = req.query;
      const { user } = req;

      // Authorization check - Admin only
      if (user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only administrators can access platform reports'
          }
        });
      }

      const reportBuffer = await reportService.generatePlatformAnalyticsReport(
        format,
        timeRange
      );

      // Log report generation
      await reportService.logReportGeneration(user.id, 'platform_analytics', format, {
        timeRange,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      const filename = `platform-analytics-${timeRange}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      const contentType = format === 'excel' ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': reportBuffer.length
      });

      res.status(200).send(reportBuffer);
    } catch (error) {
      console.error('Error generating platform analytics report:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: 'Failed to generate platform analytics report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Assignment Report
router.get('/assignment/:assignmentId',
  assignmentReportValidation,
  validateRequest,
  auditMiddleware('GENERATE_ASSIGNMENT_REPORT'),
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const { format = 'pdf' } = req.query;
      const { user } = req;

      // Authorization check - Teachers and Admins only
      if (user.role === 'student') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Students cannot access assignment reports'
          }
        });
      }

      const reportBuffer = await reportService.generateAssignmentReport(
        assignmentId,
        format
      );

      // Log report generation
      await reportService.logReportGeneration(user.id, 'assignment_report', format, {
        assignmentId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      const filename = `assignment-report-${assignmentId}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      const contentType = format === 'excel' ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': reportBuffer.length
      });

      res.status(200).send(reportBuffer);
    } catch (error) {
      console.error('Error generating assignment report:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: 'Failed to generate assignment report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Custom Report Generation
router.post('/custom',
  [
    body('reportType')
      .isIn(['student_progress', 'batch_performance', 'assignment_analysis', 'engagement_metrics'])
      .withMessage('Invalid report type'),
    body('parameters')
      .isObject()
      .withMessage('Parameters must be an object'),
    body('format')
      .optional()
      .isIn(['pdf', 'excel'])
      .withMessage('Format must be pdf or excel'),
    body('timeRange')
      .optional()
      .isIn(['7d', '30d', '90d', '1y', 'month'])
      .withMessage('Invalid time range')
  ],
  validateRequest,
  auditMiddleware('GENERATE_CUSTOM_REPORT'),
  async (req, res) => {
    try {
      const { reportType, parameters, format = 'pdf', timeRange = '30d' } = req.body;
      const { user } = req;

      // Authorization check based on report type
      if (reportType === 'batch_performance' && user.role === 'student') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Students cannot generate batch performance reports'
          }
        });
      }

      let reportBuffer;
      let filename;

      switch (reportType) {
        case 'student_progress':
          if (!parameters.studentId || !parameters.batchId) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'MISSING_PARAMETERS',
                message: 'Student ID and Batch ID are required for student progress reports'
              }
            });
          }
          reportBuffer = await reportService.generateStudentProgressReport(
            parameters.studentId,
            parameters.batchId,
            format,
            timeRange
          );
          filename = `student-progress-${parameters.studentId}-${timeRange}`;
          break;

        case 'batch_performance':
          if (!parameters.batchId) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'MISSING_PARAMETERS',
                message: 'Batch ID is required for batch performance reports'
              }
            });
          }
          reportBuffer = await reportService.generateBatchPerformanceReport(
            parameters.batchId,
            format,
            timeRange
          );
          filename = `batch-performance-${parameters.batchId}-${timeRange}`;
          break;

        case 'assignment_analysis':
          if (!parameters.assignmentId) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'MISSING_PARAMETERS',
                message: 'Assignment ID is required for assignment analysis reports'
              }
            });
          }
          reportBuffer = await reportService.generateAssignmentReport(
            parameters.assignmentId,
            format
          );
          filename = `assignment-analysis-${parameters.assignmentId}`;
          break;

        case 'engagement_metrics':
          if (user.role !== 'admin') {
            return res.status(403).json({
              success: false,
              error: {
                code: 'FORBIDDEN',
                message: 'Only administrators can generate engagement metrics reports'
              }
            });
          }
          reportBuffer = await reportService.generatePlatformAnalyticsReport(
            format,
            timeRange
          );
          filename = `engagement-metrics-${timeRange}`;
          break;

        default:
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REPORT_TYPE',
              message: 'Unsupported report type'
            }
          });
      }

      // Log report generation
      await reportService.logReportGeneration(user.id, reportType, format, {
        parameters,
        timeRange,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      const fullFilename = `${filename}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      const contentType = format === 'excel' ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fullFilename}"`,
        'Content-Length': reportBuffer.length
      });

      res.status(200).send(reportBuffer);
    } catch (error) {
      console.error('Error generating custom report:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: 'Failed to generate custom report',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get Report History
router.get('/history',
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('reportType')
      .optional()
      .isString()
      .withMessage('Report type must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, reportType } = req.query;
      const { user } = req;

      // This would typically query audit logs for report generation activities
      // For now, return a mock response
      const reportHistory = {
        reports: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalReports: 0,
          hasNext: false,
          hasPrev: false
        }
      };

      res.status(200).json({
        success: true,
        data: reportHistory,
        message: 'Report history retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching report history:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: 'Failed to fetch report history',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Get Available Report Types
router.get('/types',
  async (req, res) => {
    try {
      const { user } = req;
      
      const reportTypes = {
        student: [
          {
            type: 'student_progress',
            name: 'Student Progress Report',
            description: 'Detailed progress report for individual students',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          }
        ],
        teacher: [
          {
            type: 'student_progress',
            name: 'Student Progress Report',
            description: 'Detailed progress report for individual students',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          },
          {
            type: 'batch_performance',
            name: 'Batch Performance Report',
            description: 'Performance overview for entire batches',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          },
          {
            type: 'assignment_analysis',
            name: 'Assignment Analysis Report',
            description: 'Detailed analysis of assignment submissions and grades',
            formats: ['pdf', 'excel'],
            timeRanges: []
          }
        ],
        admin: [
          {
            type: 'student_progress',
            name: 'Student Progress Report',
            description: 'Detailed progress report for individual students',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          },
          {
            type: 'batch_performance',
            name: 'Batch Performance Report',
            description: 'Performance overview for entire batches',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          },
          {
            type: 'assignment_analysis',
            name: 'Assignment Analysis Report',
            description: 'Detailed analysis of assignment submissions and grades',
            formats: ['pdf', 'excel'],
            timeRanges: []
          },
          {
            type: 'platform_analytics',
            name: 'Platform Analytics Report',
            description: 'Comprehensive platform-wide analytics and metrics',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          },
          {
            type: 'engagement_metrics',
            name: 'Engagement Metrics Report',
            description: 'User engagement and activity metrics',
            formats: ['pdf', 'excel'],
            timeRanges: ['7d', '30d', '90d', '1y']
          }
        ]
      };

      const availableReports = reportTypes[user.role] || [];

      res.status(200).json({
        success: true,
        data: {
          reportTypes: availableReports,
          userRole: user.role
        },
        message: 'Available report types retrieved successfully'
      });
    } catch (error) {
      console.error('Error fetching report types:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: 'Failed to fetch report types',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      service: 'Reports Service',
      status: 'healthy',
      timestamp: new Date().toISOString()
    },
    message: 'Reports service is running'
  });
});

module.exports = router;