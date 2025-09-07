const { firestore } = require('../config/firebase');
const notificationService = require('./notificationService');
const fs = require('fs').promises;
const path = require('path');

class AnnouncementService {
  constructor() {
    this.db = firestore;
    this.knownAnnouncementsFile = path.join(__dirname, '../data/known_announcements.json');
  }

  /**
   * Fetch announcements for a specific batch
   * Similar to pw-extractor's fetch_announcements function
   */
  async fetchBatchAnnouncements(batchId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const announcementsSnapshot = await this.db.collection('announcements')
        .where('batchId', '==', batchId)
        .orderBy('scheduleTime', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      if (announcementsSnapshot.empty) {
        return {
          success: true,
          announcements: [],
          message: 'No announcements found for this batch'
        };
      }

      const announcements = [];
      announcementsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        
        const announcementInfo = {
          announcement: data.message || data.content,
          _id: doc.id,
          scheduleTime: data.scheduleTime,
          createdAt: data.createdAt,
          priority: data.priority || 'normal',
          type: data.type || 'general',
          isRead: data.isRead || false
        };

        // Handle attachment
        const attachment = data.attachment;
        if (attachment) {
          announcementInfo.attachment = {
            name: attachment.name || attachment.filename,
            baseUrl: attachment.baseUrl || attachment.url,
            key: attachment.key || attachment.path,
            size: attachment.size || 0,
            type: attachment.type || attachment.mimeType
          };
        } else {
          announcementInfo.attachment = null;
        }

        announcements.push(announcementInfo);
      });

