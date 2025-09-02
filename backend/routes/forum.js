const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validation');
const forumService = require('../services/forumService');
const { logAuditEvent, AUDIT_EVENTS, RISK_LEVELS } = require('../middleware/auditLogger');
const { body, query, param } = require('express-validator');

/**
 * Forum Routes
 * Handles discussion forums, threaded conversations, and voting system
 */

/**
 * Create a new forum topic
 * POST /api/forum/topics
 */
router.post('/topics', 
  authMiddleware,
  [
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('title').isLength({ min: 5, max: 200 }).withMessage('Title must be 5-200 characters'),
    body('content').isLength({ min: 10, max: 5000 }).withMessage('Content must be 10-5000 characters'),
    body('category').optional().isIn(['general', 'question', 'discussion', 'announcement', 'help']).withMessage('Invalid category'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('subjectId').optional().isString().withMessage('Subject ID must be a string'),
    body('isPinned').optional().isBoolean().withMessage('isPinned must be a boolean')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      const topic = await forumService.createTopic(req.body, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_CREATION, req, {
        contentType: 'forum_topic',
        contentId: topic.id,
        batchId: req.body.batchId,
        riskLevel: RISK_LEVELS.LOW
      });
      
      res.status(201).json({
        success: true,
        data: topic,
        message: 'Forum topic created successfully'
      });
    } catch (error) {
      console.error('Failed to create forum topic:', error);
      
      await logAuditEvent(AUDIT_EVENTS.SYSTEM_ERROR, req, {
        error: error.message,
        action: 'create_forum_topic',
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      res.status(400).json({
        success: false,
        error: {
          code: 'TOPIC_CREATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Get forum topics with filtering and pagination
 * GET /api/forum/topics
 */
router.get('/topics',
  authMiddleware,
  [
    query('batchId').optional().isString().withMessage('Batch ID must be a string'),
    query('subjectId').optional().isString().withMessage('Subject ID must be a string'),
    query('category').optional().isIn(['general', 'question', 'discussion', 'announcement', 'help']).withMessage('Invalid category'),
    query('sortBy').optional().isIn(['createdAt', 'updatedAt', 'votes.score', 'replyCount', 'viewCount']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be >= 0'),
    query('search').optional().isLength({ min: 2, max: 100 }).withMessage('Search term must be 2-100 characters')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const topics = await forumService.getTopics(req.query);
      
      res.json({
        success: true,
        data: {
          topics,
          pagination: {
            limit: parseInt(req.query.limit) || 20,
            offset: parseInt(req.query.offset) || 0,
            count: topics.length
          }
        },
        message: 'Forum topics retrieved successfully'
      });
    } catch (error) {
      console.error('Failed to get forum topics:', error);
      
      res.status(500).json({
        success: false,
        error: {
          code: 'TOPICS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve forum topics'
        }
      });
    }
  }
);

/**
 * Get a single forum topic with replies
 * GET /api/forum/topics/:topicId
 */
router.get('/topics/:topicId',
  authMiddleware,
  [
    param('topicId').isString().withMessage('Topic ID must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const userId = req.user.uid;
      
      const topic = await forumService.getTopic(topicId, userId);
      
      res.json({
        success: true,
        data: topic,
        message: 'Forum topic retrieved successfully'
      });
    } catch (error) {
      console.error('Failed to get forum topic:', error);
      
      const statusCode = error.message === 'Topic not found' ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 404 ? 'TOPIC_NOT_FOUND' : 'TOPIC_RETRIEVAL_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Create a reply to a topic or another reply
 * POST /api/forum/topics/:topicId/replies
 */
router.post('/topics/:topicId/replies',
  authMiddleware,
  [
    param('topicId').isString().withMessage('Topic ID must be a string'),
    body('content').isLength({ min: 5, max: 2000 }).withMessage('Content must be 5-2000 characters'),
    body('parentReplyId').optional().isString().withMessage('Parent reply ID must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      const replyData = {
        topicId,
        ...req.body
      };
      
      const reply = await forumService.createReply(replyData, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_CREATION, req, {
        contentType: 'forum_reply',
        contentId: reply.id,
        topicId,
        riskLevel: RISK_LEVELS.LOW
      });
      
      res.status(201).json({
        success: true,
        data: reply,
        message: 'Reply created successfully'
      });
    } catch (error) {
      console.error('Failed to create reply:', error);
      
      await logAuditEvent(AUDIT_EVENTS.SYSTEM_ERROR, req, {
        error: error.message,
        action: 'create_forum_reply',
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      const statusCode = error.message.includes('not found') || error.message.includes('locked') ? 400 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: 'REPLY_CREATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Vote on a topic or reply
 * POST /api/forum/vote
 */
router.post('/vote',
  authMiddleware,
  [
    body('topicId').isString().withMessage('Topic ID is required'),
    body('replyId').optional().isString().withMessage('Reply ID must be a string'),
    body('voteType').isIn(['upvote', 'downvote']).withMessage('Vote type must be upvote or downvote')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const userId = req.user.uid;
      
      const result = await forumService.vote(req.body, userId);
      
      await logAuditEvent(AUDIT_EVENTS.USER_INTERACTION, req, {
        action: 'forum_vote',
        voteType: req.body.voteType,
        topicId: req.body.topicId,
        replyId: req.body.replyId,
        riskLevel: RISK_LEVELS.LOW
      });
      
      res.json({
        success: true,
        data: result,
        message: 'Vote recorded successfully'
      });
    } catch (error) {
      console.error('Failed to record vote:', error);
      
      res.status(400).json({
        success: false,
        error: {
          code: 'VOTE_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Pin/unpin a topic (admin/teacher only)
 * PUT /api/forum/topics/:topicId/pin
 */
router.put('/topics/:topicId/pin',
  authMiddleware,
  [
    param('topicId').isString().withMessage('Topic ID must be a string'),
    body('isPinned').isBoolean().withMessage('isPinned must be a boolean')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const { isPinned } = req.body;
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      await forumService.pinTopic(topicId, isPinned, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_MODERATION, req, {
        action: isPinned ? 'pin_topic' : 'unpin_topic',
        topicId,
        riskLevel: RISK_LEVELS.LOW
      });
      
      res.json({
        success: true,
        message: `Topic ${isPinned ? 'pinned' : 'unpinned'} successfully`
      });
    } catch (error) {
      console.error('Failed to pin/unpin topic:', error);
      
      const statusCode = error.message === 'Insufficient permissions' ? 403 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 403 ? 'INSUFFICIENT_PERMISSIONS' : 'PIN_OPERATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Lock/unlock a topic (admin/teacher only)
 * PUT /api/forum/topics/:topicId/lock
 */
router.put('/topics/:topicId/lock',
  authMiddleware,
  [
    param('topicId').isString().withMessage('Topic ID must be a string'),
    body('isLocked').isBoolean().withMessage('isLocked must be a boolean')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const { isLocked } = req.body;
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      await forumService.lockTopic(topicId, isLocked, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_MODERATION, req, {
        action: isLocked ? 'lock_topic' : 'unlock_topic',
        topicId,
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      res.json({
        success: true,
        message: `Topic ${isLocked ? 'locked' : 'unlocked'} successfully`
      });
    } catch (error) {
      console.error('Failed to lock/unlock topic:', error);
      
      const statusCode = error.message === 'Insufficient permissions' ? 403 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 403 ? 'INSUFFICIENT_PERMISSIONS' : 'LOCK_OPERATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Delete a topic (admin/teacher/author only)
 * DELETE /api/forum/topics/:topicId
 */
router.delete('/topics/:topicId',
  authMiddleware,
  [
    param('topicId').isString().withMessage('Topic ID must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { topicId } = req.params;
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      await forumService.deleteContent('topic', topicId, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_DELETION, req, {
        contentType: 'forum_topic',
        contentId: topicId,
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      res.json({
        success: true,
        message: 'Topic deleted successfully'
      });
    } catch (error) {
      console.error('Failed to delete topic:', error);
      
      const statusCode = error.message === 'Insufficient permissions' ? 403 : 
                        error.message.includes('not found') ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 403 ? 'INSUFFICIENT_PERMISSIONS' : 
                statusCode === 404 ? 'TOPIC_NOT_FOUND' : 'DELETE_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Delete a reply (admin/teacher/author only)
 * DELETE /api/forum/replies/:replyId
 */
router.delete('/replies/:replyId',
  authMiddleware,
  [
    param('replyId').isString().withMessage('Reply ID must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { replyId } = req.params;
      const userId = req.user.uid;
      const userRole = req.user.role;
      
      await forumService.deleteContent('reply', replyId, userId, userRole);
      
      await logAuditEvent(AUDIT_EVENTS.CONTENT_DELETION, req, {
        contentType: 'forum_reply',
        contentId: replyId,
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      res.json({
        success: true,
        message: 'Reply deleted successfully'
      });
    } catch (error) {
      console.error('Failed to delete reply:', error);
      
      const statusCode = error.message === 'Insufficient permissions' ? 403 : 
                        error.message.includes('not found') ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 403 ? 'INSUFFICIENT_PERMISSIONS' : 
                statusCode === 404 ? 'REPLY_NOT_FOUND' : 'DELETE_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * Get forum statistics for a batch
 * GET /api/forum/stats/:batchId
 */
router.get('/stats/:batchId',
  authMiddleware,
  [
    param('batchId').isString().withMessage('Batch ID must be a string')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { batchId } = req.params;
      
      const stats = await forumService.getForumStats(batchId);
      
      res.json({
        success: true,
        data: stats,
        message: 'Forum statistics retrieved successfully'
      });
    } catch (error) {
      console.error('Failed to get forum stats:', error);
      
      res.status(500).json({
        success: false,
        error: {
          code: 'STATS_RETRIEVAL_FAILED',
          message: 'Failed to retrieve forum statistics'
        }
      });
    }
  }
);

module.exports = router;