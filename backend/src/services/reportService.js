const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { format, subDays, startOfMonth, endOfMonth } = require('date-fns');
const { logAuditEvent } = require('../../middleware/auditLogger');

class ReportService {
  constructor() {
    this.db = admin.firestore();
  }

  // Generate Student Progress Report
  async generateStudentProgressReport(studentId, batchId, format = 'pdf', timeRange = '30d') {
    try {
      const endDate = new Date();
      const startDate = this.getStartDate(timeRange, endDate);

      // Fetch student data
      const studentDoc = await this.db.collection('users').doc(studentId).get();
      if (!studentDoc.exists) {
        throw new Error('Student not found');
      }
      const student = { id: studentDoc.id, ...studentDoc.data() };

      // Fetch progress data
      const progressData = await this.getStudentProgressData(studentId, batchId, startDate, endDate);
      
      // Fetch assignments data
      const assignmentsData = await this.getStudentAssignmentsData(studentId, batchId, startDate, endDate);
      
      // Fetch quiz data
      const quizData = await this.getStudentQuizData(studentId, batchId, startDate, endDate);
      
      // Fetch video progress
      const videoData = await this.getStudentVideoData(studentId, batchId, startDate, endDate);

      const reportData = {
        student,
        timeRange,
        startDate,
        endDate,
        progress: progressData,
        assignments: assignmentsData,
        quizzes: quizData,
        videos: videoData,
        generatedAt: new Date()
      };

      if (format === 'pdf') {
        return await this.generateStudentProgressPDF(reportData);
      } else {
        return await this.generateStudentProgressExcel(reportData);
      }
    } catch (error) {
      console.error('Error generating student progress report:', error);
      throw error;
    }
  }

  // Generate Batch Performance Report
  async generateBatchPerformanceReport(batchId, format = 'pdf', timeRange = '30d') {
    try {
      const endDate = new Date();
      const startDate = this.getStartDate(timeRange, endDate);

      // Fetch batch data
      const batchDoc = await this.db.collection('batches').doc(batchId).get();
      if (!batchDoc.exists) {
        throw new Error('Batch not found');
      }
      const batch = { id: batchDoc.id, ...batchDoc.data() };

      // Fetch students in batch
      const studentsSnapshot = await this.db.collection('users')
        .where('role', '==', 'student')
        .where('batchId', '==', batchId)
        .get();
      
      const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Fetch batch performance data
      const performanceData = await this.getBatchPerformanceData(batchId, students, startDate, endDate);
      
      // Fetch assignment statistics
      const assignmentStats = await this.getBatchAssignmentStats(batchId, startDate, endDate);
      
      // Fetch quiz statistics
      const quizStats = await this.getBatchQuizStats(batchId, startDate, endDate);
      
      // Fetch engagement metrics
      const engagementData = await this.getBatchEngagementData(batchId, students, startDate, endDate);

      const reportData = {
        batch,
        students,
        timeRange,
        startDate,
        endDate,
        performance: performanceData,
        assignments: assignmentStats,
        quizzes: quizStats,
        engagement: engagementData,
        generatedAt: new Date()
      };

      if (format === 'pdf') {
        return await this.generateBatchPerformancePDF(reportData);
      } else {
        return await this.generateBatchPerformanceExcel(reportData);
      }
    } catch (error) {
      console.error('Error generating batch performance report:', error);
      throw error;
    }
  }

  // Generate Platform Analytics Report (Admin)
  async generatePlatformAnalyticsReport(format = 'pdf', timeRange = '30d') {
    try {
      const endDate = new Date();
      const startDate = this.getStartDate(timeRange, endDate);

      // Fetch platform metrics
      const userStats = await this.getPlatformUserStats(startDate, endDate);
      const courseStats = await this.getPlatformCourseStats(startDate, endDate);
      const revenueStats = await this.getPlatformRevenueStats(startDate, endDate);
      const engagementStats = await this.getPlatformEngagementStats(startDate, endDate);
      const systemStats = await this.getPlatformSystemStats(startDate, endDate);

      const reportData = {
        timeRange,
        startDate,
        endDate,
        users: userStats,
        courses: courseStats,
        revenue: revenueStats,
        engagement: engagementStats,
        system: systemStats,
        generatedAt: new Date()
      };

      if (format === 'pdf') {
        return await this.generatePlatformAnalyticsPDF(reportData);
      } else {
        return await this.generatePlatformAnalyticsExcel(reportData);
      }
    } catch (error) {
      console.error('Error generating platform analytics report:', error);
      throw error;
    }
  }

