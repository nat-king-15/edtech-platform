const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');

/**
 * Quiz Service - Handles quiz creation, management, submission, and auto-grading
 * 
 * Firestore Collections:
 * - quizzes: Quiz definitions with questions and settings
 * - quizSubmissions: Student quiz submissions and results
 * - quizAttempts: Individual attempt records for analytics
 */

class QuizService {
  /**
   * Create a new quiz
   * @param {Object} quizData - Quiz configuration
   * @param {string} quizData.title - Quiz title
   * @param {string} quizData.description - Quiz description
   * @param {string} quizData.batchId - Associated batch ID
   * @param {string} quizData.subjectId - Associated subject ID
   * @param {string} quizData.createdBy - Teacher ID who created the quiz
   * @param {Array} quizData.questions - Array of question objects
   * @param {Object} quizData.settings - Quiz settings (time limit, attempts, etc.)
   * @returns {Object} Success response with quiz ID
   */
  async createQuiz(quizData) {
    try {
      // Validate required fields
      const requiredFields = ['title', 'batchId', 'subjectId', 'createdBy', 'questions'];
      for (const field of requiredFields) {
        if (!quizData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Validate questions
      if (!Array.isArray(quizData.questions) || quizData.questions.length === 0) {
        throw new Error('At least one question is required');
      }

      // Validate each question
      for (let i = 0; i < quizData.questions.length; i++) {
        const question = quizData.questions[i];
        if (!question.type || !question.question || !question.points) {
          throw new Error(`Question ${i + 1} is missing required fields (type, question, points)`);
        }

        // Validate question type specific requirements
        if (question.type === 'multiple-choice' || question.type === 'single-choice') {
          if (!question.options || !Array.isArray(question.options) || question.options.length < 2) {
            throw new Error(`Question ${i + 1} must have at least 2 options`);
          }
          if (!question.correctAnswer) {
            throw new Error(`Question ${i + 1} must have a correct answer`);
          }
        }
      }

      const quiz = {
        ...quizData,
        id: firestore.collection('quizzes').doc().id,
        status: 'draft', // draft, published, archived
        totalPoints: quizData.questions.reduce((sum, q) => sum + (q.points || 0), 0),
        questionCount: quizData.questions.length,
        settings: {
          timeLimit: 60, // minutes
          maxAttempts: 3,
          shuffleQuestions: false,
          shuffleOptions: false,
          showResults: true,
          allowReview: true,
          ...quizData.settings
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await firestore.collection('quizzes').doc(quiz.id).set(quiz);

      return {
        success: true,
        data: {
          quizId: quiz.id,
          title: quiz.title,
          totalPoints: quiz.totalPoints,
          questionCount: quiz.questionCount
        }
      };
    } catch (error) {
      console.error('Error creating quiz:', error);
      throw error;
    }
  }

  /**
   * Get quiz by ID (for students - without correct answers)
   * @param {string} quizId - Quiz ID
   * @param {string} studentId - Student ID (for attempt tracking)
   * @returns {Object} Quiz data without correct answers
   */
  async getQuizForStudent(quizId, studentId) {
    try {
      if (!quizId || !studentId) {
        throw new Error('Quiz ID and Student ID are required');
      }

      const quizDoc = await firestore.collection('quizzes').doc(quizId).get();
      if (!quizDoc.exists) {
        throw new Error('Quiz not found');
      }

      const quiz = quizDoc.data();
      
      // Check if quiz is published
      if (quiz.status !== 'published') {
        throw new Error('Quiz is not available');
      }

      // Check student's previous attempts
      const attemptsSnapshot = await firestore
        .collection('quizSubmissions')
        .where('quizId', '==', quizId)
        .where('studentId', '==', studentId)
        .get();

      const attemptCount = attemptsSnapshot.size;
      const maxAttempts = quiz.settings?.maxAttempts || 3;

      if (attemptCount >= maxAttempts) {
        throw new Error('Maximum attempts exceeded');
      }

      // Remove correct answers and explanations from questions
      const sanitizedQuestions = quiz.questions.map((question, index) => {
        const sanitized = {
          id: index + 1,
          type: question.type,
          question: question.question,
          points: question.points,
          required: question.required || true
        };

        if (question.options) {
          sanitized.options = quiz.settings?.shuffleOptions 
            ? this.shuffleArray([...question.options])
            : question.options;
        }

        return sanitized;
      });

      return {
        success: true,
        data: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          totalPoints: quiz.totalPoints,
          questionCount: quiz.questionCount,
          timeLimit: quiz.settings?.timeLimit || 60,
          attemptCount,
          maxAttempts,
          questions: quiz.settings?.shuffleQuestions 
            ? this.shuffleArray(sanitizedQuestions)
            : sanitizedQuestions
        }
      };
    } catch (error) {
      console.error('Error getting quiz for student:', error);
      throw error;
    }
  }

  /**
   * Submit quiz answers and calculate score
   * @param {string} quizId - Quiz ID
   * @param {string} studentId - Student ID
   * @param {Array} answers - Student's answers
   * @param {number} timeSpent - Time spent in minutes
   * @returns {Object} Submission result with score
   */
  async submitQuiz(quizId, studentId, answers, timeSpent = 0) {
    try {
      if (!quizId || !studentId || !Array.isArray(answers)) {
        throw new Error('Quiz ID, Student ID, and answers are required');
      }

      // Get quiz data
      const quizDoc = await firestore.collection('quizzes').doc(quizId).get();
      if (!quizDoc.exists) {
        throw new Error('Quiz not found');
      }

      const quiz = quizDoc.data();

      // Check attempt limit
      const attemptsSnapshot = await firestore
        .collection('quizSubmissions')
        .where('quizId', '==', quizId)
        .where('studentId', '==', studentId)
        .get();

      const attemptCount = attemptsSnapshot.size;
      const maxAttempts = quiz.settings?.maxAttempts || 3;

      if (attemptCount >= maxAttempts) {
        throw new Error('Maximum attempts exceeded');
      }

      // Auto-grade the quiz
      const gradingResult = this.gradeQuiz(quiz.questions, answers);

      const submission = {
        id: firestore.collection('quizSubmissions').doc().id,
        quizId,
        studentId,
        batchId: quiz.batchId,
        subjectId: quiz.subjectId,
        answers,
        score: gradingResult.score,
        totalPoints: quiz.totalPoints,
        percentage: Math.round((gradingResult.score / quiz.totalPoints) * 100),
        correctAnswers: gradingResult.correctCount,
        totalQuestions: quiz.questions.length,
        timeSpent,
        gradingDetails: gradingResult.details,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        attemptNumber: attemptCount + 1
      };

      await firestore.collection('quizSubmissions').doc(submission.id).set(submission);

      // Update quiz statistics
      await this.updateQuizStatistics(quizId);

      return {
        success: true,
        data: {
          submissionId: submission.id,
          score: submission.score,
          totalPoints: submission.totalPoints,
          percentage: submission.percentage,
          correctAnswers: submission.correctAnswers,
          totalQuestions: submission.totalQuestions,
          timeSpent: submission.timeSpent,
          passed: submission.percentage >= (quiz.settings?.passingScore || 60),
          showResults: quiz.settings?.showResults || true,
          gradingDetails: quiz.settings?.showResults ? gradingResult.details : null
        }
      };
    } catch (error) {
      console.error('Error submitting quiz:', error);
      throw error;
    }
  }

  /**
   * Auto-grade quiz answers
   * @param {Array} questions - Quiz questions with correct answers
   * @param {Array} answers - Student answers
   * @returns {Object} Grading result
   */
  gradeQuiz(questions, answers) {
    let score = 0;
    let correctCount = 0;
    const details = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const studentAnswer = answers[i];
      let isCorrect = false;
      let earnedPoints = 0;

      switch (question.type) {
        case 'single-choice':
          isCorrect = studentAnswer?.answer === question.correctAnswer;
          break;

        case 'multiple-choice':
          if (Array.isArray(question.correctAnswer) && Array.isArray(studentAnswer?.answer)) {
            const correctSet = new Set(question.correctAnswer);
            const studentSet = new Set(studentAnswer.answer);
            isCorrect = correctSet.size === studentSet.size && 
                       [...correctSet].every(x => studentSet.has(x));
          }
          break;

        case 'true-false':
          isCorrect = studentAnswer?.answer === question.correctAnswer;
          break;

        case 'short-answer':
          // Simple text matching (case-insensitive)
          if (question.correctAnswer && studentAnswer?.answer) {
            const correct = question.correctAnswer.toLowerCase().trim();
            const student = studentAnswer.answer.toLowerCase().trim();
            isCorrect = correct === student;
          }
          break;

        case 'essay':
          // Essays require manual grading
          isCorrect = null; // Will be graded manually
          earnedPoints = 0; // Default to 0, teacher will grade
          break;

        default:
          console.warn(`Unknown question type: ${question.type}`);
      }

      if (isCorrect === true) {
        earnedPoints = question.points || 0;
        correctCount++;
      } else if (isCorrect === null) {
        // Manual grading required
        earnedPoints = 0;
      }

      score += earnedPoints;

      details.push({
        questionId: i + 1,
        type: question.type,
        studentAnswer: studentAnswer?.answer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        points: question.points || 0,
        earnedPoints,
        requiresManualGrading: question.type === 'essay'
      });
    }

    return {
      score,
      correctCount,
      details
    };
  }

  /**
   * Get quiz results for a student
   * @param {string} quizId - Quiz ID
   * @param {string} studentId - Student ID
   * @returns {Object} Quiz results
   */
  async getQuizResults(quizId, studentId) {
    try {
      const submissionsSnapshot = await firestore
        .collection('quizSubmissions')
        .where('quizId', '==', quizId)
        .where('studentId', '==', studentId)
        .orderBy('submittedAt', 'desc')
        .get();

      const submissions = submissionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        success: true,
        data: submissions
      };
    } catch (error) {
      console.error('Error getting quiz results:', error);
      throw error;
    }
  }

  /**
   * Get quiz analytics for teachers
   * @param {string} quizId - Quiz ID
   * @returns {Object} Quiz analytics
   */
  async getQuizAnalytics(quizId) {
    try {
      const submissionsSnapshot = await firestore
        .collection('quizSubmissions')
        .where('quizId', '==', quizId)
        .get();

      const submissions = submissionsSnapshot.docs.map(doc => doc.data());
      
      if (submissions.length === 0) {
        return {
          success: true,
          data: {
            totalSubmissions: 0,
            averageScore: 0,
            averagePercentage: 0,
            passRate: 0,
            submissions: []
          }
        };
      }

      const totalSubmissions = submissions.length;
      const averageScore = submissions.reduce((sum, s) => sum + s.score, 0) / totalSubmissions;
      const averagePercentage = submissions.reduce((sum, s) => sum + s.percentage, 0) / totalSubmissions;
      const passedCount = submissions.filter(s => s.percentage >= 60).length;
      const passRate = (passedCount / totalSubmissions) * 100;

      return {
        success: true,
        data: {
          totalSubmissions,
          averageScore: Math.round(averageScore * 100) / 100,
          averagePercentage: Math.round(averagePercentage * 100) / 100,
          passRate: Math.round(passRate * 100) / 100,
          submissions: submissions.map(s => ({
            studentId: s.studentId,
            score: s.score,
            percentage: s.percentage,
            timeSpent: s.timeSpent,
            submittedAt: s.submittedAt,
            attemptNumber: s.attemptNumber
          }))
        }
      };
    } catch (error) {
      console.error('Error getting quiz analytics:', error);
      throw error;
    }
  }

  /**
   * Update quiz statistics
   * @param {string} quizId - Quiz ID
   */
  async updateQuizStatistics(quizId) {
    try {
      const analytics = await this.getQuizAnalytics(quizId);
      
      await firestore.collection('quizzes').doc(quizId).update({
        statistics: analytics.data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating quiz statistics:', error);
    }
  }

  /**
   * Shuffle array utility
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Get quizzes for a batch
   * @param {string} batchId - Batch ID
   * @param {string} subjectId - Subject ID (optional)
   * @returns {Object} List of quizzes
   */
  async getQuizzesForBatch(batchId, subjectId = null) {
    try {
      let query = firestore
        .collection('quizzes')
        .where('batchId', '==', batchId)
        .where('status', '==', 'published');

      if (subjectId) {
        query = query.where('subjectId', '==', subjectId);
      }

      const snapshot = await query.orderBy('createdAt', 'desc').get();
      const quizzes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        success: true,
        data: quizzes
      };
    } catch (error) {
      console.error('Error getting quizzes for batch:', error);
      throw error;
    }
  }
}

module.exports = new QuizService();