const express = require('express');
const multer = require('multer');
const assignmentService = require('../services/assignmentService');
const { authMiddleware, requireRole } = require('../../middleware/authMiddleware');
const { validateRequest } = require('../../middleware/validation');
const { body, param, query } = require('express-validator');
const { db } = require('../../config/firebase');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 10 // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = /\.(pdf|doc|docx|txt|rtf|jpg|jpeg|png|gif|zip|rar|7z)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Validation schemas
const createAssignmentValidation = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('description').trim().isLength({ min: 1, max: 2000 }).withMessage('Description must be 1-2000 characters'),
  body('instructions').optional().trim().isLength({ max: 5000 }).withMessage('Instructions must not exceed 5000 characters'),
  body('batchId').isUUID().withMessage('Invalid batch ID'),
  body('subjectId').isUUID().withMessage('Invalid subject ID'),
  body('dueDate').isISO8601().withMessage('Invalid due date format'),
  body('maxPoints').isInt({ min: 1, max: 1000 }).withMessage('Max points must be between 1 and 1000'),
  body('allowLateSubmission').optional().isBoolean().withMessage('Allow late submission must be boolean'),
  body('lateSubmissionPenalty').optional().isInt({ min: 0, max: 100 }).withMessage('Late penalty must be 0-100%'),
  body('allowedFileTypes').optional().isArray().withMessage('Allowed file types must be an array'),
  body('maxFileSize').optional().isInt({ min: 1 }).withMessage('Max file size must be positive'),
  body('maxFiles').optional().isInt({ min: 1, max: 20 }).withMessage('Max files must be 1-20'),
  body('isGroupAssignment').optional().isBoolean().withMessage('Is group assignment must be boolean'),
  body('maxGroupSize').optional().isInt({ min: 1, max: 10 }).withMessage('Max group size must be 1-10')
];

const submitAssignmentValidation = [
  param('assignmentId').isUUID().withMessage('Invalid assignment ID'),
  body('text').optional().trim().isLength({ max: 10000 }).withMessage('Text must not exceed 10000 characters'),
  body('groupMembers').optional().isArray().withMessage('Group members must be an array')
];

const gradeSubmissionValidation = [
  param('submissionId').isUUID().withMessage('Invalid submission ID'),
  body('grade').isFloat({ min: 0 }).withMessage('Grade must be a positive number'),
  body('feedback').optional().trim().isLength({ max: 2000 }).withMessage('Feedback must not exceed 2000 characters'),
  body('rubricScores').optional().isArray().withMessage('Rubric scores must be an array')
];

/**
 * @route POST /api/assignments
 * @desc Create a new assignment
 * @access Teacher only
 */
