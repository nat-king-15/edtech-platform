const { db } = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

class AnalyticsService {
  // Student Analytics
  async getStudentAnalytics(studentId, batchId, timeRange = '30d') {
    try {
      const startDate = this.getStartDate(timeRange);
      
      // Get student's course progress
      const progressData = await this.getStudentProgress(studentId, batchId, startDate);
      
      // Get assignment performance
      const assignmentData = await this.getStudentAssignments(studentId, batchId, startDate);
      
      // Get quiz performance
      const quizData = await this.getStudentQuizzes(studentId, batchId, startDate);
      
      // Get video watch time
      const videoData = await this.getStudentVideoProgress(studentId, batchId, startDate);
      
      // Get forum activity
      const forumData = await this.getStudentForumActivity(studentId, batchId, startDate);
      
      // Calculate overall metrics
      const overallMetrics = this.calculateStudentMetrics({
        progress: progressData,
        assignments: assignmentData,
        quizzes: quizData,
        videos: videoData,
        forum: forumData
      });
      
      return {
        overview: overallMetrics,
        progress: progressData,
        assignments: assignmentData,
        quizzes: quizData,
        videos: videoData,
        forum: forumData,
        timeRange,
        generatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };
    } catch (error) {
      console.error('Error getting student analytics:', error);
      throw error;
    }
  }
  
  // Teacher Analytics
  async getTeacherAnalytics(teacherId, batchIds = [], timeRange = '30d') {
    try {
      const startDate = this.getStartDate(timeRange);
      
      // Get batch performance overview
      const batchData = await this.getTeacherBatchAnalytics(teacherId, batchIds, startDate);
      
      // Get assignment analytics
      const assignmentData = await this.getTeacherAssignmentAnalytics(teacherId, batchIds, startDate);
      
      // Get quiz analytics
      const quizData = await this.getTeacherQuizAnalytics(teacherId, batchIds, startDate);
      
      // Get student engagement metrics
      const engagementData = await this.getStudentEngagementMetrics(batchIds, startDate);
      
      // Get content performance
      const contentData = await this.getContentPerformanceMetrics(batchIds, startDate);
      
      return {
        batches: batchData,
        assignments: assignmentData,
        quizzes: quizData,
        engagement: engagementData,
        content: contentData,
        timeRange,
        generatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };
    } catch (error) {
      console.error('Error getting teacher analytics:', error);
      throw error;
    }
  }
  
  // Admin Analytics
  async getAdminAnalytics(timeRange = '30d') {
    try {
      const startDate = this.getStartDate(timeRange);
      
      // Platform overview metrics
      const platformMetrics = await this.getPlatformMetrics(startDate);
      
      // User analytics
      const userMetrics = await this.getUserMetrics(startDate);
      
      // Course analytics
      const courseMetrics = await this.getCourseMetrics(startDate);
      
      // Revenue analytics
      const revenueMetrics = await this.getRevenueMetrics(startDate);
      
      // System performance
      const systemMetrics = await this.getSystemMetrics(startDate);
      
      return {
        platform: platformMetrics,
        users: userMetrics,
        courses: courseMetrics,
        revenue: revenueMetrics,
        system: systemMetrics,
        timeRange,
        generatedAt: admin.firestore.Timestamp.fromDate(new Date())
      };
    } catch (error) {
      console.error('Error getting admin analytics:', error);
      throw error;
    }
  }
  
  // Helper Methods
  getStartDate(timeRange) {
    const now = admin.firestore.Timestamp.fromDate(new Date());
    const ranges = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };
    
