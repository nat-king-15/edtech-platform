const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');
const emailService = require('../utils/emailService');

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
      WELCOME: 'welcome'
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
      const { sendEmail = true, sendInApp = true } = options;
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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };

          const notificationRef = await firestore.collection('notifications').add(notificationData);
          results.inApp = { success: true, notificationId: notificationRef.id };
        } catch (inAppError) {
          console.error('In-app notification failed:', inAppError);
          results.inApp = { success: false, error: inAppError.message };
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
    const results = [];
    const batchSize = 10; // Process in batches to avoid overwhelming the system

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const batchPromises = batch.map(userId => 
        this.sendNotification(userId, type, data, options)
          .catch(error => ({ userId, error: error.message }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
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
  async cleanupOldNotifications(daysOld = 30) {
    try {
      const cutoffDate = new Date();
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
}

module.exports = new NotificationService();