router.post('/',
  authMiddleware,
  requireRole(['teacher']),
  createAssignmentValidation,
  validateRequest,
  async (req, res) => {
    try {
      const result = await assignmentService.createAssignment(req.body, req.user.id);
      
      res.status(201).json({
        success: true,
        message: 'Assignment created successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Create assignment error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'ASSIGNMENT_CREATION_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/assignments/batch/:batchId
 * @desc Get assignments for a batch
 * @access Teacher and enrolled students
 */
router.get('/batch/:batchId',
  authMiddleware,
  param('batchId').isUUID().withMessage('Invalid batch ID'),
  query('subjectId').optional().isUUID().withMessage('Invalid subject ID'),
  validateRequest,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      const { subjectId } = req.query;
      
      const assignments = await assignmentService.getAssignmentsForBatch(
        batchId,
        subjectId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        data: assignments,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assignments error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'ASSIGNMENTS_FETCH_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/assignments/:assignmentId
 * @desc Get assignment details
 * @access Teacher and enrolled students
 */
router.get('/:assignmentId',
  authMiddleware,
  param('assignmentId').isUUID().withMessage('Invalid assignment ID'),
  validateRequest,
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      
      const assignment = await assignmentService.getAssignmentDetails(
        assignmentId,
        req.user.id,
        req.user.role
      );
      
      res.json({
        success: true,
        data: assignment,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assignment details error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'ASSIGNMENT_FETCH_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/assignments/:assignmentId/submit
 * @desc Submit assignment
 * @access Students only
 */
router.post('/:assignmentId/submit',
  authMiddleware,
  requireRole(['student']),
  upload.array('files', 10),
  submitAssignmentValidation,
  validateRequest,
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const files = req.files || [];
      
      const result = await assignmentService.submitAssignment(
        assignmentId,
        req.user.id,
        req.body,
        files
      );
      
      res.status(201).json({
        success: true,
        message: 'Assignment submitted successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Submit assignment error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'ASSIGNMENT_SUBMISSION_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/assignments/:assignmentId/submissions
 * @desc Get submissions for an assignment
 * @access Teacher only
 */
router.get('/:assignmentId/submissions',
  authMiddleware,
  requireRole(['teacher']),
  param('assignmentId').isUUID().withMessage('Invalid assignment ID'),
  query('status').optional().isIn(['submitted', 'graded']).withMessage('Invalid status filter'),
  query('isLate').optional().isBoolean().withMessage('Invalid late filter'),
  validateRequest,
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const filters = {
        status: req.query.status,
        isLate: req.query.isLate ? req.query.isLate === 'true' : undefined
      };
      
      const submissions = await assignmentService.getSubmissions(
        assignmentId,
        req.user.id,
        filters
      );
      
      res.json({
        success: true,
        data: submissions,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get submissions error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'SUBMISSIONS_FETCH_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/assignments/submissions/:submissionId/grade
 * @desc Grade a submission
 * @access Teacher only
 */
router.post('/submissions/:submissionId/grade',
  authMiddleware,
  requireRole(['teacher']),
  gradeSubmissionValidation,
  validateRequest,
  async (req, res) => {
    try {
      const { submissionId } = req.params;
      
      const result = await assignmentService.gradeSubmission(
        submissionId,
        req.user.id,
        req.body
      );
      
      res.json({
        success: true,
        message: 'Submission graded successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Grade submission error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'SUBMISSION_GRADING_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route DELETE /api/assignments/:assignmentId
 * @desc Delete an assignment
 * @access Teacher only
 */
router.delete('/:assignmentId',
  authMiddleware,
  requireRole(['teacher']),
  param('assignmentId').isUUID().withMessage('Invalid assignment ID'),
  validateRequest,
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      
      await assignmentService.deleteAssignment(assignmentId, req.user.id);
      
      res.json({
        success: true,
        message: 'Assignment deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Delete assignment error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'ASSIGNMENT_DELETION_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/assignments/student/my-submissions
 * @desc Get student's own submissions
 * @access Students only
 */
router.get('/student/my-submissions',
  authMiddleware,
  requireRole(['student']),
  query('batchId').optional().isUUID().withMessage('Invalid batch ID'),
  query('status').optional().isIn(['submitted', 'graded']).withMessage('Invalid status filter'),
  validateRequest,
  async (req, res) => {
    try {
      const { batchId, status } = req.query;
      
      let query = db.collection('submissions')
        .where('studentId', '==', req.user.id)
        .where('status', 'in', ['submitted', 'graded'])
        .orderBy('submittedAt', 'desc');

      const snapshot = await query.get();
      const submissions = [];

      for (const doc of snapshot.docs) {
        const submission = doc.data();
        
        // Get assignment details
        const assignmentDoc = await db.collection('assignments').doc(submission.assignmentId).get();
        if (assignmentDoc.exists) {
          const assignment = assignmentDoc.data();
          
          // Apply filters
          if (batchId && assignment.batchId !== batchId) continue;
          if (status && submission.status !== status) continue;
          
          submission.assignmentTitle = assignment.title;
          submission.assignmentMaxPoints = assignment.maxPoints;
          submission.assignmentDueDate = assignment.dueDate;
          submission.batchId = assignment.batchId;
          submission.subjectId = assignment.subjectId;
        }
        
        submissions.push(submission);
      }
      
      res.json({
        success: true,
        data: submissions,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student submissions error:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'STUDENT_SUBMISSIONS_FETCH_FAILED',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds the maximum limit'
        },
        timestamp: new Date().toISOString()
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_FILES',
          message: 'Too many files uploaded'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
  
  if (error.message === 'Invalid file type') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: 'One or more files have invalid file types'
      },
      timestamp: new Date().toISOString()
    });
  }
  
  next(error);
});

module.exports = router;