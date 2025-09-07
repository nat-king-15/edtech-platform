const express = require('express');
const router = express.Router();
const { authMiddleware: requireAuth, requireRole } = require('../middleware/authMiddleware');
const contentService = require('../services/contentService');
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
 * Get user's purchased batches
 * Similar to pw-extractor's batch fetching
 */
router.get('/batches', 
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
      const limit = parseInt(req.query.limit) || 20;
      
      const result = await contentService.fetchUserBatches(userId, page, limit);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching user batches:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get subjects for a specific batch
 */
router.get('/batches/:batchId/subjects',
  requireAuth,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { batchId } = req.params;
      
      const result = await contentService.fetchBatchSubjects(batchId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching batch subjects:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get topics/chapters for a specific subject
 */
router.get('/subjects/:subjectId/topics',
  requireAuth,
  [
    param('subjectId').notEmpty().withMessage('Subject ID is required'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { subjectId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      
      const result = await contentService.fetchSubjectTopics(subjectId, page, limit);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching subject topics:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get notes/attachments for a specific topic
 */
router.get('/topics/:topicId/notes',
  requireAuth,
  [
    param('topicId').notEmpty().withMessage('Topic ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { topicId } = req.params;
      
      const result = await contentService.fetchTopicNotes(topicId);
      
      if (result.success) {
        // Track notes access
        if (result.notes && result.notes.length > 0) {
          const firstNote = result.notes[0];
          await trackingService.trackNotesAccess(userId, {
            notesId: firstNote.id,
            title: firstNote.title,
            batchId: firstNote.batchId,
            subjectId: firstNote.subjectId,
            topicId: topicId,
            timeSpent: 0 // Will be updated by frontend
          });
        }
        
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching topic notes:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get DPP (Daily Practice Problems) for a specific topic
 */
router.get('/topics/:topicId/dpp',
  requireAuth,
  [
    param('topicId').notEmpty().withMessage('Topic ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { topicId } = req.params;
      
      const result = await contentService.fetchTopicDPP(topicId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching topic DPP:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get quiz attempt ID for a specific quiz
 */
router.get('/quiz/:quizId/attempt-id',
  requireAuth,
  [
    param('quizId').notEmpty().withMessage('Quiz ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { quizId } = req.params;
      
      const result = await contentService.getQuizAttemptId(userId, quizId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting quiz attempt ID:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get quiz questions for a specific attempt
 */
router.get('/quiz/:quizId/questions',
  requireAuth,
  [
    param('quizId').notEmpty().withMessage('Quiz ID is required'),
    query('attemptId').notEmpty().withMessage('Attempt ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { quizId } = req.params;
      const { attemptId } = req.query;
      
      const result = await contentService.fetchQuizQuestions(attemptId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error fetching quiz questions:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Search content across batches and subjects
 */
router.get('/search',
  requireAuth,
  [
    query('q').notEmpty().withMessage('Search query is required'),
    query('type').optional().isIn(['video', 'notes', 'quiz', 'assignment']).withMessage('Invalid content type'),
    query('batchId').optional().notEmpty().withMessage('Batch ID cannot be empty'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { q: query, type, batchId } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      
      const result = await contentService.searchContent(userId, query, {
        contentType: type,
        batchId: batchId,
        page: page,
        limit: limit
      });
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error searching content:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get content count by type for a specific batch
 */
router.get('/batches/:batchId/content-count',
  requireAuth,
  [
    param('batchId').notEmpty().withMessage('Batch ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      
      const result = await contentService.countContentByType(batchId, 'all');
      
      res.json({
        success: true,
        contentCount: result
      });
    } catch (error) {
      console.error('Error getting content count:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Track video progress
 */
router.post('/track/video',
  requireAuth,
  [
    body('videoId').notEmpty().withMessage('Video ID is required'),
    body('currentTime').isNumeric().withMessage('Current time must be a number'),
    body('duration').isNumeric().withMessage('Duration must be a number'),
    body('watchTime').optional().isNumeric().withMessage('Watch time must be a number'),
    body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const videoData = {
        ...req.body,
        completionPercentage: req.body.duration > 0 ? Math.round((req.body.currentTime / req.body.duration) * 100) : 0
      };
      
      const result = await trackingService.trackVideoProgress(userId, videoData);
      
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
 */
router.post('/track/notes',
  requireAuth,
  [
    body('notesId').notEmpty().withMessage('Notes ID is required'),
    body('timeSpent').optional().isNumeric().withMessage('Time spent must be a number'),
    body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('topicId').notEmpty().withMessage('Topic ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const notesData = req.body;
      
      const result = await trackingService.trackNotesAccess(userId, notesData);
      
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
 * Get user progress statistics
 */
router.get('/progress/stats',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await trackingService.getUserProgressStats(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting progress stats:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

/**
 * Get progress for specific content
 */
router.get('/progress/:contentId',
  requireAuth,
  [
    param('contentId').notEmpty().withMessage('Content ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const { contentId } = req.params;
      
      const result = await trackingService.getContentProgress(userId, contentId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(result.error_status || 500).json(result);
      }
    } catch (error) {
      console.error('Error getting content progress:', error);
      res.status(500).json({
        success: false,
        error_message: 'Internal server error'
      });
    }
  }
);

module.exports = router;