      return {
        success: true,
        announcements: announcements
      };
    } catch (error) {
      console.error('Error fetching batch announcements:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Fetch announcements for multiple batches (user's enrolled batches)
   * Similar to pw-extractor's batch fetching with announcements
   */
  async fetchUserAnnouncements(userId, page = 1, limit = 50) {
    try {
      // Get user's enrolled batches
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('studentId', '==', userId)
        .where('status', '==', 'active')
        .get();

      if (enrollmentsSnapshot.empty) {
        return {
          success: true,
          announcements: [],
          message: 'No enrolled batches found'
        };
      }

      const batchIds = enrollmentsSnapshot.docs.map(doc => doc.data().batchId);
      
      // Fetch announcements for all enrolled batches
      const allAnnouncements = [];
      
      // Process batches in chunks due to Firestore 'in' query limit (10 items)
      for (let i = 0; i < batchIds.length; i += 10) {
        const batchChunk = batchIds.slice(i, i + 10);
        
        const announcementsSnapshot = await this.db.collection('announcements')
          .where('batchId', 'in', batchChunk)
          .orderBy('scheduleTime', 'desc')
          .get();

        announcementsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          allAnnouncements.push({
            announcement: data.message || data.content,
            _id: doc.id,
            scheduleTime: data.scheduleTime,
            batchId: data.batchId,
            batchName: data.batchName,
            priority: data.priority || 'normal',
            type: data.type || 'general',
            attachment: data.attachment ? {
              name: data.attachment.name || data.attachment.filename,
              baseUrl: data.attachment.baseUrl || data.attachment.url,
              key: data.attachment.key || data.attachment.path
            } : null
          });
        });
      }

      // Sort by schedule time and apply pagination
      allAnnouncements.sort((a, b) => new Date(b.scheduleTime) - new Date(a.scheduleTime));
      const offset = (page - 1) * limit;
      const paginatedAnnouncements = allAnnouncements.slice(offset, offset + limit);

      return {
        success: true,
        announcements: paginatedAnnouncements
      };
    } catch (error) {
      console.error('Error fetching user announcements:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Load known announcement IDs from file
   * Similar to pw-extractor's load_known_ids function
   */
  async loadKnownIds(userId) {
    try {
      const filePath = path.join(__dirname, `../data/known_announcements_${userId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return new Set(JSON.parse(data));
    } catch (error) {
      // File doesn't exist or is corrupted, return empty set
      return new Set();
    }
  }

  /**
   * Save known announcement IDs to file
   * Similar to pw-extractor's save_known_ids function
   */
  async saveKnownIds(userId, knownIds) {
    try {
      const filePath = path.join(__dirname, `../data/known_announcements_${userId}.json`);
      
      // Ensure data directory exists
      const dataDir = path.dirname(filePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      await fs.writeFile(filePath, JSON.stringify(Array.from(knownIds)), 'utf8');
    } catch (error) {
      console.error('Error saving known announcement IDs:', error);
    }
  }

  /**
   * Get new announcements that haven't been seen before
   * Similar to pw-extractor's get_new_announcements function
   */
  async getNewAnnouncements(userId, fetchedAnnouncements) {
    try {
      const knownIds = await this.loadKnownIds(userId);
      
      const newAnnouncements = fetchedAnnouncements.filter(ann => 
        !knownIds.has(ann._id)
      );

      return newAnnouncements;
    } catch (error) {
      console.error('Error filtering new announcements:', error);
      return fetchedAnnouncements; // Return all if error occurs
    }
  }

  /**
   * Update known announcement IDs with new ones
   * Similar to pw-extractor's update_known_ids function
   */
  async updateKnownIds(userId, fetchedAnnouncements) {
    try {
      const knownIds = await this.loadKnownIds(userId);
      
      fetchedAnnouncements.forEach(ann => {
        knownIds.add(ann._id);
      });

      await this.saveKnownIds(userId, knownIds);
      return knownIds;
    } catch (error) {
      console.error('Error updating known announcement IDs:', error);
      return new Set();
    }
  }

  /**
   * Track new announcements and send notifications
   */
  async trackAndNotifyNewAnnouncements(userId) {
    try {
      // Fetch latest announcements
      const result = await this.fetchUserAnnouncements(userId, 1, 50);
      
      if (!result.success || result.announcements.length === 0) {
        return {
          success: true,
          newCount: 0,
          message: 'No announcements found'
        };
      }

      // Get new announcements
      const newAnnouncements = await this.getNewAnnouncements(userId, result.announcements);
      
      if (newAnnouncements.length > 0) {
        // Update known IDs
        await this.updateKnownIds(userId, result.announcements);
        
        // Send notifications for new announcements
        for (const announcement of newAnnouncements) {
          await this.sendAnnouncementNotification(userId, announcement);
        }
      }

      return {
        success: true,
        newCount: newAnnouncements.length,
        newAnnouncements: newAnnouncements
      };
    } catch (error) {
      console.error('Error tracking new announcements:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Send notification for new announcement
   */
  async sendAnnouncementNotification(userId, announcement) {
    try {
      // Get user details
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        return;
      }

      const userData = userDoc.data();
      
      // Prepare notification data
      const notificationData = {
        userId: userId,
        type: 'announcement',
        title: `New Announcement - ${announcement.batchName || 'Your Batch'}`,
        message: announcement.announcement.substring(0, 100) + (announcement.announcement.length > 100 ? '...' : ''),
        data: {
          announcementId: announcement._id,
          batchId: announcement.batchId,
          batchName: announcement.batchName,
          hasAttachment: !!announcement.attachment
        },
        priority: announcement.priority || 'normal'
      };

      // Send notification
      await notificationService.sendNotification(
        notificationService.notificationTypes.ANNOUNCEMENT,
        notificationData
      );

      console.log(`Notification sent for announcement ${announcement._id} to user ${userId}`);
    } catch (error) {
      console.error('Error sending announcement notification:', error);
    }
  }

  /**
   * Mark announcement as read
   */
  async markAnnouncementAsRead(userId, announcementId) {
    try {
      // Create or update read status in user_announcement_reads collection
      await this.db.collection('user_announcement_reads').doc(`${userId}_${announcementId}`).set({
        userId: userId,
        announcementId: announcementId,
        readAt: new Date(),
        isRead: true
      }, { merge: true });

      return {
        success: true,
        message: 'Announcement marked as read'
      };
    } catch (error) {
      console.error('Error marking announcement as read:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Get unread announcements count
   */
  async getUnreadAnnouncementsCount(userId) {
    try {
      // Get user's announcements
      const announcementsResult = await this.fetchUserAnnouncements(userId, 1, 100);
      
      if (!announcementsResult.success) {
        return {
          success: false,
          error_message: announcementsResult.error_message
        };
      }

      const allAnnouncementIds = announcementsResult.announcements.map(ann => ann._id);
      
      // Get read announcements
      const readSnapshot = await this.db.collection('user_announcement_reads')
        .where('userId', '==', userId)
        .where('announcementId', 'in', allAnnouncementIds.slice(0, 10)) // Firestore limit
        .get();

      const readAnnouncementIds = new Set(readSnapshot.docs.map(doc => doc.data().announcementId));
      const unreadCount = allAnnouncementIds.filter(id => !readAnnouncementIds.has(id)).length;

      return {
        success: true,
        unreadCount: unreadCount,
        totalCount: allAnnouncementIds.length
      };
    } catch (error) {
      console.error('Error getting unread announcements count:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Create new announcement (Admin/Teacher function)
   */
  async createAnnouncement(creatorId, announcementData) {
    try {
      const announcement = {
        ...announcementData,
        createdBy: creatorId,
        createdAt: new Date(),
        updatedAt: new Date(),
        scheduleTime: announcementData.scheduleTime || new Date(),
        priority: announcementData.priority || 'normal',
        type: announcementData.type || 'general'
      };

      const docRef = await this.db.collection('announcements').add(announcement);
      
      // Trigger notifications for enrolled students
      this.notifyBatchStudents(announcementData.batchId, {
        ...announcement,
        _id: docRef.id
      });

      return {
        success: true,
        announcementId: docRef.id,
        message: 'Announcement created successfully'
      };
    } catch (error) {
      console.error('Error creating announcement:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Notify all students in a batch about new announcement
   */
  async notifyBatchStudents(batchId, announcement) {
    try {
      // Get all enrolled students in the batch
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();

      const notificationPromises = enrollmentsSnapshot.docs.map(doc => {
        const enrollmentData = doc.data();
        return this.sendAnnouncementNotification(enrollmentData.studentId, announcement);
      });

      await Promise.all(notificationPromises);
      console.log(`Notifications sent to ${enrollmentsSnapshot.size} students for announcement ${announcement._id}`);
    } catch (error) {
      console.error('Error notifying batch students:', error);
    }
  }
}

module.exports = new AnnouncementService();