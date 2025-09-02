const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authMiddleware } = require('../../middleware/authMiddleware');
const chatService = require('../services/chatService');
const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array()
      },
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// Create a new chat room
router.post('/rooms',
  authMiddleware,
  [
    body('batchId').notEmpty().withMessage('Batch ID is required'),
    body('subjectId').notEmpty().withMessage('Subject ID is required'),
    body('name').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Room name must be 1-100 characters'),
    body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be max 500 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId, subjectId, name, description } = req.body;
      const userId = req.user.uid;
      const userRole = req.user.role;

      // Only teachers and admins can create chat rooms
      if (!['teacher', 'admin'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only teachers and admins can create chat rooms'
          },
          timestamp: new Date().toISOString()
        });
      }

      const result = await chatService.createChatRoom(batchId, subjectId, userId, name, description);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CHAT_ROOM_CREATION_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.status(201).json({
        success: true,
        data: result.data,
        message: 'Chat room created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating chat room:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create chat room'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Get chat rooms for a batch
router.get('/rooms',
  authMiddleware,
  [
    query('batchId').notEmpty().withMessage('Batch ID is required'),
    query('subjectId').optional().notEmpty().withMessage('Subject ID cannot be empty if provided')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { batchId, subjectId } = req.query;
      const userId = req.user.uid;

      const result = await chatService.getChatRooms(batchId, subjectId, userId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CHAT_ROOMS_FETCH_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Chat rooms retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch chat rooms'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Get messages for a chat room
router.get('/rooms/:roomId/messages',
  authMiddleware,
  [
    param('roomId').notEmpty().withMessage('Room ID is required'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('lastMessageId').optional().notEmpty().withMessage('Last message ID cannot be empty if provided')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { limit = 50, lastMessageId } = req.query;
      const userId = req.user.uid;

      const result = await chatService.getMessages(roomId, userId, parseInt(limit), lastMessageId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGES_FETCH_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Messages retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Send a message (HTTP fallback for when WebSocket is not available)
router.post('/rooms/:roomId/messages',
  authMiddleware,
  [
    param('roomId').notEmpty().withMessage('Room ID is required'),
    body('content').notEmpty().trim().isLength({ min: 1, max: 2000 }).withMessage('Message content must be 1-2000 characters'),
    body('messageType').optional().isIn(['text', 'file', 'image']).withMessage('Invalid message type'),
    body('attachments').optional().isArray().withMessage('Attachments must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { content, messageType = 'text', attachments = [] } = req.body;
      const userId = req.user.uid;
      const userName = req.user.name;
      const userRole = req.user.role;

      const result = await chatService.sendMessage(roomId, userId, userName, userRole, content, messageType, attachments);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGE_SEND_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.status(201).json({
        success: true,
        data: result.data,
        message: 'Message sent successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send message'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Edit a message
router.put('/messages/:messageId',
  authMiddleware,
  [
    param('messageId').notEmpty().withMessage('Message ID is required'),
    body('content').notEmpty().trim().isLength({ min: 1, max: 2000 }).withMessage('Message content must be 1-2000 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const { content } = req.body;
      const userId = req.user.uid;

      const result = await chatService.editMessage(messageId, userId, content);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGE_EDIT_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Message edited successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error editing message:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to edit message'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Delete a message
router.delete('/messages/:messageId',
  authMiddleware,
  [
    param('messageId').notEmpty().withMessage('Message ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.uid;
      const userRole = req.user.role;

      const result = await chatService.deleteMessage(messageId, userId, userRole);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGE_DELETE_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Message deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete message'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Add reaction to a message
router.post('/messages/:messageId/reactions',
  authMiddleware,
  [
    param('messageId').notEmpty().withMessage('Message ID is required'),
    body('emoji').notEmpty().trim().isLength({ min: 1, max: 10 }).withMessage('Emoji is required and must be 1-10 characters')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const { emoji } = req.body;
      const userId = req.user.uid;
      const userName = req.user.name;

      const result = await chatService.addReaction(messageId, userId, userName, emoji);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'REACTION_ADD_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.status(201).json({
        success: true,
        data: result.data,
        message: 'Reaction added successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add reaction'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Remove reaction from a message
router.delete('/messages/:messageId/reactions/:emoji',
  authMiddleware,
  [
    param('messageId').notEmpty().withMessage('Message ID is required'),
    param('emoji').notEmpty().withMessage('Emoji is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { messageId, emoji } = req.params;
      const userId = req.user.uid;

      const result = await chatService.removeReaction(messageId, userId, decodeURIComponent(emoji));

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'REACTION_REMOVE_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Reaction removed successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error removing reaction:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove reaction'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Get unread message count
router.get('/unread-count',
  authMiddleware,
  [
    query('roomId').optional().notEmpty().withMessage('Room ID cannot be empty if provided')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId } = req.query;
      const userId = req.user.uid;

      const result = await chatService.getUnreadCount(userId, roomId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'UNREAD_COUNT_FETCH_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Unread count retrieved successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch unread count'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Update chat room settings
router.put('/rooms/:roomId/settings',
  authMiddleware,
  [
    param('roomId').notEmpty().withMessage('Room ID is required'),
    body('allowFileSharing').optional().isBoolean().withMessage('Allow file sharing must be a boolean'),
    body('allowStudentMessages').optional().isBoolean().withMessage('Allow student messages must be a boolean'),
    body('moderationEnabled').optional().isBoolean().withMessage('Moderation enabled must be a boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const settings = req.body;
      const userId = req.user.uid;
      const userRole = req.user.role;

      const result = await chatService.updateRoomSettings(roomId, userId, userRole, settings);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'ROOM_SETTINGS_UPDATE_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Room settings updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating room settings:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update room settings'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Search messages in a room
router.get('/rooms/:roomId/search',
  authMiddleware,
  [
    param('roomId').notEmpty().withMessage('Room ID is required'),
    query('q').notEmpty().trim().isLength({ min: 1, max: 100 }).withMessage('Search query must be 1-100 characters'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { q: searchTerm, limit = 20 } = req.query;
      const userId = req.user.uid;

      const result = await chatService.searchMessages(roomId, userId, searchTerm, parseInt(limit));

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MESSAGE_SEARCH_FAILED',
            message: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: result.data,
        message: 'Messages searched successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error searching messages:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to search messages'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

module.exports = router;