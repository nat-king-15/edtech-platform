const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');
const emailService = require('../utils/emailService');
const fcmService = require('../utils/fcmService');

/**
 * Notification Service
 * Handles both email and in-app notifications
 */
class NotificationService {
  constructor() {
    this.notificationTypes = {
      ENROLLMENT_SUCCESS: 'enrollment_success',
      PAYMENT_SUCCESS: 'payment_success',
      BATCH_ANNOUNCEMENT: 'batch_announcement',
      CONTENT_SCHEDULED: 'content_scheduled',
      BATCH_PUBLISHED: 'batch_published',
      ASSIGNMENT_DUE: 'assignment_due',
      WELCOME: 'welcome',
      LIVE_STREAM_STARTED: 'live_stream_started',
      LIVE_STREAM_ENDED: 'live_stream_ended',
      LIVE_STREAM_REMINDER: 'live_stream_reminder',
      RECORDING_AVAILABLE: 'recording_available'
    };

    this.templates = {
      [this.notificationTypes.ENROLLMENT_SUCCESS]: {
        email: {
          subject: 'Enrollment Successful - {{batchName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50;">🎉 Enrollment Successful!</h2>
              <p>Dear {{studentName}},</p>
              <p>Congratulations! You have successfully enrolled in <strong>{{batchName}}</strong>.</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>Batch Details:</h3>
                <p><strong>Batch:</strong> {{batchName}}</p>
                <p><strong>Course:</strong> {{courseName}}</p>
                <p><strong>Start Date:</strong> {{startDate}}</p>
                <p><strong>Amount Paid:</strong> ₹{{amount}}</p>
              </div>
              <p>You can now access your course content and start learning!</p>
              <p>Best regards,<br>EdTech Team</p>
            </div>
          `
        },
        inApp: {
          title: 'Enrollment Successful',
          body: 'You have successfully enrolled in {{batchName}}. Start learning now!',
          icon: '🎉'
        }
      },
      [this.notificationTypes.PAYMENT_SUCCESS]: {
        email: {
          subject: 'Payment Confirmation - {{batchName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50;">💳 Payment Successful!</h2>
              <p>Dear {{studentName}},</p>
              <p>Your payment has been successfully processed.</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>Payment Details:</h3>
                <p><strong>Amount:</strong> ₹{{amount}}</p>
                <p><strong>Payment ID:</strong> {{paymentId}}</p>
                <p><strong>Batch:</strong> {{batchName}}</p>
                <p><strong>Date:</strong> {{paymentDate}}</p>
              </div>
              <p>Your enrollment is now confirmed and you can access the course content.</p>
              <p>Best regards,<br>EdTech Team</p>
            </div>
          `
        },
        inApp: {
          title: 'Payment Successful',
          body: 'Payment of ₹{{amount}} for {{batchName}} has been processed successfully.',
          icon: '💳'
        }
      },
      [this.notificationTypes.BATCH_ANNOUNCEMENT]: {
        email: {
          subject: 'New Announcement - {{batchName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2196F3;">📢 New Announcement</h2>
              <p>Dear {{studentName}},</p>
              <p>There's a new announcement for your batch <strong>{{batchName}}</strong>:</p>
              <div style="background: #e3f2fd; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0;">
                <h3>{{announcementTitle}}</h3>
                <p>{{announcementContent}}</p>
              </div>
              <p>Stay updated with your course progress!</p>
              <p>Best regards,<br>EdTech Team</p>
            </div>
          `
        },
        inApp: {
          title: 'New Announcement',
          body: '{{announcementTitle}} - {{batchName}}',
          icon: '📢'
        }
      },
      [this.notificationTypes.CONTENT_SCHEDULED]: {
        email: {
          subject: 'New Content Available - {{batchName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #FF9800;">📚 New Content Available!</h2>
              <p>Dear {{studentName}},</p>
              <p>New content has been added to your batch <strong>{{batchName}}</strong>:</p>
              <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>{{contentTitle}}</h3>
                <p><strong>Subject:</strong> {{subjectName}}</p>
                <p><strong>Type:</strong> {{contentType}}</p>
                <p><strong>Available from:</strong> {{availableDate}}</p>
              </div>
              <p>Login to access your new content and continue learning!</p>
              <p>Best regards,<br>EdTech Team</p>
            </div>
          `
        },
        inApp: {
          title: 'New Content Available',
          body: '{{contentTitle}} is now available in {{batchName}}',
          icon: '📚'
        }
      },
      [this.notificationTypes.WELCOME]: {
        email: {
          subject: 'Welcome to EdTech Platform!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50;">🎓 Welcome to EdTech!</h2>
              <p>Dear {{userName}},</p>
              <p>Welcome to our learning platform! We're excited to have you join our community.</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>Getting Started:</h3>
                <ul>
                  <li>Browse available courses and batches</li>
                  <li>Enroll in courses that interest you</li>
                  <li>Access video content and materials</li>
                  <li>Track your learning progress</li>
                </ul>
              </div>
              <p>If you have any questions, feel free to reach out to our support team.</p>
              <p>Happy Learning!<br>EdTech Team</p>
            </div>
          `
        },
        inApp: {
          title: 'Welcome to EdTech!',
          body: 'Welcome {{userName}}! Start exploring courses and begin your learning journey.',
          icon: '🎓'
        }
      }
    };
  }

  /**
   * Send notification (both email and in-app)
   * @param {string} userId - User ID to send notification to
   * @param {string} type - Notification type
   * @param {Object} data - Template data
   * @param {Object} options - Additional options
   */
  async sendNotification(userId, type, data = {}, options = {}) {
    try {
      const { sendEmail = true, sendInApp = true, sendPush = true } = options;
      const results = {};

      // Get user details
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new Error('User not found');
      }
      const userData = userDoc.data();

      // Prepare template data
      const templateData = {
        userName: userData.name || userData.email,
        studentName: userData.name || userData.email,
        userEmail: userData.email,
        ...data
      };

      // Send email notification
      if (sendEmail && this.templates[type]?.email) {
        try {
          const emailTemplate = this.templates[type].email;
          const subject = this.replaceTemplateVars(emailTemplate.subject, templateData);
          const html = this.replaceTemplateVars(emailTemplate.html, templateData);

          await emailService.sendEmail({
            to: userData.email,
            subject,
            html
          });

          results.email = { success: true };
        } catch (emailError) {
          console.error('Email notification failed:', emailError);
          results.email = { success: false, error: emailError.message };
        }
      }

      // Send in-app notification
      if (sendInApp && this.templates[type]?.inApp) {
        try {
          const inAppTemplate = this.templates[type].inApp;
          const notificationData = {
            userId,
            type,
            title: this.replaceTemplateVars(inAppTemplate.title, templateData),
            body: this.replaceTemplateVars(inAppTemplate.body, templateData),
            icon: inAppTemplate.icon,
            data: templateData,
            read: false,
            createdAt: admin.firestore.Timestamp.fromDate(new Date()),
            updatedAt: admin.firestore.Timestamp.fromDate(new Date())
          };

          const notificationRef = await firestore.collection('notifications').add(notificationData);
          results.inApp = { success: true, notificationId: notificationRef.id };
        } catch (inAppError) {
          console.error('In-app notification failed:', inAppError);
          results.inApp = { success: false, error: inAppError.message };
        }
      }

      // Send push notification
      if (sendPush && this.templates[type]?.inApp) {
        try {
          const pushTemplate = this.templates[type].inApp;
          const pushNotification = {
            title: this.replaceTemplateVars(pushTemplate.title, templateData),
            body: this.replaceTemplateVars(pushTemplate.body, templateData),
            icon: pushTemplate.icon
          };

          // Get user's FCM tokens
          const tokensResult = await fcmService.getUserTokens(userId);
          if (tokensResult.success && tokensResult.tokens.length > 0) {
            const tokens = tokensResult.tokens.map(t => t.token);
            
            const pushResult = await fcmService.sendToMultipleDevices(
              tokens, 
              pushNotification, 
              {
                type,
                userId,
                ...templateData
              }
            );
            
            results.push = pushResult;
          } else {
            results.push = { success: false, error: 'No FCM tokens found for user' };
          }
        } catch (pushError) {
          console.error('Push notification failed:', pushError);
          results.push = { success: false, error: pushError.message };
        }
      }

      return results;
    } catch (error) {
      console.error('Notification service error:', error);
      throw error;
    }
  }

  /**
   * Send bulk notifications to multiple users
   * @param {Array} userIds - Array of user IDs
   * @param {string} type - Notification type
   * @param {Object} data - Template data
   * @param {Object} options - Additional options
   */
  async sendBulkNotification(userIds, type, data = {}, options = {}) {
    try {
      const { sendEmail = true, sendInApp = true, sendPush = true } = options;
      const results = [];

      for (const userId of userIds) {
        try {
          const result = await this.sendNotification(userId, type, data, { sendEmail, sendInApp, sendPush });
          results.push({ userId, success: true, result });
        } catch (error) {
          console.error(`Failed to send notification to user ${userId}:`, error);
          results.push({ userId, success: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      console.error('Bulk notification error:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const { limit = 20, offset = 0, unreadOnly = false } = options;
      
      let query = firestore.collection('notifications')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');

      if (unreadOnly) {
        query = query.where('read', '==', false);
      }

      if (offset > 0) {
        const offsetDoc = await firestore.collection('notifications')
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(offset)
          .get();
        
        if (!offsetDoc.empty) {
          const lastDoc = offsetDoc.docs[offsetDoc.docs.length - 1];
          query = query.startAfter(lastDoc);
        }
      }

      const snapshot = await query.limit(limit).get();
      const notifications = [];

      snapshot.forEach(doc => {
        notifications.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate()?.toISOString(),
          updatedAt: doc.data().updatedAt?.toDate()?.toISOString()
        });
      });

      return notifications;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for security)
   */
  async markAsRead(notificationId, userId) {
    try {
      const notificationRef = firestore.collection('notifications').doc(notificationId);
      const notificationDoc = await notificationRef.get();

      if (!notificationDoc.exists) {
        throw new Error('Notification not found');
      }

      const notificationData = notificationDoc.data();
      if (notificationData.userId !== userId) {
        throw new Error('Unauthorized access to notification');
      }

      await notificationRef.update({
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   */
  async markAllAsRead(userId) {
    try {
      const unreadNotifications = await firestore.collection('notifications')
        .where('userId', '==', userId)
        .where('read', '==', false)
        .get();

      const batch = firestore.batch();
      const updateTime = admin.firestore.FieldValue.serverTimestamp();

      unreadNotifications.forEach(doc => {
        batch.update(doc.ref, {
          read: true,
          readAt: updateTime,
          updatedAt: updateTime
        });
      });

      await batch.commit();
      return { success: true, updatedCount: unreadNotifications.size };
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count for a user
   * @param {string} userId - User ID
   */
  async getUnreadCount(userId) {
    try {
      const unreadSnapshot = await firestore.collection('notifications')
        .where('userId', '==', userId)
        .where('read', '==', false)
        .get();

      return unreadSnapshot.size;
    } catch (error) {
      console.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Replace template variables with actual data
   * @param {string} template - Template string
   * @param {Object} data - Data object
   */
  replaceTemplateVars(template, data) {
    return template.replace(/{{(\w+)}}/g, (match, key) => {
      return data[key] || match;
    });
  }

  /**
   * Delete old notifications (cleanup)
   * @param {number} daysOld - Delete notifications older than this many days
   */
  /**
   * Send live stream started notification to students
   * @param {string} batchId - Batch ID
   * @param {Object} streamData - Live stream data
   */
  async notifyLiveStreamStarted(batchId, streamData) {
    try {
      console.log(`Notifying students for batch ${batchId} about live stream: ${streamData.title}`);
      
      // Get all students enrolled in the batch
      const enrollmentsSnapshot = await firestore
        .collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();

      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().studentId);
      
      if (studentIds.length === 0) {
        console.log('No active students found for batch:', batchId);
        return;
      }

      // Send notifications to all students
      const notificationPromises = studentIds.map(studentId => 
        this.sendNotification({
          userId: studentId,
          type: this.notificationTypes.LIVE_STREAM_STARTED,
          title: 'Live Class Started!',
          message: `${streamData.title} is now live. Join now!`,
          data: {
            scheduleId: streamData.scheduleId,
            liveStreamId: streamData.liveStreamId,
            playbackIds: streamData.livePlaybackIds
          },
          priority: 'high'
        })
      );

      await Promise.all(notificationPromises);
      console.log(`Successfully notified ${studentIds.length} students about live stream start`);
    } catch (error) {
      console.error('Error notifying students about live stream start:', error);
    }
  }

  /**
   * Send live stream ended notification to students
   * @param {string} batchId - Batch ID
   * @param {Object} streamData - Live stream data
   */
  async notifyLiveStreamEnded(batchId, streamData) {
    try {
      console.log(`Notifying students for batch ${batchId} about live stream end: ${streamData.title}`);
      
      // Get all students enrolled in the batch
      const enrollmentsSnapshot = await firestore
        .collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();

      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().studentId);
      
      if (studentIds.length === 0) {
        console.log('No active students found for batch:', batchId);
        return;
      }

      // Send notifications to all students
      const notificationPromises = studentIds.map(studentId => 
        this.sendNotification({
          userId: studentId,
          type: this.notificationTypes.LIVE_STREAM_ENDED,
          title: 'Live Class Ended',
          message: `${streamData.title} has ended. Recording will be available soon.`,
          data: {
            scheduleId: streamData.scheduleId,
            recordingPlaybackId: streamData.recordingPlaybackId
          },
          priority: 'medium'
        })
      );

      await Promise.all(notificationPromises);
      console.log(`Successfully notified ${studentIds.length} students about live stream end`);
    } catch (error) {
      console.error('Error notifying students about live stream end:', error);
    }
  }

  /**
   * Send recording available notification to students
   * @param {string} batchId - Batch ID
   * @param {Object} streamData - Live stream data with recording
   */
  async notifyRecordingAvailable(batchId, streamData) {
    try {
      console.log(`Notifying students for batch ${batchId} about recording: ${streamData.title}`);
      
      // Get all students enrolled in the batch
      const enrollmentsSnapshot = await firestore
        .collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();

      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().studentId);
      
      if (studentIds.length === 0) {
        console.log('No active students found for batch:', batchId);
        return;
      }

      // Send notifications to all students
      const notificationPromises = studentIds.map(studentId => 
        this.sendNotification({
          userId: studentId,
          type: this.notificationTypes.RECORDING_AVAILABLE,
          title: 'Class Recording Available',
          message: `Recording of ${streamData.title} is now available to watch.`,
          data: {
            scheduleId: streamData.scheduleId,
            recordingPlaybackId: streamData.recordingPlaybackId,
            recordingAssetId: streamData.recordingAssetId
          },
          priority: 'low'
        })
      );

      await Promise.all(notificationPromises);
      console.log(`Successfully notified ${studentIds.length} students about recording availability`);
    } catch (error) {
      console.error('Error notifying students about recording availability:', error);
    }
  }

  /**
   * Send live stream reminder to students
   * @param {string} batchId - Batch ID
   * @param {Object} streamData - Live stream data
   * @param {number} minutesBefore - Minutes before the stream starts
   */
  async sendLiveStreamReminder(batchId, streamData, minutesBefore = 15) {
    try {
      console.log(`Sending ${minutesBefore}-minute reminder for: ${streamData.title}`);
      
      // Get all students enrolled in the batch
      const enrollmentsSnapshot = await firestore
        .collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();

      const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().studentId);
      
      if (studentIds.length === 0) {
        console.log('No active students found for batch:', batchId);
        return;
      }

      // Send notifications to all students
      const notificationPromises = studentIds.map(studentId => 
        this.sendNotification({
          userId: studentId,
          type: this.notificationTypes.LIVE_STREAM_REMINDER,
          title: `Live Class Starting in ${minutesBefore} Minutes`,
          message: `${streamData.title} will start soon. Get ready!`,
          data: {
            scheduleId: streamData.scheduleId,
            scheduledAt: streamData.scheduledAt
          },
          priority: 'high'
        })
      );

      await Promise.all(notificationPromises);
      console.log(`Successfully sent reminders to ${studentIds.length} students`);
    } catch (error) {
      console.error('Error sending live stream reminders:', error);
    }
  }

  async cleanupOldNotifications(daysOld = 30) {
    try {
      const cutoffDate = admin.firestore.Timestamp.fromDate(new Date());
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const oldNotifications = await firestore.collection('notifications')
        .where('createdAt', '<', cutoffDate)
        .get();

      const batch = firestore.batch();
      oldNotifications.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return { success: true, deletedCount: oldNotifications.size };
    } catch (error) {
      console.error('Error cleaning up notifications:', error);
      throw error;
    }
  }
  /**
   * Store FCM token for a user
   * @param {string} userId - User ID
   * @param {string} token - FCM token
   * @param {string} deviceType - Device type (web, android, ios)
   */
  async storeFCMToken(userId, token, deviceType = 'web') {
    try {
      return await fcmService.storeUserToken(userId, token, deviceType);
    } catch (error) {
      console.error('Error storing FCM token:', error);
      throw error;
    }
  }

  /**
   * Remove FCM token for a user
   * @param {string} token - FCM token to remove
   */
  async removeFCMToken(token) {
    try {
      return await fcmService.removeInvalidToken(token);
    } catch (error) {
      console.error('Error removing FCM token:', error);
      throw error;
    }
  }

  /**
   * Subscribe user to notification topics
   * @param {string} userId - User ID
   * @param {Array} topics - Array of topic names
   */
  async subscribeToTopics(userId, topics) {
    try {
      const tokensResult = await fcmService.getUserTokens(userId);
      if (!tokensResult.success || tokensResult.tokens.length === 0) {
        return { success: false, error: 'No FCM tokens found for user' };
      }

      const tokens = tokensResult.tokens.map(t => t.token);
      const results = [];

      for (const topic of topics) {
        const result = await fcmService.subscribeToTopic(tokens, topic);
        results.push({ topic, ...result });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Error subscribing to topics:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe user from notification topics
   * @param {string} userId - User ID
   * @param {Array} topics - Array of topic names
   */
  async unsubscribeFromTopics(userId, topics) {
    try {
      const tokensResult = await fcmService.getUserTokens(userId);
      if (!tokensResult.success || tokensResult.tokens.length === 0) {
        return { success: false, error: 'No FCM tokens found for user' };
      }

      const tokens = tokensResult.tokens.map(t => t.token);
      const results = [];

      for (const topic of topics) {
        const result = await fcmService.unsubscribeFromTopic(tokens, topic);
        results.push({ topic, ...result });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Error unsubscribing from topics:', error);
      throw error;
    }
  }

  /**
   * Send notification to a topic
   * @param {string} topic - Topic name
   * @param {string} type - Notification type
   * @param {Object} data - Template data
   */
  async sendTopicNotification(topic, type, data = {}) {
    try {
      if (!this.templates[type]?.inApp) {
        throw new Error(`No template found for notification type: ${type}`);
      }

      const template = this.templates[type].inApp;
      const notification = {
        title: this.replaceTemplateVars(template.title, data),
        body: this.replaceTemplateVars(template.body, data),
        icon: template.icon
      };

      return await fcmService.sendToTopic(topic, notification, {
        type,
        ...data
      });
    } catch (error) {
      console.error('Error sending topic notification:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();