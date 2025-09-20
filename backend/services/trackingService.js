const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');
const dashboardService = require('./dashboardService');
const fs = require('fs').promises;
const path = require('path');

class TrackingService {
  constructor() {
    this.db = firestore;
    this.trackingDataDir = path.join(__dirname, '../data/tracking');
  }

  /**
   * Track video progress
   * Similar to pw-extractor's video tracking functionality
   */
  async trackVideoProgress(userId, videoData) {
    try {
      const progressData = {
        userId: userId,
        contentId: videoData.videoId,
        contentType: 'video',
        batchId: videoData.batchId,
        subjectId: videoData.subjectId,
        topicId: videoData.topicId,
        currentTime: videoData.currentTime || 0,
        duration: videoData.duration || 0,
        watchTime: videoData.watchTime || 0,
        completed: videoData.completed || false,
        completionPercentage: videoData.completionPercentage || 0,
        lastWatched: admin.firestore.Timestamp.fromDate(new Date()),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      // Update or create progress record
      const progressId = `${userId}_${videoData.videoId}`;
      await this.db.collection('user_progress').doc(progressId).set(progressData, { merge: true });

      // Log activity for dashboard
      await dashboardService.logActivity(userId, {
        type: 'video_watched',
        action: videoData.completed ? 'completed' : 'progress_updated',
        contentId: videoData.videoId,
        contentTitle: videoData.title,
        batchId: videoData.batchId,
        batchName: videoData.batchName,
        subjectId: videoData.subjectId,
        subjectName: videoData.subjectName,
        metadata: {
          watchTime: videoData.watchTime,
          completionPercentage: videoData.completionPercentage,
          currentTime: videoData.currentTime
        }
      });

      // Save tracking data to file (similar to pw-extractor)
      await this.saveTrackingData(userId, 'video', {
        videoId: videoData.videoId,
        title: videoData.title,
        watchTime: videoData.watchTime,
        completed: videoData.completed,
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });

      return {
        success: true,
        message: 'Video progress tracked successfully',
        progressData: progressData
      };
    } catch (error) {
      console.error('Error tracking video progress:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Track notes/document access
   * Similar to pw-extractor's notes tracking
   */
  async trackNotesAccess(userId, notesData) {
    try {
      const progressData = {
        userId: userId,
        contentId: notesData.notesId,
        contentType: 'notes',
        batchId: notesData.batchId,
        subjectId: notesData.subjectId,
        topicId: notesData.topicId,
        accessCount: (notesData.accessCount || 0) + 1,
        timeSpent: notesData.timeSpent || 0,
        completed: notesData.completed || false,
        lastAccessed: admin.firestore.Timestamp.fromDate(new Date()),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      // Update or create progress record
      const progressId = `${userId}_${notesData.notesId}`;
      const existingDoc = await this.db.collection('user_progress').doc(progressId).get();
      
      if (existingDoc.exists) {
        const existingData = existingDoc.data();
        progressData.accessCount = (existingData.accessCount || 0) + 1;
        progressData.timeSpent = (existingData.timeSpent || 0) + (notesData.timeSpent || 0);
      }

      await this.db.collection('user_progress').doc(progressId).set(progressData, { merge: true });

      // Log activity for dashboard
      await dashboardService.logActivity(userId, {
        type: 'notes_viewed',
        action: notesData.completed ? 'completed' : 'accessed',
        contentId: notesData.notesId,
        contentTitle: notesData.title,
        batchId: notesData.batchId,
        batchName: notesData.batchName,
        subjectId: notesData.subjectId,
        subjectName: notesData.subjectName,
        metadata: {
          accessCount: progressData.accessCount,
          timeSpent: progressData.timeSpent
        }
      });

      // Save tracking data to file
      await this.saveTrackingData(userId, 'notes', {
        notesId: notesData.notesId,
        title: notesData.title,
        accessCount: progressData.accessCount,
        timeSpent: progressData.timeSpent,
        completed: notesData.completed,
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });

      return {
        success: true,
        message: 'Notes access tracked successfully',
        progressData: progressData
      };
    } catch (error) {
      console.error('Error tracking notes access:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Track quiz attempts and results
   * Similar to pw-extractor's quiz tracking
   */
  async trackQuizAttempt(userId, quizData) {
    try {
      const attemptData = {
        userId: userId,
        quizId: quizData.quizId,
        batchId: quizData.batchId,
        subjectId: quizData.subjectId,
        topicId: quizData.topicId,
        attemptNumber: quizData.attemptNumber || 1,
        score: quizData.score || 0,
        maxScore: quizData.maxScore || 0,
        percentage: quizData.percentage || 0,
        timeSpent: quizData.timeSpent || 0,
        completed: quizData.completed || false,
        answers: quizData.answers || [],
        startedAt: quizData.startedAt || admin.firestore.Timestamp.fromDate(new Date()),
        completedAt: quizData.completed ? admin.firestore.Timestamp.fromDate(new Date()) : null,
        createdAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      // Save quiz attempt
      const attemptRef = await this.db.collection('quiz_attempts').add(attemptData);

      // Update user progress
      const progressData = {
        userId: userId,
        contentId: quizData.quizId,
        contentType: 'quiz',
        batchId: quizData.batchId,
        subjectId: quizData.subjectId,
        topicId: quizData.topicId,
        bestScore: quizData.score,
        bestPercentage: quizData.percentage,
        totalAttempts: quizData.attemptNumber,
        completed: quizData.completed,
        lastAttempted: admin.firestore.Timestamp.fromDate(new Date()),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const progressId = `${userId}_${quizData.quizId}`;
      const existingProgress = await this.db.collection('user_progress').doc(progressId).get();
      
      if (existingProgress.exists) {
        const existingData = existingProgress.data();
        progressData.bestScore = Math.max(existingData.bestScore || 0, quizData.score);
        progressData.bestPercentage = Math.max(existingData.bestPercentage || 0, quizData.percentage);
        progressData.totalAttempts = (existingData.totalAttempts || 0) + 1;
      }

      await this.db.collection('user_progress').doc(progressId).set(progressData, { merge: true });

      // Log activity for dashboard
      await dashboardService.logActivity(userId, {
        type: 'quiz_completed',
        action: 'attempted',
        contentId: quizData.quizId,
        contentTitle: quizData.title,
        batchId: quizData.batchId,
        batchName: quizData.batchName,
        subjectId: quizData.subjectId,
        subjectName: quizData.subjectName,
        metadata: {
          score: quizData.score,
          percentage: quizData.percentage,
          attemptNumber: progressData.totalAttempts,
          timeSpent: quizData.timeSpent
        }
      });

      // Save tracking data to file
      await this.saveTrackingData(userId, 'quiz', {
        quizId: quizData.quizId,
        title: quizData.title,
        score: quizData.score,
        percentage: quizData.percentage,
        attemptNumber: progressData.totalAttempts,
        completed: quizData.completed,
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });

      return {
        success: true,
        message: 'Quiz attempt tracked successfully',
        attemptId: attemptRef.id,
        progressData: progressData
      };
    } catch (error) {
      console.error('Error tracking quiz attempt:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Track assignment submissions
   */
  async trackAssignmentSubmission(userId, assignmentData) {
    try {
      const submissionData = {
        userId: userId,
        assignmentId: assignmentData.assignmentId,
        batchId: assignmentData.batchId,
        subjectId: assignmentData.subjectId,
        submissionFile: assignmentData.submissionFile,
        submissionText: assignmentData.submissionText,
        submittedAt: admin.firestore.Timestamp.fromDate(new Date()),
        status: 'submitted',
        score: assignmentData.score || null,
        feedback: assignmentData.feedback || null,
        gradedAt: assignmentData.gradedAt || null,
        gradedBy: assignmentData.gradedBy || null
      };

      // Save assignment submission
      const submissionRef = await this.db.collection('assignment_submissions').add(submissionData);

      // Update user progress
      const progressData = {
        userId: userId,
        contentId: assignmentData.assignmentId,
        contentType: 'assignment',
        batchId: assignmentData.batchId,
        subjectId: assignmentData.subjectId,
        submitted: true,
        submittedAt: admin.firestore.Timestamp.fromDate(new Date()),
        score: assignmentData.score,
        completed: !!assignmentData.score,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const progressId = `${userId}_${assignmentData.assignmentId}`;
      await this.db.collection('user_progress').doc(progressId).set(progressData, { merge: true });

      // Log activity for dashboard
      await dashboardService.logActivity(userId, {
        type: 'assignment_submitted',
        action: 'submitted',
        contentId: assignmentData.assignmentId,
        contentTitle: assignmentData.title,
        batchId: assignmentData.batchId,
        batchName: assignmentData.batchName,
        subjectId: assignmentData.subjectId,
        subjectName: assignmentData.subjectName,
        metadata: {
          submissionType: assignmentData.submissionFile ? 'file' : 'text',
          hasFile: !!assignmentData.submissionFile
        }
      });

      return {
        success: true,
        message: 'Assignment submission tracked successfully',
        submissionId: submissionRef.id,
        progressData: progressData
      };
    } catch (error) {
      console.error('Error tracking assignment submission:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Save tracking data to local file
   * Similar to pw-extractor's file-based tracking
   */
  async saveTrackingData(userId, contentType, data) {
    try {
      // Ensure tracking directory exists
      await fs.mkdir(this.trackingDataDir, { recursive: true });
      
      const fileName = `${userId}_${contentType}_tracking.json`;
      const filePath = path.join(this.trackingDataDir, fileName);
      
      let trackingData = [];
      
      // Load existing tracking data
      try {
        const existingData = await fs.readFile(filePath, 'utf8');
        trackingData = JSON.parse(existingData);
      } catch (error) {
        // File doesn't exist or is corrupted, start with empty array
        trackingData = [];
      }
      
      // Add new tracking entry
      trackingData.push(data);
      
      // Keep only last 1000 entries to prevent file from growing too large
      if (trackingData.length > 1000) {
        trackingData = trackingData.slice(-1000);
      }
      
      // Save updated tracking data
      await fs.writeFile(filePath, JSON.stringify(trackingData, null, 2), 'utf8');
      
    } catch (error) {
      console.error('Error saving tracking data to file:', error);
    }
  }

  /**
   * Load tracking data from file
   * Similar to pw-extractor's data loading
   */
  async loadTrackingData(userId, contentType) {
    try {
      const fileName = `${userId}_${contentType}_tracking.json`;
      const filePath = path.join(this.trackingDataDir, fileName);
      
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading tracking data from file:', error);
      return [];
    }
  }

  /**
   * Get user's overall progress statistics
   */
  async getUserProgressStats(userId) {
    try {
      const progressSnapshot = await this.db.collection('user_progress')
        .where('userId', '==', userId)
        .get();

      const stats = {
        totalContent: progressSnapshot.size,
        completedContent: 0,
        videoStats: { total: 0, completed: 0, totalWatchTime: 0 },
        notesStats: { total: 0, completed: 0, totalAccessTime: 0 },
        quizStats: { total: 0, completed: 0, averageScore: 0 },
        assignmentStats: { total: 0, submitted: 0, graded: 0 }
      };

      let totalQuizScore = 0;
      let quizCount = 0;

      progressSnapshot.docs.forEach(doc => {
        const data = doc.data();
        
        if (data.completed) {
          stats.completedContent++;
        }

        switch (data.contentType) {
          case 'video':
            stats.videoStats.total++;
            if (data.completed) stats.videoStats.completed++;
            stats.videoStats.totalWatchTime += data.watchTime || 0;
            break;
            
          case 'notes':
            stats.notesStats.total++;
            if (data.completed) stats.notesStats.completed++;
            stats.notesStats.totalAccessTime += data.timeSpent || 0;
            break;
            
          case 'quiz':
            stats.quizStats.total++;
            if (data.completed) stats.quizStats.completed++;
            if (data.bestScore) {
              totalQuizScore += data.bestScore;
              quizCount++;
            }
            break;
            
          case 'assignment':
            stats.assignmentStats.total++;
            if (data.submitted) stats.assignmentStats.submitted++;
            if (data.score !== null) stats.assignmentStats.graded++;
            break;
        }
      });

      stats.quizStats.averageScore = quizCount > 0 ? Math.round(totalQuizScore / quizCount) : 0;
      stats.overallCompletionPercentage = stats.totalContent > 0 ? 
        Math.round((stats.completedContent / stats.totalContent) * 100) : 0;

      return {
        success: true,
        stats: stats
      };
    } catch (error) {
      console.error('Error getting user progress stats:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Get progress for specific content
   */
  async getContentProgress(userId, contentId) {
    try {
      const progressId = `${userId}_${contentId}`;
      const progressDoc = await this.db.collection('user_progress').doc(progressId).get();
      
      if (!progressDoc.exists) {
        return {
          success: true,
          progress: null,
          message: 'No progress found for this content'
        };
      }

      return {
        success: true,
        progress: progressDoc.data()
      };
    } catch (error) {
      console.error('Error getting content progress:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Export user tracking data
   * Similar to pw-extractor's data export functionality
   */
  async exportUserTrackingData(userId) {
    try {
      const [videoData, notesData, quizData] = await Promise.all([
        this.loadTrackingData(userId, 'video'),
        this.loadTrackingData(userId, 'notes'),
        this.loadTrackingData(userId, 'quiz')
      ]);

      const exportData = {
        userId: userId,
        exportedAt: admin.firestore.Timestamp.fromDate(new Date()),
        data: {
          videos: videoData,
          notes: notesData,
          quizzes: quizData
        }
      };

      return {
        success: true,
        exportData: exportData
      };
    } catch (error) {
      console.error('Error exporting user tracking data:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Clean up old tracking data
   */
  async cleanupOldTrackingData(daysOld = 90) {
    try {
      const cutoffDate = admin.firestore.Timestamp.fromDate(new Date());
      cutoffDate.toDate().setDate(cutoffDate.toDate().getDate() - daysOld);

      // Clean up old activities
      const oldActivitiesSnapshot = await this.db.collection('user_activities')
        .where('timestamp', '<', cutoffDate)
        .get();

      const batch = this.db.batch();
      oldActivitiesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      console.log(`Cleaned up ${oldActivitiesSnapshot.size} old activity records`);
      
      return {
        success: true,
        message: `Cleaned up ${oldActivitiesSnapshot.size} old records`,
        deletedCount: oldActivitiesSnapshot.size
      };
    } catch (error) {
      console.error('Error cleaning up old tracking data:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }
}

module.exports = new TrackingService();