  // Generate Assignment Report
  async generateAssignmentReport(assignmentId, format = 'pdf') {
    try {
      // Fetch assignment data
      const assignmentDoc = await this.db.collection('assignments').doc(assignmentId).get();
      if (!assignmentDoc.exists) {
        throw new Error('Assignment not found');
      }
      const assignment = { id: assignmentDoc.id, ...assignmentDoc.data() };

      // Fetch submissions
      const submissionsSnapshot = await this.db.collection('assignmentSubmissions')
        .where('assignmentId', '==', assignmentId)
        .get();
      
      const submissions = [];
      for (const doc of submissionsSnapshot.docs) {
        const submission = { id: doc.id, ...doc.data() };
        
        // Fetch student details
        const studentDoc = await this.db.collection('users').doc(submission.studentId).get();
        if (studentDoc.exists) {
          submission.student = { id: studentDoc.id, ...studentDoc.data() };
        }
        
        submissions.push(submission);
      }

      // Calculate statistics
      const stats = this.calculateAssignmentStats(submissions);

      const reportData = {
        assignment,
        submissions,
        stats,
        generatedAt: new Date()
      };

      if (format === 'pdf') {
        return await this.generateAssignmentReportPDF(reportData);
      } else {
        return await this.generateAssignmentReportExcel(reportData);
      }
    } catch (error) {
      console.error('Error generating assignment report:', error);
      throw error;
    }
  }

  // PDF Generation Methods
  async generateStudentProgressPDF(data) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Student Progress Report', { align: 'center' });
        doc.moveDown();
        
        // Student Info
        doc.fontSize(14).text(`Student: ${data.student.name}`);
        doc.text(`Email: ${data.student.email}`);
        doc.text(`Period: ${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`);
        doc.text(`Generated: ${format(data.generatedAt, 'MMM dd, yyyy HH:mm')}`);
        doc.moveDown();

        // Progress Overview
        doc.fontSize(16).text('Progress Overview', { underline: true });
        doc.fontSize(12);
        doc.text(`Completion Rate: ${data.progress.completionRate.toFixed(1)}%`);
        doc.text(`Average Progress: ${data.progress.averageProgress.toFixed(1)}%`);
        doc.text(`Completed Lessons: ${data.progress.completedLessons}/${data.progress.totalLessons}`);
        doc.moveDown();

        // Assignment Performance
        doc.fontSize(16).text('Assignment Performance', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Submissions: ${data.assignments.totalSubmissions}`);
        doc.text(`Average Grade: ${data.assignments.averageGrade.toFixed(1)}%`);
        doc.text(`On-Time Rate: ${data.assignments.onTimeRate.toFixed(1)}%`);
        doc.moveDown();

        // Quiz Performance
        doc.fontSize(16).text('Quiz Performance', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Attempts: ${data.quizzes.totalAttempts}`);
        doc.text(`Average Score: ${data.quizzes.averageScore.toFixed(1)}%`);
        doc.text(`Pass Rate: ${data.quizzes.passRate.toFixed(1)}%`);
        doc.moveDown();

        // Video Engagement
        doc.fontSize(16).text('Video Engagement', { underline: true });
        doc.fontSize(12);
        doc.text(`Videos Watched: ${data.videos.completedVideos}/${data.videos.totalVideos}`);
        doc.text(`Completion Rate: ${data.videos.completionRate.toFixed(1)}%`);
        doc.text(`Total Watch Time: ${data.videos.totalWatchTime} minutes`);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generateBatchPerformancePDF(data) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Batch Performance Report', { align: 'center' });
        doc.moveDown();
        
        // Batch Info
        doc.fontSize(14).text(`Batch: ${data.batch.name}`);
        doc.text(`Subject: ${data.batch.subject}`);
        doc.text(`Students: ${data.students.length}`);
        doc.text(`Period: ${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`);
        doc.text(`Generated: ${format(data.generatedAt, 'MMM dd, yyyy HH:mm')}`);
        doc.moveDown();

        // Performance Overview
        doc.fontSize(16).text('Performance Overview', { underline: true });
        doc.fontSize(12);
        doc.text(`Average Completion Rate: ${data.performance.averageCompletionRate.toFixed(1)}%`);
        doc.text(`Average Grade: ${data.performance.averageGrade.toFixed(1)}%`);
        doc.text(`Active Students: ${data.performance.activeStudents}`);
        doc.moveDown();

