const { firestore } = require('../config/firebase');
const contentService = require('./contentService');
const announcementService = require('./announcementService');
const analyticsService = require('./analyticsService');

class DashboardService {
  constructor() {
    this.db = firestore;
  }

  /**
   * Get comprehensive dashboard data for a user
   * Similar to pw-extractor's dashboard functionality
   */
  async getDashboardData(userId) {
    try {
      const [userProfile, enrolledBatches, recentActivity, announcements, progressStats] = await Promise.all([
        this.getUserProfile(userId),
        this.getEnrolledBatches(userId),
        this.getRecentActivity(userId),
        this.getRecentAnnouncements(userId),
        this.getProgressStatistics(userId)
      ]);

      return {
        success: true,
        data: {
          userProfile,
          enrolledBatches,
          recentActivity,
          announcements,
          progressStats,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Get user profile information
   */
  async getUserProfile(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      
      return {
        uid: userId,
        name: userData.name || userData.displayName,
        email: userData.email,
        role: userData.role,
        profilePicture: userData.profilePicture || userData.photoURL,
        joinedAt: userData.createdAt,
        lastLoginAt: userData.lastLoginAt,
        preferences: userData.preferences || {}
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  /**
   * Get enrolled batches with progress information
   * Similar to pw-extractor's batch fetching
   */
  async getEnrolledBatches(userId) {
    try {
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('studentId', '==', userId)
        .where('status', '==', 'active')
        .get();

      if (enrollmentsSnapshot.empty) {
        return [];
      }

      const batchesData = [];
      
      for (const enrollmentDoc of enrollmentsSnapshot.docs) {
        const enrollmentData = enrollmentDoc.data();
        
        // Get batch details
        const batchDoc = await this.db.collection('batches').doc(enrollmentData.batchId).get();
        
        if (batchDoc.exists) {
          const batchData = batchDoc.data();
          
          // Get progress for this batch
          const progress = await this.getBatchProgress(userId, enrollmentData.batchId);
          
          batchesData.push({
            batchId: enrollmentData.batchId,
            batchName: batchData.name,
            description: batchData.description,
            thumbnail: batchData.thumbnail,
            enrolledAt: enrollmentData.enrolledAt,
            expiryDate: enrollmentData.expiryDate,
            progress: progress,
            subjects: batchData.subjects || [],
            totalSubjects: batchData.subjects ? batchData.subjects.length : 0,
            isActive: new Date() < new Date(enrollmentData.expiryDate)
          });
        }
      }

      return batchesData;
    } catch (error) {
      console.error('Error fetching enrolled batches:', error);
      return [];
    }
  }

  /**
   * Get batch progress for a user
   */
  async getBatchProgress(userId, batchId) {
    try {
      // Get total content count for the batch
      const totalContent = await contentService.getContentCountByBatch(batchId);
      
      // Get user's progress
      const progressSnapshot = await this.db.collection('user_progress')
        .where('userId', '==', userId)
        .where('batchId', '==', batchId)
        .get();

      let completedVideos = 0;
      let completedNotes = 0;
      let completedQuizzes = 0;
      let totalWatchTime = 0;

      progressSnapshot.docs.forEach(doc => {
        const progressData = doc.data();
        
        if (progressData.contentType === 'video' && progressData.completed) {
          completedVideos++;
          totalWatchTime += progressData.watchTime || 0;
        } else if (progressData.contentType === 'notes' && progressData.completed) {
          completedNotes++;
        } else if (progressData.contentType === 'quiz' && progressData.completed) {
          completedQuizzes++;
        }
      });

      const totalCompleted = completedVideos + completedNotes + completedQuizzes;
      const totalItems = (totalContent.videos || 0) + (totalContent.notes || 0) + (totalContent.quizzes || 0);
      const completionPercentage = totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0;

      return {
        completionPercentage,
        completedVideos,
        completedNotes,
        completedQuizzes,
        totalVideos: totalContent.videos || 0,
        totalNotes: totalContent.notes || 0,
        totalQuizzes: totalContent.quizzes || 0,
        totalWatchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        lastActivity: this.getLastActivityDate(progressSnapshot.docs)
      };
    } catch (error) {
      console.error('Error fetching batch progress:', error);
      return {
        completionPercentage: 0,
        completedVideos: 0,
        completedNotes: 0,
        completedQuizzes: 0,
        totalVideos: 0,
        totalNotes: 0,
        totalQuizzes: 0,
        totalWatchTime: 0,
        lastActivity: null
      };
    }
  }

  /**
   * Get recent activity for dashboard
   */
  async getRecentActivity(userId, limit = 10) {
    try {
      const activitiesSnapshot = await this.db.collection('user_activities')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const activities = [];
      
      activitiesSnapshot.docs.forEach(doc => {
        const activityData = doc.data();
        
        activities.push({
          id: doc.id,
          type: activityData.type,
          action: activityData.action,
          contentTitle: activityData.contentTitle,
          batchName: activityData.batchName,
          subjectName: activityData.subjectName,
          timestamp: activityData.timestamp,
          metadata: activityData.metadata || {}
        });
      });

      return activities;
    } catch (error) {
      console.error('Error fetching recent activity:', error);
      return [];
    }
  }

  /**
   * Get recent announcements for dashboard
   */
  async getRecentAnnouncements(userId, limit = 5) {
    try {
      const announcementsResult = await announcementService.fetchUserAnnouncements(userId, 1, limit);
      
      if (announcementsResult.success) {
        return announcementsResult.announcements.map(ann => ({
          id: ann._id,
          message: ann.announcement,
          batchName: ann.batchName,
          scheduleTime: ann.scheduleTime,
          priority: ann.priority,
          hasAttachment: !!ann.attachment
        }));
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching recent announcements:', error);
      return [];
    }
  }

  /**
   * Get progress statistics for dashboard
   */
  async getProgressStatistics(userId) {
    try {
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get weekly progress
      const weeklyProgressSnapshot = await this.db.collection('user_activities')
        .where('userId', '==', userId)
        .where('timestamp', '>=', startOfWeek)
        .get();

      // Get monthly progress
      const monthlyProgressSnapshot = await this.db.collection('user_activities')
        .where('userId', '==', userId)
        .where('timestamp', '>=', startOfMonth)
        .get();

      // Calculate statistics
      const weeklyStats = this.calculateActivityStats(weeklyProgressSnapshot.docs);
      const monthlyStats = this.calculateActivityStats(monthlyProgressSnapshot.docs);

      // Get streak information
      const streak = await this.calculateLearningStreak(userId);

      return {
        weekly: weeklyStats,
        monthly: monthlyStats,
        streak: streak,
        totalActivities: monthlyProgressSnapshot.size
      };
    } catch (error) {
      console.error('Error fetching progress statistics:', error);
      return {
        weekly: { videos: 0, notes: 0, quizzes: 0, totalTime: 0 },
        monthly: { videos: 0, notes: 0, quizzes: 0, totalTime: 0 },
        streak: { current: 0, longest: 0 },
        totalActivities: 0
      };
    }
  }

  /**
   * Calculate activity statistics from activity documents
   */
  calculateActivityStats(activityDocs) {
    let videos = 0;
    let notes = 0;
    let quizzes = 0;
    let totalTime = 0;

    activityDocs.forEach(doc => {
      const data = doc.data();
      
      switch (data.type) {
        case 'video_watched':
          videos++;
          totalTime += data.metadata?.watchTime || 0;
          break;
        case 'notes_viewed':
          notes++;
          break;
        case 'quiz_completed':
          quizzes++;
          break;
      }
    });

    return {
      videos,
      notes,
      quizzes,
      totalTime: Math.round(totalTime / 60) // Convert to minutes
    };
  }

  /**
   * Calculate learning streak
   */
  async calculateLearningStreak(userId) {
    try {
      // Get all activity dates for the user
      const activitiesSnapshot = await this.db.collection('user_activities')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .get();

      if (activitiesSnapshot.empty) {
        return { current: 0, longest: 0 };
      }

      // Extract unique dates
      const activityDates = new Set();
      activitiesSnapshot.docs.forEach(doc => {
        const timestamp = doc.data().timestamp.toDate();
        const dateString = timestamp.toISOString().split('T')[0];
        activityDates.add(dateString);
      });

      const sortedDates = Array.from(activityDates).sort().reverse();
      
      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;
      
      const today = new Date().toISOString().split('T')[0];
      let expectedDate = new Date();

      // Calculate current streak
      for (let i = 0; i < sortedDates.length; i++) {
        const currentDate = sortedDates[i];
        const expectedDateString = expectedDate.toISOString().split('T')[0];
        
        if (currentDate === expectedDateString) {
          currentStreak++;
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else {
          break;
        }
      }

      // Calculate longest streak
      for (let i = 0; i < sortedDates.length - 1; i++) {
        const currentDate = new Date(sortedDates[i]);
        const nextDate = new Date(sortedDates[i + 1]);
        const dayDifference = (currentDate - nextDate) / (1000 * 60 * 60 * 24);
        
        if (dayDifference === 1) {
          tempStreak++;
        } else {
          longestStreak = Math.max(longestStreak, tempStreak + 1);
          tempStreak = 0;
        }
      }
      
      longestStreak = Math.max(longestStreak, tempStreak + 1, currentStreak);

      return {
        current: currentStreak,
        longest: longestStreak
      };
    } catch (error) {
      console.error('Error calculating learning streak:', error);
      return { current: 0, longest: 0 };
    }
  }

  /**
   * Get last activity date from progress documents
   */
  getLastActivityDate(progressDocs) {
    if (progressDocs.length === 0) return null;
    
    let latestDate = null;
    
    progressDocs.forEach(doc => {
      const data = doc.data();
      const updatedAt = data.updatedAt || data.completedAt;
      
      if (updatedAt && (!latestDate || updatedAt.toDate() > latestDate)) {
        latestDate = updatedAt.toDate();
      }
    });
    
    return latestDate;
  }

  /**
   * Log user activity for dashboard tracking
   */
  async logActivity(userId, activityData) {
    try {
      const activity = {
        userId: userId,
        type: activityData.type,
        action: activityData.action,
        contentId: activityData.contentId,
        contentTitle: activityData.contentTitle,
        batchId: activityData.batchId,
        batchName: activityData.batchName,
        subjectId: activityData.subjectId,
        subjectName: activityData.subjectName,
        timestamp: new Date(),
        metadata: activityData.metadata || {}
      };

      await this.db.collection('user_activities').add(activity);
      
      return {
        success: true,
        message: 'Activity logged successfully'
      };
    } catch (error) {
      console.error('Error logging activity:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Get dashboard summary for quick overview
   */
  async getDashboardSummary(userId) {
    try {
      const [enrolledBatches, unreadAnnouncements, todayActivity] = await Promise.all([
        this.getEnrolledBatches(userId),
        announcementService.getUnreadAnnouncementsCount(userId),
        this.getTodayActivity(userId)
      ]);

      const totalProgress = enrolledBatches.reduce((sum, batch) => 
        sum + batch.progress.completionPercentage, 0
      );
      const averageProgress = enrolledBatches.length > 0 ? 
        Math.round(totalProgress / enrolledBatches.length) : 0;

      return {
        success: true,
        summary: {
          totalBatches: enrolledBatches.length,
          averageProgress: averageProgress,
          unreadAnnouncements: unreadAnnouncements.success ? unreadAnnouncements.unreadCount : 0,
          todayActivities: todayActivity.length,
          activeBatches: enrolledBatches.filter(batch => batch.isActive).length
        }
      };
    } catch (error) {
      console.error('Error fetching dashboard summary:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Get today's activity
   */
  async getTodayActivity(userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const activitiesSnapshot = await this.db.collection('user_activities')
        .where('userId', '==', userId)
        .where('timestamp', '>=', today)
        .where('timestamp', '<', tomorrow)
        .get();

      return activitiesSnapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('Error fetching today activity:', error);
      return [];
    }
  }
}

module.exports = new DashboardService();