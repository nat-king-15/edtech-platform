const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');

/**
 * Video Progress Service
 * Handles video progress tracking for students
 */
class VideoProgressService {
  /**
   * Update video progress for a student
   * @param {string} studentId - Student's user ID
   * @param {string} videoId - Video ID
   * @param {string} batchId - Batch ID
   * @param {string} subjectId - Subject ID
   * @param {number} currentTime - Current playback time in seconds
   * @param {number} duration - Total video duration in seconds
   * @param {boolean} completed - Whether video is completed
   * @returns {Promise<Object>} Updated progress data
   */
  async updateProgress(studentId, videoId, batchId, subjectId, currentTime, duration, completed = false) {
    try {
      const progressId = `${studentId}_${videoId}`;
      const progressRef = firestore.collection('videoProgress').doc(progressId);
      
      const progressData = {
        studentId,
        videoId,
        batchId,
        subjectId,
        currentTime: Math.max(0, currentTime),
        duration: Math.max(0, duration),
        progressPercentage: duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0,
        completed: completed || (duration > 0 && currentTime >= duration * 0.95), // 95% completion threshold
        lastWatched: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      // Check if document exists
      const existingDoc = await progressRef.get();
      if (!existingDoc.exists) {
        progressData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      
      await progressRef.set(progressData, { merge: true });
      
      return {
        success: true,
        data: {
          progressId,
          ...progressData,
          lastWatched: admin.firestore.Timestamp.fromDate(new Date()),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date())
        }
      };
    } catch (error) {
      console.error('Error updating video progress:', error);
      throw new Error('Failed to update video progress');
    }
  }
  
  /**
   * Get video progress for a student
   * @param {string} studentId - Student's user ID
   * @param {string} videoId - Video ID (optional)
   * @param {string} batchId - Batch ID (optional)
   * @returns {Promise<Object>} Progress data
   */
  async getProgress(studentId, videoId = null, batchId = null) {
    try {
      let query = firestore.collection('videoProgress')
        .where('studentId', '==', studentId);
      
      if (videoId) {
        query = query.where('videoId', '==', videoId);
      }
      
      if (batchId) {
        query = query.where('batchId', '==', batchId);
      }
      
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        return {
          success: true,
          data: [],
          message: 'No progress found'
        };
      }
      
      const progressData = [];
      snapshot.forEach(doc => {
        progressData.push({
          id: doc.id,
          ...doc.data(),
          lastWatched: doc.data().lastWatched?.toDate(),
          createdAt: doc.data().createdAt?.toDate(),
          updatedAt: doc.data().updatedAt?.toDate()
        });
      });
      
      return {
        success: true,
        data: progressData
      };
    } catch (error) {
      console.error('Error fetching video progress:', error);
      throw new Error('Failed to fetch video progress');
    }
  }
  
  /**
   * Get batch progress summary for a student
   * @param {string} studentId - Student's user ID
   * @param {string} batchId - Batch ID
   * @returns {Promise<Object>} Progress summary
   */
  async getBatchProgressSummary(studentId, batchId) {
    try {
      const progressSnapshot = await firestore.collection('videoProgress')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .get();
      
      let totalVideos = 0;
      let completedVideos = 0;
      let totalWatchTime = 0;
      let totalDuration = 0;
      
      progressSnapshot.forEach(doc => {
        const data = doc.data();
        totalVideos++;
        if (data.completed) {
          completedVideos++;
        }
        totalWatchTime += data.currentTime || 0;
        totalDuration += data.duration || 0;
      });
      
      const completionPercentage = totalVideos > 0 ? (completedVideos / totalVideos) * 100 : 0;
      const overallProgress = totalDuration > 0 ? (totalWatchTime / totalDuration) * 100 : 0;
      
      return {
        success: true,
        data: {
          batchId,
          studentId,
          totalVideos,
          completedVideos,
          completionPercentage: Math.round(completionPercentage * 100) / 100,
          overallProgress: Math.round(overallProgress * 100) / 100,
          totalWatchTime: Math.round(totalWatchTime),
          totalDuration: Math.round(totalDuration)
        }
      };
    } catch (error) {
      console.error('Error fetching batch progress summary:', error);
      throw new Error('Failed to fetch batch progress summary');
    }
  }
  