        // Assignment Statistics
        doc.fontSize(16).text('Assignment Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Assignments: ${data.assignments.totalAssignments}`);
        doc.text(`Average Submission Rate: ${data.assignments.averageSubmissionRate.toFixed(1)}%`);
        doc.text(`Average Grade: ${data.assignments.averageGrade.toFixed(1)}%`);
        doc.moveDown();

        // Quiz Statistics
        doc.fontSize(16).text('Quiz Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Quizzes: ${data.quizzes.totalQuizzes}`);
        doc.text(`Average Participation: ${data.quizzes.averageParticipation.toFixed(1)}%`);
        doc.text(`Average Score: ${data.quizzes.averageScore.toFixed(1)}%`);
        doc.moveDown();

        // Top Performers
        if (data.performance.topPerformers && data.performance.topPerformers.length > 0) {
          doc.fontSize(16).text('Top Performers', { underline: true });
          doc.fontSize(12);
          data.performance.topPerformers.slice(0, 5).forEach((student, index) => {
            doc.text(`${index + 1}. ${student.name} - ${student.overallScore.toFixed(1)}%`);
          });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Excel Generation Methods
  async generateStudentProgressExcel(data) {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // Overview Sheet
      const overviewSheet = workbook.addWorksheet('Overview');
      overviewSheet.addRow(['Student Progress Report']);
      overviewSheet.addRow([]);
      overviewSheet.addRow(['Student:', data.student.name]);
      overviewSheet.addRow(['Email:', data.student.email]);
      overviewSheet.addRow(['Period:', `${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`]);
      overviewSheet.addRow(['Generated:', format(data.generatedAt, 'MMM dd, yyyy HH:mm')]);
      overviewSheet.addRow([]);
      
      // Progress Data
      overviewSheet.addRow(['Progress Overview']);
      overviewSheet.addRow(['Metric', 'Value']);
      overviewSheet.addRow(['Completion Rate', `${data.progress.completionRate.toFixed(1)}%`]);
      overviewSheet.addRow(['Average Progress', `${data.progress.averageProgress.toFixed(1)}%`]);
      overviewSheet.addRow(['Completed Lessons', `${data.progress.completedLessons}/${data.progress.totalLessons}`]);
      
      // Assignment Sheet
      const assignmentSheet = workbook.addWorksheet('Assignments');
      assignmentSheet.addRow(['Assignment Performance']);
      assignmentSheet.addRow([]);
      assignmentSheet.addRow(['Total Submissions', data.assignments.totalSubmissions]);
      assignmentSheet.addRow(['Average Grade', `${data.assignments.averageGrade.toFixed(1)}%`]);
      assignmentSheet.addRow(['On-Time Rate', `${data.assignments.onTimeRate.toFixed(1)}%`]);
      assignmentSheet.addRow([]);
      
      if (data.assignments.recentSubmissions && data.assignments.recentSubmissions.length > 0) {
        assignmentSheet.addRow(['Recent Submissions']);
        assignmentSheet.addRow(['Assignment', 'Grade', 'Submitted At', 'Status']);
        data.assignments.recentSubmissions.forEach(submission => {
          assignmentSheet.addRow([
            submission.assignmentTitle || 'N/A',
            submission.grade || 'Pending',
            format(new Date(submission.submittedAt.seconds * 1000), 'MMM dd, yyyy'),
            submission.status || 'Submitted'
          ]);
        });
      }
      
      // Quiz Sheet
      const quizSheet = workbook.addWorksheet('Quizzes');
      quizSheet.addRow(['Quiz Performance']);
      quizSheet.addRow([]);
      quizSheet.addRow(['Total Attempts', data.quizzes.totalAttempts]);
      quizSheet.addRow(['Average Score', `${data.quizzes.averageScore.toFixed(1)}%`]);
      quizSheet.addRow(['Pass Rate', `${data.quizzes.passRate.toFixed(1)}%`]);
      
      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      console.error('Error generating Excel report:', error);
      throw error;
    }
  }

  async generateBatchPerformanceExcel(data) {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // Overview Sheet
      const overviewSheet = workbook.addWorksheet('Overview');
      overviewSheet.addRow(['Batch Performance Report']);
      overviewSheet.addRow([]);
      overviewSheet.addRow(['Batch:', data.batch.name]);
      overviewSheet.addRow(['Subject:', data.batch.subject]);
      overviewSheet.addRow(['Students:', data.students.length]);
      overviewSheet.addRow(['Period:', `${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`]);
      overviewSheet.addRow(['Generated:', format(data.generatedAt, 'MMM dd, yyyy HH:mm')]);
      
      // Students Sheet
      const studentsSheet = workbook.addWorksheet('Students');
      studentsSheet.addRow(['Student List']);
      studentsSheet.addRow(['Name', 'Email', 'Enrollment Date', 'Status']);
      data.students.forEach(student => {
        studentsSheet.addRow([
          student.name,
          student.email,
          student.enrolledAt ? format(new Date(student.enrolledAt.seconds * 1000), 'MMM dd, yyyy') : 'N/A',
          student.status || 'Active'
        ]);
      });
      
      // Performance Sheet
      const performanceSheet = workbook.addWorksheet('Performance');
      performanceSheet.addRow(['Performance Metrics']);
      performanceSheet.addRow(['Metric', 'Value']);
      performanceSheet.addRow(['Average Completion Rate', `${data.performance.averageCompletionRate.toFixed(1)}%`]);
      performanceSheet.addRow(['Average Grade', `${data.performance.averageGrade.toFixed(1)}%`]);
      performanceSheet.addRow(['Active Students', data.performance.activeStudents]);
      
      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      console.error('Error generating Excel report:', error);
      throw error;
    }
  }

  // Helper Methods
  getStartDate(timeRange, endDate) {
    switch (timeRange) {
      case '7d':
        return subDays(endDate, 7);
      case '30d':
        return subDays(endDate, 30);
      case '90d':
        return subDays(endDate, 90);
      case '1y':
        return subDays(endDate, 365);
      case 'month':
        return startOfMonth(endDate);
      default:
        return subDays(endDate, 30);
    }
  }

  async getStudentProgressData(studentId, batchId, startDate, endDate) {
    try {
      const progressSnapshot = await this.db.collection('videoProgress')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('updatedAt', '>=', startDate)
        .where('updatedAt', '<=', endDate)
        .get();

      const progressData = progressSnapshot.docs.map(doc => doc.data());
      
      const totalLessons = progressData.length;
      const completedLessons = progressData.filter(p => p.completed).length;
      const completionRate = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
      const averageProgress = totalLessons > 0 ? 
        progressData.reduce((sum, p) => sum + (p.progress || 0), 0) / totalLessons * 100 : 0;

      return {
        totalLessons,
        completedLessons,
        completionRate,
        averageProgress,
        progressData
      };
    } catch (error) {
      console.error('Error fetching student progress data:', error);
      return {
        totalLessons: 0,
        completedLessons: 0,
        completionRate: 0,
        averageProgress: 0,
        progressData: []
      };
    }
  }

  async getStudentAssignmentsData(studentId, batchId, startDate, endDate) {
    try {
      const submissionsSnapshot = await this.db.collection('assignmentSubmissions')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('submittedAt', '>=', startDate)
        .where('submittedAt', '<=', endDate)
        .get();

      const submissions = submissionsSnapshot.docs.map(doc => doc.data());
      
      const totalSubmissions = submissions.length;
      const gradedSubmissions = submissions.filter(s => s.grade !== undefined && s.grade !== null);
      const averageGrade = gradedSubmissions.length > 0 ? 
        gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length : 0;
      const onTimeSubmissions = submissions.filter(s => s.submittedAt <= s.dueDate);
      const onTimeRate = totalSubmissions > 0 ? (onTimeSubmissions.length / totalSubmissions) * 100 : 0;

      return {
        totalSubmissions,
        gradedSubmissions: gradedSubmissions.length,
        averageGrade,
        onTimeRate,
        recentSubmissions: submissions.slice(-10)
      };
    } catch (error) {
      console.error('Error fetching student assignments data:', error);
      return {
        totalSubmissions: 0,
        gradedSubmissions: 0,
        averageGrade: 0,
        onTimeRate: 0,
        recentSubmissions: []
      };
    }
  }

  async getStudentQuizData(studentId, batchId, startDate, endDate) {
    try {
      const attemptsSnapshot = await this.db.collection('quizAttempts')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('completedAt', '>=', startDate)
        .where('completedAt', '<=', endDate)
        .get();

      const attempts = attemptsSnapshot.docs.map(doc => doc.data());
      
      const totalAttempts = attempts.length;
      const averageScore = totalAttempts > 0 ? 
        attempts.reduce((sum, a) => sum + a.score, 0) / totalAttempts : 0;
      const passedAttempts = attempts.filter(a => a.score >= 60);
      const passRate = totalAttempts > 0 ? (passedAttempts.length / totalAttempts) * 100 : 0;

      return {
        totalAttempts,
        averageScore,
        passRate,
        recentAttempts: attempts.slice(-10)
      };
    } catch (error) {
      console.error('Error fetching student quiz data:', error);
      return {
        totalAttempts: 0,
        averageScore: 0,
        passRate: 0,
        recentAttempts: []
      };
    }
  }

  async getStudentVideoData(studentId, batchId, startDate, endDate) {
    try {
      const videoProgressSnapshot = await this.db.collection('videoProgress')
        .where('studentId', '==', studentId)
        .where('batchId', '==', batchId)
        .where('updatedAt', '>=', startDate)
        .where('updatedAt', '<=', endDate)
        .get();

      const videoProgress = videoProgressSnapshot.docs.map(doc => doc.data());
      
      const totalVideos = videoProgress.length;
      const completedVideos = videoProgress.filter(v => v.completed).length;
      const completionRate = totalVideos > 0 ? (completedVideos / totalVideos) * 100 : 0;
      const totalWatchTime = videoProgress.reduce((sum, v) => sum + (v.watchTime || 0), 0);

      return {
        totalVideos,
        completedVideos,
        completionRate,
        totalWatchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        recentActivity: videoProgress.slice(-10)
      };
    } catch (error) {
      console.error('Error fetching student video data:', error);
      return {
        totalVideos: 0,
        completedVideos: 0,
        completionRate: 0,
        totalWatchTime: 0,
        recentActivity: []
      };
    }
  }

  async getBatchPerformanceData(batchId, students, startDate, endDate) {
    try {
      const studentIds = students.map(s => s.id);
      const performanceData = [];
      
      for (const studentId of studentIds) {
        const progressData = await this.getStudentProgressData(studentId, batchId, startDate, endDate);
        const assignmentsData = await this.getStudentAssignmentsData(studentId, batchId, startDate, endDate);
        const quizData = await this.getStudentQuizData(studentId, batchId, startDate, endDate);
        
        const student = students.find(s => s.id === studentId);
        const overallScore = (progressData.averageProgress + assignmentsData.averageGrade + quizData.averageScore) / 3;
        
        performanceData.push({
          studentId,
          name: student?.name || 'Unknown',
          completionRate: progressData.completionRate,
          assignmentGrade: assignmentsData.averageGrade,
          quizScore: quizData.averageScore,
          overallScore
        });
      }
      
      const averageCompletionRate = performanceData.length > 0 ? 
        performanceData.reduce((sum, p) => sum + p.completionRate, 0) / performanceData.length : 0;
      const averageGrade = performanceData.length > 0 ? 
        performanceData.reduce((sum, p) => sum + p.overallScore, 0) / performanceData.length : 0;
      const activeStudents = performanceData.filter(p => p.completionRate > 0).length;
      const topPerformers = performanceData.sort((a, b) => b.overallScore - a.overallScore).slice(0, 10);
      
      return {
        averageCompletionRate,
        averageGrade,
        activeStudents,
        topPerformers,
        studentPerformance: performanceData
      };
    } catch (error) {
      console.error('Error fetching batch performance data:', error);
      return {
        averageCompletionRate: 0,
        averageGrade: 0,
        activeStudents: 0,
        topPerformers: [],
        studentPerformance: []
      };
    }
  }

  async getBatchAssignmentStats(batchId, startDate, endDate) {
    try {
      const assignmentsSnapshot = await this.db.collection('assignments')
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      const assignments = assignmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const totalAssignments = assignments.length;
      
      let totalSubmissions = 0;
      let totalGrades = 0;
      let gradeCount = 0;
      
      for (const assignment of assignments) {
        const submissionsSnapshot = await this.db.collection('assignmentSubmissions')
          .where('assignmentId', '==', assignment.id)
          .get();
        
        const submissions = submissionsSnapshot.docs.map(doc => doc.data());
        totalSubmissions += submissions.length;
        
        const gradedSubmissions = submissions.filter(s => s.grade !== undefined && s.grade !== null);
        totalGrades += gradedSubmissions.reduce((sum, s) => sum + s.grade, 0);
        gradeCount += gradedSubmissions.length;
      }
      
      const averageSubmissionRate = totalAssignments > 0 ? (totalSubmissions / totalAssignments) : 0;
      const averageGrade = gradeCount > 0 ? totalGrades / gradeCount : 0;
      
      return {
        totalAssignments,
        totalSubmissions,
        averageSubmissionRate,
        averageGrade
      };
    } catch (error) {
      console.error('Error fetching batch assignment stats:', error);
      return {
        totalAssignments: 0,
        totalSubmissions: 0,
        averageSubmissionRate: 0,
        averageGrade: 0
      };
    }
  }

  async getBatchQuizStats(batchId, startDate, endDate) {
    try {
      const quizzesSnapshot = await this.db.collection('quizzes')
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const totalQuizzes = quizzes.length;
      
      let totalAttempts = 0;
      let totalScores = 0;
      let scoreCount = 0;
      
      for (const quiz of quizzes) {
        const attemptsSnapshot = await this.db.collection('quizAttempts')
          .where('quizId', '==', quiz.id)
          .get();
        
        const attempts = attemptsSnapshot.docs.map(doc => doc.data());
        totalAttempts += attempts.length;
        totalScores += attempts.reduce((sum, a) => sum + a.score, 0);
        scoreCount += attempts.length;
      }
      
      const averageParticipation = totalQuizzes > 0 ? (totalAttempts / totalQuizzes) : 0;
      const averageScore = scoreCount > 0 ? totalScores / scoreCount : 0;
      
      return {
        totalQuizzes,
        totalAttempts,
        averageParticipation,
        averageScore
      };
    } catch (error) {
      console.error('Error fetching batch quiz stats:', error);
      return {
        totalQuizzes: 0,
        totalAttempts: 0,
        averageParticipation: 0,
        averageScore: 0
      };
    }
  }

  async getBatchEngagementData(batchId, students, startDate, endDate) {
    try {
      const studentIds = students.map(s => s.id);
      let totalVideoWatchTime = 0;
      let totalForumPosts = 0;
      let totalChatMessages = 0;
      
      // Video engagement
      const videoProgressSnapshot = await this.db.collection('videoProgress')
        .where('batchId', '==', batchId)
        .where('updatedAt', '>=', startDate)
        .where('updatedAt', '<=', endDate)
        .get();
      
      videoProgressSnapshot.docs.forEach(doc => {
        const data = doc.data();
        totalVideoWatchTime += data.watchTime || 0;
      });
      
      // Forum engagement
      const forumTopicsSnapshot = await this.db.collection('forumTopics')
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      totalForumPosts += forumTopicsSnapshot.docs.length;
      
      const forumRepliesSnapshot = await this.db.collection('forumReplies')
        .where('batchId', '==', batchId)
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      totalForumPosts += forumRepliesSnapshot.docs.length;
      
      // Chat engagement
      const chatMessagesSnapshot = await this.db.collection('chatMessages')
        .where('batchId', '==', batchId)
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .get();
      
      totalChatMessages = chatMessagesSnapshot.docs.length;
      
      return {
        totalVideoWatchTime: Math.round(totalVideoWatchTime / 60), // Convert to minutes
        totalForumPosts,
        totalChatMessages,
        averageEngagementPerStudent: students.length > 0 ? 
          (totalForumPosts + totalChatMessages) / students.length : 0
      };
    } catch (error) {
      console.error('Error fetching batch engagement data:', error);
      return {
        totalVideoWatchTime: 0,
        totalForumPosts: 0,
        totalChatMessages: 0,
        averageEngagementPerStudent: 0
      };
    }
  }

  async getPlatformUserStats(startDate, endDate) {
    try {
      const usersSnapshot = await this.db.collection('users').get();
      const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const totalUsers = users.length;
      const students = users.filter(u => u.role === 'student');
      const teachers = users.filter(u => u.role === 'teacher');
      const admins = users.filter(u => u.role === 'admin');
      
      const newUsers = users.filter(u => 
        u.createdAt && 
        new Date(u.createdAt.seconds * 1000) >= startDate && 
        new Date(u.createdAt.seconds * 1000) <= endDate
      );
      
      return {
        totalUsers,
        students: students.length,
        teachers: teachers.length,
        admins: admins.length,
        newUsers: newUsers.length
      };
    } catch (error) {
      console.error('Error fetching platform user stats:', error);
      return {
        totalUsers: 0,
        students: 0,
        teachers: 0,
        admins: 0,
        newUsers: 0
      };
    }
  }

  async getPlatformCourseStats(startDate, endDate) {
    try {
      const coursesSnapshot = await this.db.collection('courses').get();
      const courses = coursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const batchesSnapshot = await this.db.collection('batches').get();
      const batches = batchesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const totalCourses = courses.length;
      const totalBatches = batches.length;
      const activeBatches = batches.filter(b => b.status === 'active').length;
      
      return {
        totalCourses,
        totalBatches,
        activeBatches
      };
    } catch (error) {
      console.error('Error fetching platform course stats:', error);
      return {
        totalCourses: 0,
        totalBatches: 0,
        activeBatches: 0
      };
    }
  }

  async getPlatformRevenueStats(startDate, endDate) {
    try {
      const paymentsSnapshot = await this.db.collection('payments')
        .where('status', '==', 'completed')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      const payments = paymentsSnapshot.docs.map(doc => doc.data());
      const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalTransactions = payments.length;
      const averageTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
      
      return {
        totalRevenue,
        totalTransactions,
        averageTransactionValue
      };
    } catch (error) {
      console.error('Error fetching platform revenue stats:', error);
      return {
        totalRevenue: 0,
        totalTransactions: 0,
        averageTransactionValue: 0
      };
    }
  }

  async getPlatformEngagementStats(startDate, endDate) {
    try {
      // Video engagement
      const videoProgressSnapshot = await this.db.collection('videoProgress')
        .where('updatedAt', '>=', startDate)
        .where('updatedAt', '<=', endDate)
        .get();
      
      const totalVideoViews = videoProgressSnapshot.docs.length;
      const totalWatchTime = videoProgressSnapshot.docs.reduce((sum, doc) => {
        const data = doc.data();
        return sum + (data.watchTime || 0);
      }, 0);
      
      // Forum engagement
      const forumTopicsSnapshot = await this.db.collection('forumTopics')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      const forumRepliesSnapshot = await this.db.collection('forumReplies')
        .where('createdAt', '>=', startDate)
        .where('createdAt', '<=', endDate)
        .get();
      
      const totalForumActivity = forumTopicsSnapshot.docs.length + forumRepliesSnapshot.docs.length;
      
      // Chat engagement
      const chatMessagesSnapshot = await this.db.collection('chatMessages')
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .get();
      
      const totalChatMessages = chatMessagesSnapshot.docs.length;
      
      return {
        totalVideoViews,
        totalWatchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        totalForumActivity,
        totalChatMessages
      };
    } catch (error) {
      console.error('Error fetching platform engagement stats:', error);
      return {
        totalVideoViews: 0,
        totalWatchTime: 0,
        totalForumActivity: 0,
        totalChatMessages: 0
      };
    }
  }

  async getPlatformSystemStats(startDate, endDate) {
    try {
      // This would typically come from monitoring systems
      // For now, return mock data
      return {
        uptime: 99.9,
        responseTime: 150,
        errorRate: 0.1,
        totalRequests: 50000,
        successfulRequests: 49950
      };
    } catch (error) {
      console.error('Error fetching platform system stats:', error);
      return {
        uptime: 0,
        responseTime: 0,
        errorRate: 0,
        totalRequests: 0,
        successfulRequests: 0
      };
    }
  }

  calculateAssignmentStats(submissions) {
    const totalSubmissions = submissions.length;
    const gradedSubmissions = submissions.filter(s => s.grade !== undefined && s.grade !== null);
    const averageGrade = gradedSubmissions.length > 0 ? 
      gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length : 0;
    const onTimeSubmissions = submissions.filter(s => s.submittedAt <= s.dueDate);
    const onTimeRate = totalSubmissions > 0 ? (onTimeSubmissions.length / totalSubmissions) * 100 : 0;
    const gradeDistribution = this.calculateGradeDistribution(gradedSubmissions);
    
    return {
      totalSubmissions,
      gradedSubmissions: gradedSubmissions.length,
      averageGrade,
      onTimeRate,
      gradeDistribution
    };
  }

  calculateGradeDistribution(submissions) {
    const distribution = {
      'A (90-100)': 0,
      'B (80-89)': 0,
      'C (70-79)': 0,
      'D (60-69)': 0,
      'F (0-59)': 0
    };
    
    submissions.forEach(submission => {
      const grade = submission.grade;
      if (grade >= 90) distribution['A (90-100)']++;
      else if (grade >= 80) distribution['B (80-89)']++;
      else if (grade >= 70) distribution['C (70-79)']++;
      else if (grade >= 60) distribution['D (60-69)']++;
      else distribution['F (0-59)']++;
    });
    
    return distribution;
  }

  async generateAssignmentReportPDF(data) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Assignment Report', { align: 'center' });
        doc.moveDown();
        
        // Assignment Info
        doc.fontSize(14).text(`Assignment: ${data.assignment.title}`);
        doc.text(`Subject: ${data.assignment.subject}`);
        doc.text(`Due Date: ${format(new Date(data.assignment.dueDate.seconds * 1000), 'MMM dd, yyyy')}`);
        doc.text(`Generated: ${format(data.generatedAt, 'MMM dd, yyyy HH:mm')}`);
        doc.moveDown();

        // Statistics
        doc.fontSize(16).text('Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Submissions: ${data.stats.totalSubmissions}`);
        doc.text(`Graded Submissions: ${data.stats.gradedSubmissions}`);
        doc.text(`Average Grade: ${data.stats.averageGrade.toFixed(1)}%`);
        doc.text(`On-Time Rate: ${data.stats.onTimeRate.toFixed(1)}%`);
        doc.moveDown();

        // Grade Distribution
        doc.fontSize(16).text('Grade Distribution', { underline: true });
        doc.fontSize(12);
        Object.entries(data.stats.gradeDistribution).forEach(([grade, count]) => {
          doc.text(`${grade}: ${count} students`);
        });
        doc.moveDown();

        // Submissions List
        if (data.submissions.length > 0) {
          doc.fontSize(16).text('Submissions', { underline: true });
          doc.fontSize(10);
          
          data.submissions.forEach((submission, index) => {
            if (index > 0 && index % 20 === 0) {
              doc.addPage();
            }
            
            doc.text(`${index + 1}. ${submission.student?.name || 'Unknown'} - Grade: ${submission.grade || 'Pending'} - Submitted: ${format(new Date(submission.submittedAt.seconds * 1000), 'MMM dd, yyyy')}`);
          });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generateAssignmentReportExcel(data) {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // Overview Sheet
      const overviewSheet = workbook.addWorksheet('Overview');
      overviewSheet.addRow(['Assignment Report']);
      overviewSheet.addRow([]);
      overviewSheet.addRow(['Assignment:', data.assignment.title]);
      overviewSheet.addRow(['Subject:', data.assignment.subject]);
      overviewSheet.addRow(['Due Date:', format(new Date(data.assignment.dueDate.seconds * 1000), 'MMM dd, yyyy')]);
      overviewSheet.addRow(['Generated:', format(data.generatedAt, 'MMM dd, yyyy HH:mm')]);
      overviewSheet.addRow([]);
      
      // Statistics
      overviewSheet.addRow(['Statistics']);
      overviewSheet.addRow(['Total Submissions', data.stats.totalSubmissions]);
      overviewSheet.addRow(['Graded Submissions', data.stats.gradedSubmissions]);
      overviewSheet.addRow(['Average Grade', `${data.stats.averageGrade.toFixed(1)}%`]);
      overviewSheet.addRow(['On-Time Rate', `${data.stats.onTimeRate.toFixed(1)}%`]);
      overviewSheet.addRow([]);
      
      // Grade Distribution
      overviewSheet.addRow(['Grade Distribution']);
      Object.entries(data.stats.gradeDistribution).forEach(([grade, count]) => {
        overviewSheet.addRow([grade, count]);
      });
      
      // Submissions Sheet
      const submissionsSheet = workbook.addWorksheet('Submissions');
      submissionsSheet.addRow(['Student Name', 'Email', 'Grade', 'Submitted At', 'Status']);
      
      data.submissions.forEach(submission => {
        submissionsSheet.addRow([
          submission.student?.name || 'Unknown',
          submission.student?.email || 'N/A',
          submission.grade || 'Pending',
          format(new Date(submission.submittedAt.seconds * 1000), 'MMM dd, yyyy HH:mm'),
          submission.status || 'Submitted'
        ]);
      });
      
      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      console.error('Error generating assignment Excel report:', error);
      throw error;
    }
  }

  async generatePlatformAnalyticsPDF(data) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Platform Analytics Report', { align: 'center' });
        doc.moveDown();
        
        // Report Info
        doc.fontSize(14).text(`Period: ${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`);
        doc.text(`Generated: ${format(data.generatedAt, 'MMM dd, yyyy HH:mm')}`);
        doc.moveDown();

        // User Statistics
        doc.fontSize(16).text('User Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Users: ${data.users.totalUsers}`);
        doc.text(`Students: ${data.users.students}`);
        doc.text(`Teachers: ${data.users.teachers}`);
        doc.text(`Admins: ${data.users.admins}`);
        doc.text(`New Users (Period): ${data.users.newUsers}`);
        doc.moveDown();

        // Course Statistics
        doc.fontSize(16).text('Course Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Courses: ${data.courses.totalCourses}`);
        doc.text(`Total Batches: ${data.courses.totalBatches}`);
        doc.text(`Active Batches: ${data.courses.activeBatches}`);
        doc.moveDown();

        // Revenue Statistics
        doc.fontSize(16).text('Revenue Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Revenue: ₹${data.revenue.totalRevenue.toLocaleString()}`);
        doc.text(`Total Transactions: ${data.revenue.totalTransactions}`);
        doc.text(`Average Transaction Value: ₹${data.revenue.averageTransactionValue.toFixed(2)}`);
        doc.moveDown();

        // Engagement Statistics
        doc.fontSize(16).text('Engagement Statistics', { underline: true });
        doc.fontSize(12);
        doc.text(`Total Video Views: ${data.engagement.totalVideoViews}`);
        doc.text(`Total Watch Time: ${data.engagement.totalWatchTime} minutes`);
        doc.text(`Forum Activity: ${data.engagement.totalForumActivity} posts`);
        doc.text(`Chat Messages: ${data.engagement.totalChatMessages}`);
        doc.moveDown();

        // System Health
        doc.fontSize(16).text('System Health', { underline: true });
        doc.fontSize(12);
        doc.text(`Uptime: ${data.system.uptime}%`);
        doc.text(`Response Time: ${data.system.responseTime}ms`);
        doc.text(`Error Rate: ${data.system.errorRate}%`);
        doc.text(`Total Requests: ${data.system.totalRequests}`);
        doc.text(`Successful Requests: ${data.system.successfulRequests}`);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generatePlatformAnalyticsExcel(data) {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // Overview Sheet
      const overviewSheet = workbook.addWorksheet('Overview');
      overviewSheet.addRow(['Platform Analytics Report']);
      overviewSheet.addRow([]);
      overviewSheet.addRow(['Period:', `${format(data.startDate, 'MMM dd, yyyy')} - ${format(data.endDate, 'MMM dd, yyyy')}`]);
      overviewSheet.addRow(['Generated:', format(data.generatedAt, 'MMM dd, yyyy HH:mm')]);
      overviewSheet.addRow([]);
      
      // User Statistics
      overviewSheet.addRow(['User Statistics']);
      overviewSheet.addRow(['Metric', 'Value']);
      overviewSheet.addRow(['Total Users', data.users.totalUsers]);
      overviewSheet.addRow(['Students', data.users.students]);
      overviewSheet.addRow(['Teachers', data.users.teachers]);
      overviewSheet.addRow(['Admins', data.users.admins]);
      overviewSheet.addRow(['New Users (Period)', data.users.newUsers]);
      overviewSheet.addRow([]);
      
      // Course Statistics
      overviewSheet.addRow(['Course Statistics']);
      overviewSheet.addRow(['Total Courses', data.courses.totalCourses]);
      overviewSheet.addRow(['Total Batches', data.courses.totalBatches]);
      overviewSheet.addRow(['Active Batches', data.courses.activeBatches]);
      overviewSheet.addRow([]);
      
      // Revenue Statistics
      overviewSheet.addRow(['Revenue Statistics']);
      overviewSheet.addRow(['Total Revenue', `₹${data.revenue.totalRevenue.toLocaleString()}`]);
      overviewSheet.addRow(['Total Transactions', data.revenue.totalTransactions]);
      overviewSheet.addRow(['Average Transaction Value', `₹${data.revenue.averageTransactionValue.toFixed(2)}`]);
      
      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      console.error('Error generating platform analytics Excel report:', error);
      throw error;
    }
  }

  // Log report generation
  async logReportGeneration(userId, reportType, format, metadata = {}) {
    try {
      const mockReq = {
        user: { id: userId },
        method: 'POST',
        originalUrl: '/api/reports/generate',
        body: { reportType, format },
        params: {},
        query: {},
        ip: metadata.ipAddress || 'unknown',
        get: (header) => header === 'User-Agent' ? metadata.userAgent || 'unknown' : null
      };
      
      await logAuditEvent('REPORT_GENERATED', mockReq, {
        reportType,
        format,
        ...metadata
      });
    } catch (error) {
      console.error('Error logging report generation:', error);
    }
  }
}

module.exports = new ReportService();