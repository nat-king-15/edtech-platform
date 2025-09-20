const admin = require('firebase-admin');
const { firestore } = require('../config/firebase');

/**
 * Firebase Cloud Messaging Service
 * Handles push notifications to mobile and web clients
 */
class FCMService {
  constructor() {
    this.messaging = admin.messaging();
  }

  /**
   * Send push notification to a single device
   * @param {string} token - FCM device token
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   * @param {Object} options - Additional options
   */
  async sendToDevice(token, notification, data = {}, options = {}) {
    try {
      const message = {
        token,
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.icon && { icon: notification.icon }),
          ...(notification.image && { image: notification.image })
        },
        data: {
          ...data,
          timestamp: Date.now().toString(),
          click_action: data.click_action || 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          notification: {
            sound: 'default',
            priority: 'high',
            channelId: 'edtech_notifications'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        webpush: {
          notification: {
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            requireInteraction: true,
            actions: [
              {
                action: 'view',
                title: 'View',
                icon: '/icons/view-icon.png'
              }
            ]
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('FCM message sent successfully:', response);
      
      return {
        success: true,
        messageId: response,
        token
      };
    } catch (error) {
      console.error('FCM send error:', error);
      
      // Handle invalid token
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        await this.removeInvalidToken(token);
      }
      
      return {
        success: false,
        error: error.message,
        code: error.code,
        token
      };
    }
  }

  /**
   * Send push notification to multiple devices
   * @param {Array} tokens - Array of FCM device tokens
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   */
  async sendToMultipleDevices(tokens, notification, data = {}) {
    try {
      if (!tokens || tokens.length === 0) {
        return { success: false, error: 'No tokens provided' };
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.icon && { icon: notification.icon })
        },
        data: {
          ...data,
          timestamp: Date.now().toString()
        },
        tokens
      };

      const response = await this.messaging.sendMulticast(message);
      
      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
            console.error(`Failed to send to token ${tokens[idx]}:`, resp.error);
          }
        });
        
        // Remove invalid tokens
        await this.removeInvalidTokens(failedTokens);
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses
      };
    } catch (error) {
      console.error('FCM multicast send error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send notification to a topic
   * @param {string} topic - Topic name
   * @param {Object} notification - Notification payload
   * @param {Object} data - Additional data payload
   */
  async sendToTopic(topic, notification, data = {}) {
    try {
      const message = {
        topic,
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.icon && { icon: notification.icon })
        },
        data: {
          ...data,
          timestamp: Date.now().toString()
        }
      };

      const response = await this.messaging.send(message);
      console.log('FCM topic message sent successfully:', response);
      
      return {
        success: true,
        messageId: response
      };
    } catch (error) {
      console.error('FCM topic send error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Subscribe tokens to a topic
   * @param {Array} tokens - Array of FCM tokens
   * @param {string} topic - Topic name
   */
  async subscribeToTopic(tokens, topic) {
    try {
      const response = await this.messaging.subscribeToTopic(tokens, topic);
      console.log('Successfully subscribed to topic:', response);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };
    } catch (error) {
      console.error('FCM topic subscription error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Unsubscribe tokens from a topic
   * @param {Array} tokens - Array of FCM tokens
   * @param {string} topic - Topic name
   */
  async unsubscribeFromTopic(tokens, topic) {
    try {
      const response = await this.messaging.unsubscribeFromTopic(tokens, topic);
      console.log('Successfully unsubscribed from topic:', response);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };
    } catch (error) {
      console.error('FCM topic unsubscription error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Store FCM token for a user
   * @param {string} userId - User ID
   * @param {string} token - FCM token
   * @param {string} deviceType - Device type (web, android, ios)
   */
  async storeUserToken(userId, token, deviceType = 'web') {
    try {
      const tokenData = {
        userId,
        token,
        deviceType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        active: true
      };

      // Check if token already exists
      const existingToken = await firestore
        .collection('fcm_tokens')
        .where('token', '==', token)
        .get();

      if (!existingToken.empty) {
        // Update existing token
        const docId = existingToken.docs[0].id;
        await firestore.collection('fcm_tokens').doc(docId).update({
          userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          active: true
        });
      } else {
        // Create new token document
        await firestore.collection('fcm_tokens').add(tokenData);
      }

      return { success: true };
    } catch (error) {
      console.error('Error storing FCM token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all active tokens for a user
   * @param {string} userId - User ID
   */
  async getUserTokens(userId) {
    try {
      const snapshot = await firestore
        .collection('fcm_tokens')
        .where('userId', '==', userId)
        .where('active', '==', true)
        .get();

      const tokens = [];
      snapshot.forEach(doc => {
        tokens.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return { success: true, tokens };
    } catch (error) {
      console.error('Error getting user tokens:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove invalid token from database
   * @param {string} token - Invalid FCM token
   */
  async removeInvalidToken(token) {
    try {
      const snapshot = await firestore
        .collection('fcm_tokens')
        .where('token', '==', token)
        .get();

      const batch = firestore.batch();
      snapshot.forEach(doc => {
        batch.update(doc.ref, { active: false });
      });

      await batch.commit();
      console.log('Removed invalid token:', token);
    } catch (error) {
      console.error('Error removing invalid token:', error);
    }
  }

  /**
   * Remove multiple invalid tokens
   * @param {Array} tokens - Array of invalid tokens
   */
  async removeInvalidTokens(tokens) {
    try {
      const batch = firestore.batch();
      
      for (const token of tokens) {
        const snapshot = await firestore
          .collection('fcm_tokens')
          .where('token', '==', token)
          .get();

        snapshot.forEach(doc => {
          batch.update(doc.ref, { active: false });
        });
      }

      await batch.commit();
      console.log('Removed invalid tokens:', tokens.length);
    } catch (error) {
      console.error('Error removing invalid tokens:', error);
    }
  }

  /**
   * Clean up old inactive tokens
   * @param {number} daysOld - Remove tokens older than this many days
   */
  async cleanupOldTokens(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const snapshot = await firestore
        .collection('fcm_tokens')
        .where('active', '==', false)
        .where('updatedAt', '<', cutoffDate)
        .get();

      const batch = firestore.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Cleaned up ${snapshot.size} old FCM tokens`);
      
      return { success: true, deletedCount: snapshot.size };
    } catch (error) {
      console.error('Error cleaning up old tokens:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new FCMService();