const admin = require('firebase-admin');
const { db } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * FCM Service for handling push notifications
 */
class FCMService {
  constructor() {
    this.messaging = admin.messaging();
    this.tokensCollection = db.collection('fcm_tokens');
    this.notificationsCollection = db.collection('notifications');
  }

  /**
   * Register a new FCM token for a user
   * @param {string} userId - User ID
   * @param {string} token - FCM token
   * @param {string} deviceType - Device type (web, android, ios)
   * @param {string} userAgent - User agent string
   * @returns {Promise<boolean>} Success status
   */
  async registerToken(userId, token, deviceType = 'web', userAgent = '') {
    try {
      const tokenDoc = {
        userId,
        token,
        deviceType,
        userAgent,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true
      };

      // Check if token already exists
      const existingToken = await this.tokensCollection
        .where('token', '==', token)
        .limit(1)
        .get();

      if (!existingToken.empty) {
        // Update existing token
        const docId = existingToken.docs[0].id;
        await this.tokensCollection.doc(docId).update({
          userId,
          deviceType,
          userAgent,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          isActive: true
        });
        logger.info(`FCM token updated for user ${userId}`);
      } else {
        // Create new token document
        await this.tokensCollection.add(tokenDoc);
        logger.info(`FCM token registered for user ${userId}`);
      }

      return true;
    } catch (error) {
      logger.error('Error registering FCM token:', error);
      return false;
    }
  }

