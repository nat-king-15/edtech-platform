const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');
const notificationRoutes = require('../../routes/notifications');
const NotificationService = require('../../services/notificationService');

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  apps: [],
  messaging: jest.fn(() => ({
    send: jest.fn(),
    sendMulticast: jest.fn()
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'mock-timestamp')
    },
    Timestamp: {
      now: jest.fn(() => 'mock-timestamp'),
      fromDate: jest.fn(() => 'mock-timestamp')
    }
  },
  auth: jest.fn()
}));

// Mock Firebase config
jest.mock('../../config/firebase', () => ({
  admin: {
    apps: [],
    messaging: jest.fn(() => ({
      send: jest.fn(),
      sendMulticast: jest.fn()
    })),
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp')
      },
      Timestamp: {
        now: jest.fn(() => 'mock-timestamp'),
        fromDate: jest.fn(() => 'mock-timestamp')
      }
    }
  },
  firestore: jest.fn(() => ({
    collection: jest.fn(),
    doc: jest.fn()
  })),
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(),
      where: jest.fn(),
      add: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }))
  }
}));

// Mock NotificationService
jest.mock('../../services/notificationService', () => ({
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  getUserNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  storeFCMToken: jest.fn(),
  removeFCMToken: jest.fn(),
  subscribeToTopics: jest.fn(),
  unsubscribeFromTopics: jest.fn()
}));

// Mock auth middleware
jest.mock('../../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = {
      uid: req.headers['x-user-id'] || 'test-user-id',
      role: req.headers['x-user-role'] || 'student'
    };
    next();
  },
  requireRole: (role) => (req, res, next) => {
    if (req.user.role === role) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions'
        }
      });
    }
  },
  requireAdmin: (req, res, next) => {
    if (req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required'
        }
      });
    }
  },
  requireTeacherOrAdmin: (req, res, next) => {
    if (['teacher', 'admin'].includes(req.user.role)) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Teacher or admin access required'
        }
      });
    }
  }
}));

describe('Notification Routes - Standardized Endpoints', () => {
  let app;
  let server;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes);
    server = app.listen(0); // Use random port for testing
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /api/notifications/:id/read - Standardized endpoint', () => {
    it('should mark notification as read for student user', async () => {
      const notificationId = 'test-notification-123';
      const userId = 'student-user-123';
      
      NotificationService.markAsRead.mockResolvedValue({
        success: true,
        message: 'Notification marked as read'
      });

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Notification marked as read',
        timestamp: 'mock-timestamp'
      });

      expect(NotificationService.markAsRead).toHaveBeenCalledWith(notificationId, userId);
    });

    it('should mark notification as read for teacher user', async () => {
      const notificationId = 'test-notification-456';
      const userId = 'teacher-user-456';
      
      NotificationService.markAsRead.mockResolvedValue({
        success: true,
        message: 'Notification marked as read'
      });

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'teacher')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Notification marked as read',
        timestamp: 'mock-timestamp'
      });

      expect(NotificationService.markAsRead).toHaveBeenCalledWith(notificationId, userId);
    });

    it('should mark notification as read for admin user', async () => {
      const notificationId = 'test-notification-789';
      const userId = 'admin-user-789';
      
      NotificationService.markAsRead.mockResolvedValue({
        success: true,
        message: 'Notification marked as read'
      });

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'admin')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Notification marked as read',
        timestamp: 'mock-timestamp'
      });

      expect(NotificationService.markAsRead).toHaveBeenCalledWith(notificationId, userId);
    });

    it('should return 404 when notification not found', async () => {
      const notificationId = 'nonexistent-notification';
      const userId = 'student-user-123';
      
      NotificationService.markAsRead.mockRejectedValue(new Error('Notification not found'));

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Notification not found'
        },
        timestamp: 'mock-timestamp'
      });
    });

    it('should return 403 when user tries to mark notification they don\'t own', async () => {
      const notificationId = 'test-notification-123';
      const userId = 'student-user-123';
      
      NotificationService.markAsRead.mockRejectedValue(
        new Error('Unauthorized access to notification')
      );

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(403);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only mark your own notifications as read'
        },
        timestamp: 'mock-timestamp'
      });
    });

    it('should return 500 for internal server errors', async () => {
      const notificationId = 'test-notification-123';
      const userId = 'student-user-123';
      
      NotificationService.markAsRead.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put(`/api/notifications/${notificationId}/read`)
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark notification as read'
        },
        timestamp: 'mock-timestamp',
      });
    });
  });

  describe('PUT /api/notifications/mark-all-read - Standardized endpoint', () => {
    it('should mark all notifications as read for any user type', async () => {
      const userId = 'test-user-123';
      
      NotificationService.markAllAsRead.mockResolvedValue({
        updatedCount: 5
      });

      const response = await request(app)
        .put('/api/notifications/mark-all-read')
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'All notifications marked as read',
        data: {
          updatedCount: 5,
        },
        timestamp: 'mock-timestamp',
      });

      expect(NotificationService.markAllAsRead).toHaveBeenCalledWith(userId);
    });

    it('should return 0 updated count when no unread notifications', async () => {
      const userId = 'test-user-123';
      
      NotificationService.markAllAsRead.mockResolvedValue({
        updatedCount: 0
      });

      const response = await request(app)
        .put('/api/notifications/mark-all-read')
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(200);

      expect(response.body.data.updatedCount).toBe(0);
    });

    it('should handle service errors gracefully', async () => {
      const userId = 'test-user-123';
      
      NotificationService.markAllAsRead.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .put('/api/notifications/mark-all-read')
        .set('x-user-id', userId)
        .set('x-user-role', 'student')
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark all notifications as read'
        },
        timestamp: 'mock-timestamp',
      });
    });
  });

  describe('Response format consistency', () => {
    it('should have consistent response format across all notification endpoints', async () => {
      // Test single notification read
      NotificationService.markAsRead.mockResolvedValue({ success: true });
      const singleResponse = await request(app)
        .put('/api/notifications/test-id/read')
        .set('x-user-id', 'test-user')
        .set('x-user-role', 'student');

      expect(singleResponse.body).toHaveProperty('success');
      expect(singleResponse.body).toHaveProperty('message');
      expect(singleResponse.body).toHaveProperty('timestamp');

      // Test mark all read
      NotificationService.markAllAsRead.mockResolvedValue({ updatedCount: 3 });
      const allResponse = await request(app)
        .put('/api/notifications/mark-all-read')
        .set('x-user-id', 'test-user')
        .set('x-user-role', 'student');

      expect(allResponse.body).toHaveProperty('success');
      expect(allResponse.body).toHaveProperty('message');
      expect(allResponse.body).toHaveProperty('data');
      expect(allResponse.body).toHaveProperty('timestamp');
    });
  });
});