    const days = ranges[timeRange] || 30;
    const startDate = admin.firestore.Timestamp.fromDate(new Date());
    startDate.toDate().setTime(now.toDate().getTime() - (days * 24 * 60 * 60 * 1000));
    return startDate;
  }
  
  async getStudentProgress(studentId, batchId, startDate) {
    try {
      const progressRef = db.collection('progress')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('updatedAt', '>=', startDate.toDate());
      
      const progressSnapshot = await progressRef.get();
      const progressData = [];
      
      progressSnapshot.forEach(doc => {
        progressData.push({ id: doc.id, ...doc.data() });
      });
      
      // Calculate progress metrics
      const totalLessons = progressData.length;
      const completedLessons = progressData.filter(p => p.completed).length;
      const averageProgress = progressData.reduce((sum, p) => sum + (p.progress || 0), 0) / totalLessons || 0;
      
      return {
        totalLessons,
        completedLessons,
        completionRate: totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0,
        averageProgress: Math.round(averageProgress * 100) / 100,
        progressData: progressData.slice(0, 10) // Latest 10 for chart
      };
    } catch (error) {
      console.error('Error getting student progress:', error);
      return { totalLessons: 0, completedLessons: 0, completionRate: 0, averageProgress: 0, progressData: [] };
    }
  }
  
  async getStudentAssignments(studentId, batchId, startDate) {
    try {
      const submissionsRef = db.collection('assignmentSubmissions')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('submittedAt', '>=', startDate.toDate());
      
      const submissionsSnapshot = await submissionsRef.get();
      const submissions = [];
      
      submissionsSnapshot.forEach(doc => {
        submissions.push({ id: doc.id, ...doc.data() });
      });
      
      const totalSubmissions = submissions.length;
      const gradedSubmissions = submissions.filter(s => s.grade !== undefined);
      const averageGrade = gradedSubmissions.length > 0 
        ? gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length 
        : 0;
      
      const onTimeSubmissions = submissions.filter(s => 
        s.submittedAt && s.dueDate && s.submittedAt.toDate() <= s.dueDate.toDate()
      ).length;
      
      return {
        totalSubmissions,
        gradedSubmissions: gradedSubmissions.length,
        averageGrade: Math.round(averageGrade * 100) / 100,
        onTimeRate: totalSubmissions > 0 ? (onTimeSubmissions / totalSubmissions) * 100 : 0,
        recentSubmissions: submissions.slice(0, 5)
      };
    } catch (error) {
      console.error('Error getting student assignments:', error);
      return { totalSubmissions: 0, gradedSubmissions: 0, averageGrade: 0, onTimeRate: 0, recentSubmissions: [] };
    }
  }
  
  async getStudentQuizzes(studentId, batchId, startDate) {
    try {
      const attemptsRef = db.collection('quizAttempts')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('completedAt', '>=', startDate.toDate());
      
      const attemptsSnapshot = await attemptsRef.get();
      const attempts = [];
      
      attemptsSnapshot.forEach(doc => {
        attempts.push({ id: doc.id, ...doc.data() });
      });
      
      const totalAttempts = attempts.length;
      const averageScore = attempts.length > 0 
        ? attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length 
        : 0;
      
      const passedQuizzes = attempts.filter(a => a.score >= 60).length; // Assuming 60% is passing
      
      return {
        totalAttempts,
        averageScore: Math.round(averageScore * 100) / 100,
        passRate: totalAttempts > 0 ? (passedQuizzes / totalAttempts) * 100 : 0,
        recentAttempts: attempts.slice(0, 5)
      };
    } catch (error) {
      console.error('Error getting student quizzes:', error);
      return { totalAttempts: 0, averageScore: 0, passRate: 0, recentAttempts: [] };
    }
  }
  
  async getStudentVideoProgress(studentId, batchId, startDate) {
    try {
      const videoProgressRef = db.collection('videoProgress')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('lastWatched', '>=', startDate.toDate());
      
      const videoProgressSnapshot = await videoProgressRef.get();
      const videoProgress = [];
      
      videoProgressSnapshot.forEach(doc => {
        videoProgress.push({ id: doc.id, ...doc.data() });
      });
      
      const totalWatchTime = videoProgress.reduce((sum, v) => sum + (v.watchTime || 0), 0);
      const totalVideos = videoProgress.length;
      const completedVideos = videoProgress.filter(v => v.completed).length;
      
      return {
        totalVideos,
        completedVideos,
        totalWatchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        completionRate: totalVideos > 0 ? (completedVideos / totalVideos) * 100 : 0,
        recentActivity: videoProgress.slice(0, 5)
      };
    } catch (error) {
      console.error('Error getting student video progress:', error);
      return { totalVideos: 0, completedVideos: 0, totalWatchTime: 0, completionRate: 0, recentActivity: [] };
    }
  }
  
  async getStudentForumActivity(studentId, batchId, startDate) {
    try {
      // Get forum topics created by student
      const topicsRef = db.collection('forumTopics')
        .where('authorId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate.toDate());
      
      const topicsSnapshot = await topicsRef.get();
      const topicsCreated = topicsSnapshot.size;
      
      // Get forum replies by student
      const repliesRef = db.collection('forumReplies')
        .where('authorId', '==', studentId)
        .where('createdAt', '>=', startDate.toDate());
      
      const repliesSnapshot = await repliesRef.get();
      const repliesPosted = repliesSnapshot.size;
      
      return {
        topicsCreated,
        repliesPosted,
        totalPosts: topicsCreated + repliesPosted,
        engagementScore: (topicsCreated * 2) + repliesPosted // Topics worth more
      };
    } catch (error) {
      console.error('Error getting student forum activity:', error);
      return { topicsCreated: 0, repliesPosted: 0, totalPosts: 0, engagementScore: 0 };
    }
  }
  
  calculateStudentMetrics(data) {
    const { progress, assignments, quizzes, videos, forum } = data;
    
    // Calculate overall engagement score
    const engagementScore = (
      (progress.completionRate * 0.3) +
      (assignments.onTimeRate * 0.25) +
      (quizzes.passRate * 0.25) +
      (videos.completionRate * 0.15) +
      (Math.min(forum.engagementScore, 100) * 0.05)
    );
    
    // Calculate performance grade
    const performanceGrade = (
      (assignments.averageGrade * 0.4) +
      (quizzes.averageScore * 0.4) +
      (progress.averageProgress * 100 * 0.2)
    );
    
    return {
      engagementScore: Math.round(engagementScore * 100) / 100,
      performanceGrade: Math.round(performanceGrade * 100) / 100,
      totalActivities: progress.totalLessons + assignments.totalSubmissions + quizzes.totalAttempts,
      studyTimeMinutes: videos.totalWatchTime,
      overallRank: this.calculateRank(engagementScore, performanceGrade)
    };
  }
  
  calculateRank(engagement, performance) {
    const combined = (engagement + performance) / 2;
    if (combined >= 90) return 'Excellent';
    if (combined >= 80) return 'Good';
    if (combined >= 70) return 'Average';
    if (combined >= 60) return 'Below Average';
    return 'Needs Improvement';
  }
  
  async getTeacherBatchAnalytics(teacherId, batchIds, startDate) {
    try {
      const batchAnalytics = [];
      
      for (const batchId of batchIds) {
        // Get batch info
        const batchDoc = await db.collection('batches').doc(batchId).get();
        if (!batchDoc.exists) continue;
        
        const batchData = batchDoc.data();
        
        // Get enrolled students
        const enrollmentsRef = db.collection('enrollments')
          .where('batchId', '==', batchId)
          .where('status', '==', 'active');
        
        const enrollmentsSnapshot = await enrollmentsRef.get();
        const totalStudents = enrollmentsSnapshot.size;
        
        // Get active students (those with recent activity)
        const activeStudentsRef = db.collection('progress')
          .where('batchId', '==', batchId)
          .where('updatedAt', '>=', startDate.toDate());
        
        const activeStudentsSnapshot = await activeStudentsRef.get();
        const activeStudentIds = new Set();
        activeStudentsSnapshot.forEach(doc => {
          activeStudentIds.add(doc.data().studentId);
        });
        
        const activeStudents = activeStudentIds.size;
        
        // Calculate average progress
        const progressData = [];
        activeStudentsSnapshot.forEach(doc => {
          progressData.push(doc.data().progress || 0);
        });
        
        const averageProgress = progressData.length > 0 
          ? progressData.reduce((sum, p) => sum + p, 0) / progressData.length 
          : 0;
        
        batchAnalytics.push({
          batchId,
          batchName: batchData.name,
          totalStudents,
          activeStudents,
          engagementRate: totalStudents > 0 ? (activeStudents / totalStudents) * 100 : 0,
          averageProgress: Math.round(averageProgress * 100),
          startDate: batchData.startDate,
          endDate: batchData.endDate
        });
      }
      
      return batchAnalytics;
    } catch (error) {
      console.error('Error getting teacher batch analytics:', error);
      return [];
    }
  }
  
  async getPlatformMetrics(startDate) {
    try {
      // Total users
      const usersSnapshot = await db.collection('users').get();
      const totalUsers = usersSnapshot.size;
      
      // New users in time range
      const newUsersRef = db.collection('users')
        .where('createdAt', '>=', startDate);
      const newUsersSnapshot = await newUsersRef.get();
      const newUsers = newUsersSnapshot.size;
      
      // Active users (with recent activity) - using users collection with lastLoginAt
      const activeUsersRef = db.collection('users')
        .where('lastLoginAt', '>=', startDate);
      const activeUsersSnapshot = await activeUsersRef.get();
      const activeUsers = activeUsersSnapshot.size;
      
      // Total courses
      const coursesSnapshot = await db.collection('courses').get();
      const totalCourses = coursesSnapshot.size;
      
      // Total enrollments
      const enrollmentsSnapshot = await db.collection('enrollments').get();
      const totalEnrollments = enrollmentsSnapshot.size;
      
      return {
        totalUsers,
        newUsers,
        activeUsers,
        totalCourses,
        totalEnrollments,
        userGrowthRate: totalUsers > 0 ? (newUsers / totalUsers) * 100 : 0,
        userEngagementRate: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0
      };
    } catch (error) {
      console.error('Error getting platform metrics:', error);
      return {
        totalUsers: 0,
        newUsers: 0,
        activeUsers: 0,
        totalCourses: 0,
        totalEnrollments: 0,
        userGrowthRate: 0,
        userEngagementRate: 0
      };
    }
  }
  
  // Real-time analytics updates
  async updateAnalyticsCache(type, data) {
    try {
      const cacheRef = db.collection('analyticsCache').doc(type);
      await cacheRef.set({
        data,
        lastUpdated: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('Error updating analytics cache:', error);
    }
  }
  
  async getAnalyticsCache(type) {
    try {
      const cacheDoc = await db.collection('analyticsCache').doc(type).get();
      if (cacheDoc.exists) {
        return cacheDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error getting analytics cache:', error);
      return null;
    }
  }

  async getUserMetrics(startDate, userType = null) {
    try {
      let usersRef = db.collection('users');
      
      if (userType) {
        usersRef = usersRef.where('role', '==', userType);
      }
      
      const usersSnapshot = await usersRef.get();
      const users = [];
      
      usersSnapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() });
      });
      
      const totalUsers = users.length;
      const newUsers = users.filter(user => 
        user.createdAt && user.createdAt.toDate() >= startDate
      ).length;
      
      const activeUsers = users.filter(user => 
        user.lastLoginAt && user.lastLoginAt.toDate() >= startDate
      ).length;
      
      return {
        totalUsers,
        newUsers,
        activeUsers,
        usersByRole: {
          student: users.filter(u => u.role === 'student').length,
          teacher: users.filter(u => u.role === 'teacher').length,
          admin: users.filter(u => u.role === 'admin').length
        }
      };
    } catch (error) {
      console.error('Error getting user metrics:', error);
      return {
        totalUsers: 0,
        newUsers: 0,
        activeUsers: 0,
        usersByRole: { student: 0, teacher: 0, admin: 0 }
      };
    }
  }

  async getCourseMetrics(startDate) {
    try {
      const coursesSnapshot = await db.collection('courses').get();
      const courses = [];
      
      coursesSnapshot.forEach(doc => {
        courses.push({ id: doc.id, ...doc.data() });
      });
      
      const totalCourses = courses.length;
      const newCourses = courses.filter(course => 
        course.createdAt && course.createdAt.toDate() >= startDate
      ).length;
      
      return {
        totalCourses,
        newCourses,
        publishedCourses: courses.filter(c => c.status === 'published').length,
        draftCourses: courses.filter(c => c.status === 'draft').length
      };
    } catch (error) {
      console.error('Error getting course metrics:', error);
      return {
        totalCourses: 0,
        newCourses: 0,
        publishedCourses: 0,
        draftCourses: 0
      };
    }
  }

  async getRevenueMetrics(startDate) {
    try {
      const paymentsRef = db.collection('payments')
        .where('status', '==', 'completed')
        .where('createdAt', '>=', startDate);
      
      const paymentsSnapshot = await paymentsRef.get();
      const payments = [];
      
      paymentsSnapshot.forEach(doc => {
        payments.push({ id: doc.id, ...doc.data() });
      });
      
      const totalRevenue = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
      const totalTransactions = payments.length;
      
      return {
        totalRevenue,
        totalTransactions,
        averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
      };
    } catch (error) {
      console.error('Error getting revenue metrics:', error);
      return {
        totalRevenue: 0,
        totalTransactions: 0,
        averageTransactionValue: 0
      };
    }
  }

  async getSystemMetrics(startDate) {
    try {
      // Basic system metrics - can be expanded based on monitoring needs
      return {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform
      };
    } catch (error) {
      console.error('Error getting system metrics:', error);
      return {
        uptime: 0,
        memoryUsage: {},
        nodeVersion: 'unknown',
        platform: 'unknown'
      };
    }
  }
}

module.exports = new AnalyticsService();