  /**
   * Unregister an FCM token
   * @param {string} token - FCM token to unregister
   * @returns {Promise<boolean>} Success status
   */
  async unregisterToken(token) {
    try {
      const tokenQuery = await this.tokensCollection
        .where('token', '==', token)
        .get();

      if (!tokenQuery.empty) {
        const batch = db.batch();
        tokenQuery.docs.forEach(doc => {
          batch.update(doc.ref, { 
            isActive: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        logger.info(`FCM token unregistered: ${token}`);
      }

      return true;
    } catch (error) {
      logger.error('Error unregistering FCM token:', error);
      return false;
    }
  }

  /**
   * Get all active tokens for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of active tokens
   */
  async getUserTokens(userId) {
    try {
      const tokensQuery = await this.tokensCollection
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get();

      return tokensQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      logger.error('Error getting user tokens:', error);
      return [];
    }
  }

  /**
   * Send notification to a single user
   * @param {string} userId - Target user ID
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Notification options
   * @returns {Promise<Object>} Send result
   */
  async sendToUser(userId, notification, data = {}, options = {}) {
    try {
      const userTokens = await this.getUserTokens(userId);
      
      if (userTokens.length === 0) {
        logger.warn(`No active FCM tokens found for user ${userId}`);
        return {
          success: false,
          error: 'No active tokens found',
          results: []
        };
      }

      const tokens = userTokens.map(tokenDoc => tokenDoc.token);
      return await this.sendToTokens(tokens, notification, data, options);
    } catch (error) {
      logger.error('Error sending notification to user:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Send notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Notification options
   * @returns {Promise<Object>} Send result
   */
  async sendToUsers(userIds, notification, data = {}, options = {}) {
    try {
      const allTokens = [];
      
      for (const userId of userIds) {
        const userTokens = await this.getUserTokens(userId);
        allTokens.push(...userTokens.map(tokenDoc => tokenDoc.token));
      }

      if (allTokens.length === 0) {
        logger.warn('No active FCM tokens found for any users');
        return {
          success: false,
          error: 'No active tokens found',
          results: []
        };
      }

      return await this.sendToTokens(allTokens, notification, data, options);
    } catch (error) {
      logger.error('Error sending notification to users:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Send notification to specific tokens
   * @param {Array<string>} tokens - Array of FCM tokens
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Notification options
   * @returns {Promise<Object>} Send result
   */
  async sendToTokens(tokens, notification, data = {}, options = {}) {
    try {
      if (!tokens || tokens.length === 0) {
        return {
          success: false,
          error: 'No tokens provided',
          results: []
        };
      }

      // Prepare the message
      const message = {
        notification: {
          title: notification.title || 'New Notification',
          body: notification.body || '',
          imageUrl: notification.imageUrl || undefined
        },
        data: {
          ...data,
          timestamp: Date.now().toString(),
          notificationId: data.notificationId || this.generateNotificationId()
        },
        android: {
          notification: {
            icon: notification.icon || 'ic_notification',
            color: notification.color || '#007bff',
            sound: notification.sound || 'default',
            channelId: notification.channelId || 'default',
            priority: options.priority || 'high',
            visibility: options.visibility || 'public'
          },
          data: data
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body
              },
              badge: options.badge || 1,
              sound: notification.sound || 'default',
              'content-available': 1
            }
          },
          fcm_options: {
            image: notification.imageUrl
          }
        },
        webpush: {
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/icons/icon-192x192.png',
            badge: notification.badge || '/icons/badge-72x72.png',
            image: notification.imageUrl,
            tag: notification.tag || 'default',
            requireInteraction: options.requireInteraction || false,
            silent: options.silent || false,
            vibrate: options.vibrate || [200, 100, 200],
            actions: notification.actions || [
              {
                action: 'view',
                title: 'View',
                icon: '/icons/view-icon.png'
              },
              {
                action: 'dismiss',
                title: 'Dismiss',
                icon: '/icons/dismiss-icon.png'
              }
            ]
          },
          data: data,
          fcm_options: {
            link: data.url || '/'
          }
        }
      };

      // Send to multiple tokens (batch send)
      if (tokens.length === 1) {
        message.token = tokens[0];
        const response = await this.messaging.send(message);
        
        // Store notification in database
        await this.storeNotification({
          tokens: tokens,
          notification,
          data,
          messageId: response,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'sent'
        });

        return {
          success: true,
          results: [{ messageId: response, success: true }],
          successCount: 1,
          failureCount: 0
        };
      } else {
        // For multiple tokens, use sendMulticast
        message.tokens = tokens;
        const response = await this.messaging.sendMulticast(message);
        
        // Process results and handle failed tokens
        const results = response.responses.map((resp, index) => ({
          token: tokens[index],
          messageId: resp.messageId,
          success: resp.success,
          error: resp.error
        }));

        // Remove invalid tokens
        const failedTokens = results
          .filter(result => !result.success && this.isInvalidToken(result.error))
          .map(result => result.token);

        if (failedTokens.length > 0) {
          await this.removeInvalidTokens(failedTokens);
        }

        // Store notification in database
        await this.storeNotification({
          tokens: tokens,
          notification,
          data,
          results: results,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          status: response.successCount > 0 ? 'sent' : 'failed',
          successCount: response.successCount,
          failureCount: response.failureCount
        });

        return {
          success: response.successCount > 0,
          results: results,
          successCount: response.successCount,
          failureCount: response.failureCount
        };
      }
    } catch (error) {
      logger.error('Error sending FCM notification:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Send notification to a topic
   * @param {string} topic - Topic name
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Notification options
   * @returns {Promise<Object>} Send result
   */
  async sendToTopic(topic, notification, data = {}, options = {}) {
    try {
      const message = {
        topic: topic,
        notification: {
          title: notification.title || 'New Notification',
          body: notification.body || ''
        },
        data: {
          ...data,
          timestamp: Date.now().toString(),
          notificationId: data.notificationId || this.generateNotificationId()
        }
      };

      const response = await this.messaging.send(message);
      
      // Store notification in database
      await this.storeNotification({
        topic: topic,
        notification,
        data,
        messageId: response,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
      });

      return {
        success: true,
        messageId: response
      };
    } catch (error) {
      logger.error('Error sending topic notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Subscribe users to a topic
   * @param {Array<string>} tokens - FCM tokens
   * @param {string} topic - Topic name
   * @returns {Promise<Object>} Subscription result
   */
  async subscribeToTopic(tokens, topic) {
    try {
      const response = await this.messaging.subscribeToTopic(tokens, topic);
      logger.info(`Subscribed ${response.successCount} tokens to topic ${topic}`);
      
      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors
      };
    } catch (error) {
      logger.error('Error subscribing to topic:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Unsubscribe users from a topic
   * @param {Array<string>} tokens - FCM tokens
   * @param {string} topic - Topic name
   * @returns {Promise<Object>} Unsubscription result
   */
  async unsubscribeFromTopic(tokens, topic) {
    try {
      const response = await this.messaging.unsubscribeFromTopic(tokens, topic);
      logger.info(`Unsubscribed ${response.successCount} tokens from topic ${topic}`);
      
      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors
      };
    } catch (error) {
      logger.error('Error unsubscribing from topic:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Store notification in database for tracking
   * @param {Object} notificationData - Notification data to store
   * @returns {Promise<string>} Document ID
   */
  async storeNotification(notificationData) {
    try {
      const docRef = await this.notificationsCollection.add(notificationData);
      return docRef.id;
    } catch (error) {
      logger.error('Error storing notification:', error);
      return null;
    }
  }

  /**
   * Remove invalid tokens from database
   * @param {Array<string>} tokens - Invalid tokens to remove
   * @returns {Promise<void>}
   */
  async removeInvalidTokens(tokens) {
    try {
      const batch = db.batch();
      
      for (const token of tokens) {
        const tokenQuery = await this.tokensCollection
          .where('token', '==', token)
          .get();
        
        tokenQuery.docs.forEach(doc => {
          batch.update(doc.ref, { 
            isActive: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            invalidatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      }
      
      await batch.commit();
      logger.info(`Removed ${tokens.length} invalid FCM tokens`);
    } catch (error) {
      logger.error('Error removing invalid tokens:', error);
    }
  }

  /**
   * Check if error indicates an invalid token
   * @param {Object} error - FCM error object
   * @returns {boolean} True if token is invalid
   */
  isInvalidToken(error) {
    if (!error) return false;
    
    const invalidErrorCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument'
    ];
    
    return invalidErrorCodes.includes(error.code);
  }

  /**
   * Generate unique notification ID
   * @returns {string} Unique notification ID
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get notification statistics
   * @param {string} userId - User ID (optional)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} Notification statistics
   */
  async getNotificationStats(userId = null, days = 30) {
    try {
      const startDate = admin.firestore.Timestamp.fromDate(new Date());
      startDate.toDate().setDate(startDate.toDate().getDate() - days);

      let query = this.notificationsCollection
        .where('sentAt', '>=', admin.firestore.Timestamp.fromDate(startDate));

      if (userId) {
        query = query.where('userId', '==', userId);
      }

      const notifications = await query.get();
      
      const stats = {
        totalSent: 0,
        totalSuccess: 0,
        totalFailure: 0,
        byStatus: {},
        byDay: {}
      };

      notifications.docs.forEach(doc => {
        const data = doc.data();
        stats.totalSent++;
        
        if (data.status === 'sent') {
          stats.totalSuccess++;
        } else {
          stats.totalFailure++;
        }

        // Count by status
        stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;

        // Count by day
        const day = data.sentAt.toDate().toISOString().split('T')[0];
        stats.byDay[day] = (stats.byDay[day] || 0) + 1;
      });

      return stats;
    } catch (error) {
      logger.error('Error getting notification stats:', error);
      return null;
    }
  }

  /**
   * Clean up old notifications and inactive tokens
   * @param {number} days - Days to keep (default: 90)
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanup(days = 90) {
    try {
      const cutoffDate = admin.firestore.Timestamp.fromDate(new Date());
      cutoffDate.toDate().setDate(cutoffDate.toDate().getDate() - daysOld);
      const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

      // Clean up old notifications
      const oldNotifications = await this.notificationsCollection
        .where('sentAt', '<', cutoffTimestamp)
        .get();

      // Clean up inactive tokens
      const inactiveTokens = await this.tokensCollection
        .where('isActive', '==', false)
        .where('updatedAt', '<', cutoffTimestamp)
        .get();

      const batch = db.batch();
      
      oldNotifications.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      inactiveTokens.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      return {
        success: true,
        deletedNotifications: oldNotifications.size,
        deletedTokens: inactiveTokens.size
      };
    } catch (error) {
      logger.error('Error during cleanup:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new FCMService();