  /**
   * Mark video as completed
   * @param {string} studentId - Student's user ID
   * @param {string} videoId - Video ID
   * @returns {Promise<Object>} Updated progress data
   */
  async markVideoCompleted(studentId, videoId) {
    try {
      const progressId = `${studentId}_${videoId}`;
      const progressRef = firestore.collection('videoProgress').doc(progressId);
      
      const progressDoc = await progressRef.get();
      if (!progressDoc.exists) {
        throw new Error('Video progress not found');
      }
      
      const progressData = progressDoc.data();
      const updatedData = {
        completed: true,
        currentTime: progressData.duration || progressData.currentTime,
        progressPercentage: 100,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await progressRef.update(updatedData);
      
      return {
        success: true,
        data: {
          progressId,
          ...progressData,
          ...updatedData,
          completedAt: admin.firestore.Timestamp.fromDate(new Date()),
          updatedAt: admin.firestore.Timestamp.fromDate(new Date())
        }
      };
    } catch (error) {
      console.error('Error marking video as completed:', error);
      throw new Error('Failed to mark video as completed');
    }
  }
  
  /**
   * Get video progress analytics for teachers/admins
   * @param {string} batchId - Batch ID
   * @param {string} videoId - Video ID (optional)
   * @returns {Promise<Object>} Analytics data
   */
  async getVideoAnalytics(batchId, videoId = null) {
    try {
      let query = firestore.collection('videoProgress')
        .where('batchId', '==', batchId);
      
      if (videoId) {
        query = query.where('videoId', '==', videoId);
      }
      
      const snapshot = await query.get();
      
      const analytics = {
        totalStudents: 0,
        studentsWatched: 0,
        studentsCompleted: 0,
        averageProgress: 0,
        averageWatchTime: 0,
        videoStats: {}
      };
      
      const studentProgress = new Map();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const studentId = data.studentId;
        
        if (!studentProgress.has(studentId)) {
          studentProgress.set(studentId, {
            totalProgress: 0,
            totalWatchTime: 0,
            videosWatched: 0,
            videosCompleted: 0
          });
        }
        
        const student = studentProgress.get(studentId);
        student.totalProgress += data.progressPercentage || 0;
        student.totalWatchTime += data.currentTime || 0;
        student.videosWatched++;
        
        if (data.completed) {
          student.videosCompleted++;
        }
        
        // Video-specific stats
        const vId = data.videoId;
        if (!analytics.videoStats[vId]) {
          analytics.videoStats[vId] = {
            totalViews: 0,
            completions: 0,
            averageProgress: 0,
            totalWatchTime: 0
          };
        }
        
        analytics.videoStats[vId].totalViews++;
        analytics.videoStats[vId].totalWatchTime += data.currentTime || 0;
        
        if (data.completed) {
          analytics.videoStats[vId].completions++;
        }
      });
      
      // Calculate aggregated analytics
      analytics.totalStudents = studentProgress.size;
      analytics.studentsWatched = studentProgress.size;
      
      let totalProgress = 0;
      let totalWatchTime = 0;
      let completedStudents = 0;
      
      studentProgress.forEach(student => {
        const avgProgress = student.videosWatched > 0 ? student.totalProgress / student.videosWatched : 0;
        totalProgress += avgProgress;
        totalWatchTime += student.totalWatchTime;
        
        if (student.videosCompleted > 0) {
          completedStudents++;
        }
      });
      
      analytics.studentsCompleted = completedStudents;
      analytics.averageProgress = analytics.totalStudents > 0 ? totalProgress / analytics.totalStudents : 0;
      analytics.averageWatchTime = analytics.totalStudents > 0 ? totalWatchTime / analytics.totalStudents : 0;
      
      // Calculate video-specific averages
      Object.keys(analytics.videoStats).forEach(vId => {
        const stats = analytics.videoStats[vId];
        stats.averageProgress = stats.totalViews > 0 ? (stats.completions / stats.totalViews) * 100 : 0;
      });
      
      return {
        success: true,
        data: analytics
      };
    } catch (error) {
      console.error('Error fetching video analytics:', error);
      throw new Error('Failed to fetch video analytics');
    }
  }
}

module.exports = new VideoProgressService();