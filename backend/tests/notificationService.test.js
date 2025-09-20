const notificationService = require('../services/notificationService');
const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');
const emailService = require('../utils/emailService');
const fcmService = require('../utils/fcmService');

// Mock Firebase
jest.mock('../config/firebase', () => ({
  firestore: {
    collection: jest.fn(),
    FieldValue: {
      serverTimestamp: jest.fn(() => 'mocked-timestamp')
    }
  }
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'mocked-timestamp')
    }
  }
}));

// Mock email service (Nodemailer)
jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn()
}));

// Mock FCM service
jest.mock('../utils/fcmService', () => ({
  sendNotification: jest.fn(),
  sendToTopic: jest.fn(),
  subscribeToTopic: jest.fn(),
  unsubscribeFromTopic: jest.fn()
}));

describe('NotificationService', () => {
  let mockCollection, mockDoc, mockGet, mockSet, mockUpdate, mockWhere, mockOrderBy, mockLimit;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock chain for Firestore
    mockSet = jest.fn();
    mockUpdate = jest.fn();
    mockGet = jest.fn();
    mockWhere = jest.fn();
    mockOrderBy = jest.fn();
    mockLimit = jest.fn();
    
    mockDoc = jest.fn(() => ({
      id: 'mock-notification-id',
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    }));
    
    mockCollection = jest.fn(() => ({
      doc: mockDoc,
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet,
      add: jest.fn()
    }));

    // Setup chaining for queries
    mockWhere.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet
    });

    mockOrderBy.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet
    });

    mockLimit.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet
    });
    
    firestore.collection.mockReturnValue({
      doc: mockDoc,
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      get: mockGet,
      add: jest.fn()
    });
  });

  describe('sendNotification', () => {
    it('should send email and in-app notification successfully', async () => {
      const userId = 'user123';
      const type = 'ENROLLMENT_SUCCESS';
      const data = {
        studentName: 'John Doe',
        batchName: 'React Basics',
        courseName: 'Web Development',
        startDate: '2024-01-15',
        amount: '5000'
      };

      // Mock user document
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          email: 'john@example.com',
          name: 'John Doe',
          fcmTokens: ['token123']
        })
      });

      // Mock notification document creation
      const mockAdd = jest.fn().mockResolvedValue({ id: 'notification123' });
      firestore.collection().add = mockAdd;

      // Mock email service success
      emailService.sendEmail.mockResolvedValue(true);

      // Mock FCM service success
      fcmService.sendNotification.mockResolvedValue(true);

      const result = await notificationService.sendNotification(userId, type, data, {
        sendEmail: true,
        sendInApp: true,
        sendPush: true
      });

      expect(result).toBe(true);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'john@example.com',
        'Enrollment Successful - React Basics',
        expect.stringContaining('John Doe')
      );
      expect(fcmService.sendNotification).toHaveBeenCalledWith(
        ['token123'],
        expect.objectContaining({
          title: 'Enrollment Successful',
          body: expect.stringContaining('React Basics')
        })
      );
      expect(mockAdd).toHaveBeenCalled();
    });

    it('should handle user not found', async () => {
      const userId = 'nonexistent';
      const type = 'ENROLLMENT_SUCCESS';

      mockGet.mockResolvedValue({
        exists: false
      });

      const result = await notificationService.sendNotification(userId, type, {});

      expect(result).toBe(false);
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(fcmService.sendNotification).not.toHaveBeenCalled();
    });

    it('should handle email service failure gracefully', async () => {
      const userId = 'user123';
      const type = 'PAYMENT_SUCCESS';
      const data = {
        studentName: 'Jane Doe',
        amount: '3000',
        paymentId: 'pay123',
        batchName: 'Node.js Course'
      };

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          email: 'jane@example.com',
          name: 'Jane Doe'
        })
      });

      const mockAdd = jest.fn().mockResolvedValue({ id: 'notification123' });
      firestore.collection().add = mockAdd;

      // Mock email service failure
      emailService.sendEmail.mockRejectedValue(new Error('SMTP connection failed'));

      const result = await notificationService.sendNotification(userId, type, data, {
        sendEmail: true,
        sendInApp: true
      });

      expect(result).toBe(true); // Should still succeed for in-app notification
      expect(mockAdd).toHaveBeenCalled();
    });

    it('should handle FCM service failure gracefully', async () => {
      const userId = 'user123';
      const type = 'BATCH_ANNOUNCEMENT';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          email: 'user@example.com',
          name: 'Test User',
          fcmTokens: ['token123']
        })
      });

      const mockAdd = jest.fn().mockResolvedValue({ id: 'notification123' });
      firestore.collection().add = mockAdd;

      // Mock FCM service failure
      fcmService.sendNotification.mockRejectedValue(new Error('FCM token invalid'));

      const result = await notificationService.sendNotification(userId, type, {}, {
        sendPush: true,
        sendInApp: true
      });

      expect(result).toBe(true); // Should still succeed for in-app notification
      expect(mockAdd).toHaveBeenCalled();
    });

    it('should handle invalid notification type', async () => {
      const userId = 'user123';
      const type = 'INVALID_TYPE';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          email: 'user@example.com',
          name: 'Test User'
        })
      });

      const result = await notificationService.sendNotification(userId, type, {});

      expect(result).toBe(false);
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendBulkNotification', () => {
    it('should send notifications to multiple users', async () => {
      const userIds = ['user1', 'user2', 'user3'];
      const type = 'BATCH_ANNOUNCEMENT';
      const data = {
        announcementTitle: 'Important Update',
        announcementContent: 'Class schedule changed',
        batchName: 'React Course'
      };

      // Mock successful notification sending
      jest.spyOn(notificationService, 'sendNotification').mockResolvedValue(true);

      const results = await notificationService.sendBulkNotification(userIds, type, data);

      expect(results).toEqual([true, true, true]);
      expect(notificationService.sendNotification).toHaveBeenCalledTimes(3);
      expect(notificationService.sendNotification).toHaveBeenCalledWith('user1', type, data, {});
      expect(notificationService.sendNotification).toHaveBeenCalledWith('user2', type, data, {});
      expect(notificationService.sendNotification).toHaveBeenCalledWith('user3', type, data, {});
    });

    it('should handle partial failures in bulk notifications', async () => {
      const userIds = ['user1', 'user2', 'user3'];
      const type = 'WELCOME';

      jest.spyOn(notificationService, 'sendNotification')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const results = await notificationService.sendBulkNotification(userIds, type, {});

      expect(results).toEqual([true, false, true]);
    });
  });

  describe('getUserNotifications', () => {
    it('should retrieve user notifications with pagination', async () => {
      const userId = 'user123';
      const mockNotifications = [
        {
          id: 'notif1',
          data: () => ({
            title: 'Welcome',
            body: 'Welcome to the platform',
            read: false,
            createdAt: 'timestamp1'
          })
        },
        {
          id: 'notif2',
          data: () => ({
            title: 'Payment Success',
            body: 'Payment processed',
            read: true,
            createdAt: 'timestamp2'
          })
        }
      ];

      mockGet.mockResolvedValue({
        docs: mockNotifications,
        size: 2
      });

      const result = await notificationService.getUserNotifications(userId, {
        limit: 10,
        unreadOnly: false
      });

      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0]).toEqual({
        id: 'notif1',
        title: 'Welcome',
        body: 'Welcome to the platform',
        read: false,
        createdAt: 'timestamp1'
      });
      expect(firestore.collection).toHaveBeenCalledWith('notifications');
    });

    it('should filter unread notifications only', async () => {
      const userId = 'user123';

      await notificationService.getUserNotifications(userId, {
        unreadOnly: true
      });

      expect(mockWhere).toHaveBeenCalledWith('userId', '==', userId);
      expect(mockWhere).toHaveBeenCalledWith('read', '==', false);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const notificationId = 'notif123';
      const userId = 'user123';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ userId: 'user123', read: false })
      });

      mockUpdate.mockResolvedValue();

      const result = await notificationService.markAsRead(notificationId, userId);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        read: true,
        readAt: 'mocked-timestamp'
      });
    });

    it('should handle notification not found', async () => {
      const notificationId = 'nonexistent';
      const userId = 'user123';

      mockGet.mockResolvedValue({
        exists: false
      });

      const result = await notificationService.markAsRead(notificationId, userId);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle unauthorized access', async () => {
      const notificationId = 'notif123';
      const userId = 'user123';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ userId: 'different-user', read: false })
      });

      const result = await notificationService.markAsRead(notificationId, userId);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all user notifications as read', async () => {
      const userId = 'user123';
      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue()
      };

      // Mock firestore batch
      admin.firestore = jest.fn(() => ({
        batch: () => mockBatch
      }));

      const mockUnreadNotifications = [
        { id: 'notif1', ref: 'ref1' },
        { id: 'notif2', ref: 'ref2' }
      ];

      mockGet.mockResolvedValue({
        docs: mockUnreadNotifications
      });

      const result = await notificationService.markAllAsRead(userId);

      expect(result).toBe(true);
      expect(mockBatch.update).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      const userId = 'user123';

      mockGet.mockResolvedValue({
        size: 5
      });

      const count = await notificationService.getUnreadCount(userId);

      expect(count).toBe(5);
      expect(mockWhere).toHaveBeenCalledWith('userId', '==', userId);
      expect(mockWhere).toHaveBeenCalledWith('read', '==', false);
    });

    it('should handle database error', async () => {
      const userId = 'user123';

      mockGet.mockRejectedValue(new Error('Database connection failed'));

      const count = await notificationService.getUnreadCount(userId);

      expect(count).toBe(0);
    });
  });

  describe('FCM Token Management', () => {
    it('should store FCM token successfully', async () => {
      const userId = 'user123';
      const token = 'fcm-token-123';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fcmTokens: [] })
      });

      mockUpdate.mockResolvedValue();

      const result = await notificationService.storeFCMToken(userId, token);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        fcmTokens: [token],
        lastTokenUpdate: 'mocked-timestamp'
      });
    });

    it('should handle duplicate token storage', async () => {
      const userId = 'user123';
      const token = 'existing-token';

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fcmTokens: ['existing-token'] })
      });

      const result = await notificationService.storeFCMToken(userId, token);

      expect(result).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled(); // Should not update if token already exists
    });

    it('should remove FCM token successfully', async () => {
      const token = 'token-to-remove';

      // Mock query to find users with this token
      mockGet.mockResolvedValue({
        docs: [{
          id: 'user123',
          data: () => ({ fcmTokens: ['token-to-remove', 'other-token'] }),
          ref: { update: mockUpdate }
        }]
      });

      mockUpdate.mockResolvedValue();

      const result = await notificationService.removeFCMToken(token);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        fcmTokens: ['other-token']
      });
    });
  });

  describe('Topic Subscriptions', () => {
    it('should subscribe user to topics', async () => {
      const userId = 'user123';
      const topics = ['batch-updates', 'announcements'];

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fcmTokens: ['token123'] })
      });

      fcmService.subscribeToTopic.mockResolvedValue(true);

      const result = await notificationService.subscribeToTopics(userId, topics);

      expect(result).toBe(true);
      expect(fcmService.subscribeToTopic).toHaveBeenCalledTimes(2);
      expect(fcmService.subscribeToTopic).toHaveBeenCalledWith(['token123'], 'batch-updates');
      expect(fcmService.subscribeToTopic).toHaveBeenCalledWith(['token123'], 'announcements');
    });

    it('should unsubscribe user from topics', async () => {
      const userId = 'user123';
      const topics = ['old-batch'];

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ fcmTokens: ['token123'] })
      });

      fcmService.unsubscribeFromTopic.mockResolvedValue(true);

      const result = await notificationService.unsubscribeFromTopics(userId, topics);

      expect(result).toBe(true);
      expect(fcmService.unsubscribeFromTopic).toHaveBeenCalledWith(['token123'], 'old-batch');
    });

    it('should send topic notification', async () => {
      const topic = 'batch-updates';
      const type = 'BATCH_ANNOUNCEMENT';
      const data = { announcementTitle: 'New Update' };

      fcmService.sendToTopic.mockResolvedValue(true);

      const result = await notificationService.sendTopicNotification(topic, type, data);

      expect(result).toBe(true);
      expect(fcmService.sendToTopic).toHaveBeenCalledWith(
        topic,
        expect.objectContaining({
          title: 'New Announcement',
          body: expect.stringContaining('New Update')
        })
      );
    });
  });

  describe('Template Processing', () => {
    it('should replace template variables correctly', () => {
      const template = 'Hello {{name}}, your order {{orderId}} is ready!';
      const data = { name: 'John', orderId: '12345' };

      const result = notificationService.replaceTemplateVars(template, data);

      expect(result).toBe('Hello John, your order 12345 is ready!');
    });

    it('should handle missing template variables', () => {
      const template = 'Hello {{name}}, your {{missing}} variable!';
      const data = { name: 'John' };

      const result = notificationService.replaceTemplateVars(template, data);

      expect(result).toBe('Hello John, your {{missing}} variable!');
    });
  });

  describe('Live Stream Notifications', () => {
    it('should notify when live stream starts', async () => {
      const batchId = 'batch123';
      const streamData = {
        title: 'React Fundamentals',
        streamUrl: 'https://stream.example.com/123'
      };

      // Mock batch document
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          name: 'React Course',
          enrolledStudents: ['student1', 'student2']
        })
      });

      jest.spyOn(notificationService, 'sendBulkNotification').mockResolvedValue([true, true]);

      const result = await notificationService.notifyLiveStreamStarted(batchId, streamData);

      expect(result).toBe(true);
      expect(notificationService.sendBulkNotification).toHaveBeenCalledWith(
        ['student1', 'student2'],
        'LIVE_STREAM_STARTED',
        expect.objectContaining({
          batchName: 'React Course',
          streamTitle: 'React Fundamentals'
        })
      );
    });

    it('should handle batch not found for live stream', async () => {
      const batchId = 'nonexistent';
      const streamData = { title: 'Test Stream' };

      mockGet.mockResolvedValue({
        exists: false
      });

      const result = await notificationService.notifyLiveStreamStarted(batchId, streamData);

      expect(result).toBe(false);
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup old notifications', async () => {
      const daysOld = 30;
      const mockBatch = {
        delete: jest.fn(),
        commit: jest.fn().mockResolvedValue()
      };

      admin.firestore = jest.fn(() => ({
        batch: () => mockBatch
      }));

      const mockOldNotifications = [
        { id: 'old1', ref: 'ref1' },
        { id: 'old2', ref: 'ref2' }
      ];

      mockGet.mockResolvedValue({
        docs: mockOldNotifications
      });

      const result = await notificationService.cleanupOldNotifications(daysOld);

      expect(result).toBe(true);
      expect(mockBatch.delete).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });
});