const quizService = require('../services/quizService');
const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');

// Mock Firebase
jest.mock('../config/firebase', () => ({
  firestore: {
    collection: jest.fn(),
    FieldValue: {
      serverTimestamp: jest.fn(() => 'mocked-timestamp')
    }
  }
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'mocked-timestamp')
    }
  }
}));

describe('QuizService', () => {
  let mockCollection, mockDoc, mockGet, mockSet, mockUpdate, mockWhere, mockOrderBy;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock chain
    mockSet = jest.fn();
    mockUpdate = jest.fn();
    mockGet = jest.fn();
    mockWhere = jest.fn();
    mockOrderBy = jest.fn();
    
    mockDoc = jest.fn(() => ({
      id: 'mock-quiz-id',
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    }));
    
    mockCollection = jest.fn(() => ({
      doc: mockDoc,
      where: mockWhere,
      orderBy: mockOrderBy,
      get: mockGet
    }));
    
    firestore.collection = mockCollection;
    
    // Setup query chain
    mockWhere.mockReturnThis();
    mockOrderBy.mockReturnThis();
  });

  describe('createQuiz', () => {
    const validQuizData = {
      title: 'Test Quiz',
      description: 'A test quiz',
      batchId: 'batch-123',
      subjectId: 'subject-456',
      createdBy: 'teacher-789',
      questions: [
        {
          type: 'single-choice',
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: '4',
          points: 10
        },
        {
          type: 'multiple-choice',
          question: 'Select even numbers',
          options: ['1', '2', '3', '4'],
          correctAnswer: ['2', '4'],
          points: 15
        }
      ],
      settings: {
        timeLimit: 30,
        maxAttempts: 2
      }
    };

    it('should create a quiz successfully', async () => {
      mockSet.mockResolvedValue();

      const result = await quizService.createQuiz(validQuizData);

      expect(result.success).toBe(true);
      expect(result.data.quizId).toBe('mock-quiz-id');
      expect(result.data.title).toBe('Test Quiz');
      expect(result.data.totalPoints).toBe(25);
      expect(result.data.questionCount).toBe(2);
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test Quiz',
        status: 'draft',
        totalPoints: 25,
        questionCount: 2
      }));
    });

    it('should throw error for missing required fields', async () => {
      const invalidData = { ...validQuizData };
      delete invalidData.title;

      await expect(quizService.createQuiz(invalidData))
        .rejects.toThrow('title is required');
    });

    it('should throw error for empty questions array', async () => {
      const invalidData = { ...validQuizData, questions: [] };

      await expect(quizService.createQuiz(invalidData))
        .rejects.toThrow('At least one question is required');
    });

    it('should throw error for invalid question format', async () => {
      const invalidData = {
        ...validQuizData,
        questions: [{ type: 'single-choice' }] // Missing required fields
      };

      await expect(quizService.createQuiz(invalidData))
        .rejects.toThrow('Question 1 is missing required fields');
    });

    it('should throw error for multiple-choice question without options', async () => {
      const invalidData = {
        ...validQuizData,
        questions: [{
          type: 'multiple-choice',
          question: 'Test question',
          points: 10,
          options: ['only-one-option']
        }]
      };

      await expect(quizService.createQuiz(invalidData))
        .rejects.toThrow('Question 1 must have at least 2 options');
    });
  });

  describe('getQuizForStudent', () => {
    const mockQuizData = {
      id: 'quiz-123',
      title: 'Test Quiz',
      description: 'A test quiz',
      status: 'published',
      totalPoints: 25,
      questionCount: 2,
      questions: [
        {
          type: 'single-choice',
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: '4',
          points: 10
        }
      ],
      settings: {
        timeLimit: 30,
        maxAttempts: 3,
        shuffleQuestions: false,
        shuffleOptions: false
      }
    };

    it('should return quiz for student successfully', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockQuizData
      });
      
      // Mock submissions query
      mockGet.mockResolvedValueOnce({
        size: 1 // 1 previous attempt
      });

      const result = await quizService.getQuizForStudent('quiz-123', 'student-456');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('quiz-123');
      expect(result.data.attemptCount).toBe(1);
      expect(result.data.maxAttempts).toBe(3);
      expect(result.data.questions[0]).not.toHaveProperty('correctAnswer');
    });

    it('should throw error if quiz not found', async () => {
      mockGet.mockResolvedValue({ exists: false });

      await expect(quizService.getQuizForStudent('quiz-123', 'student-456'))
        .rejects.toThrow('Quiz not found');
    });

    it('should throw error if quiz not published', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...mockQuizData, status: 'draft' })
      });

      await expect(quizService.getQuizForStudent('quiz-123', 'student-456'))
        .rejects.toThrow('Quiz is not available');
    });

    it('should throw error if maximum attempts exceeded', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockQuizData
      });
      
      // Mock submissions query - 3 attempts (max reached)
      mockGet.mockResolvedValueOnce({
        size: 3
      });

      await expect(quizService.getQuizForStudent('quiz-123', 'student-456'))
        .rejects.toThrow('Maximum attempts exceeded');
    });
  });

  describe('submitQuiz', () => {
    const mockQuizData = {
      id: 'quiz-123',
      batchId: 'batch-123',
      subjectId: 'subject-456',
      totalPoints: 25,
      questions: [
        {
          type: 'single-choice',
          question: 'What is 2+2?',
          correctAnswer: '4',
          points: 10
        },
        {
          type: 'multiple-choice',
          question: 'Select even numbers',
          correctAnswer: ['2', '4'],
          points: 15
        }
      ],
      settings: {
        maxAttempts: 3,
        showResults: true
      }
    };

    const mockAnswers = [
      { answer: '4' }, // Correct
      { answer: ['2', '4'] } // Correct
    ];

    it('should submit quiz and calculate score correctly', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockQuizData
      });
      
      // Mock submissions query - 1 previous attempt
      mockGet.mockResolvedValueOnce({
        size: 1
      });
      
      mockSet.mockResolvedValue();
      
      // Mock updateQuizStatistics
      jest.spyOn(quizService, 'updateQuizStatistics').mockResolvedValue();

      const result = await quizService.submitQuiz('quiz-123', 'student-456', mockAnswers, 15);

      expect(result.success).toBe(true);
      expect(result.data.score).toBe(25); // Both answers correct
      expect(result.data.percentage).toBe(100);
      expect(result.data.correctAnswers).toBe(2);
      expect(result.data.passed).toBe(true);
      expect(mockSet).toHaveBeenCalled();
    });

    it('should handle incorrect answers', async () => {
      const incorrectAnswers = [
        { answer: '3' }, // Incorrect
        { answer: ['1', '3'] } // Incorrect
      ];

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockQuizData
      });
      
      mockGet.mockResolvedValueOnce({ size: 0 });
      mockSet.mockResolvedValue();
      jest.spyOn(quizService, 'updateQuizStatistics').mockResolvedValue();

      const result = await quizService.submitQuiz('quiz-123', 'student-456', incorrectAnswers, 10);

      expect(result.success).toBe(true);
      expect(result.data.score).toBe(0);
      expect(result.data.percentage).toBe(0);
      expect(result.data.correctAnswers).toBe(0);
      expect(result.data.passed).toBe(false);
    });

    it('should throw error if maximum attempts exceeded', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockQuizData
      });
      
      // Mock submissions query - 3 attempts (max reached)
      mockGet.mockResolvedValueOnce({ size: 3 });

      await expect(quizService.submitQuiz('quiz-123', 'student-456', mockAnswers))
        .rejects.toThrow('Maximum attempts exceeded');
    });
  });

  describe('gradeQuiz', () => {
    const questions = [
      {
        type: 'single-choice',
        correctAnswer: '4',
        points: 10
      },
      {
        type: 'multiple-choice',
        correctAnswer: ['2', '4'],
        points: 15
      },
      {
        type: 'true-false',
        correctAnswer: true,
        points: 5
      },
      {
        type: 'short-answer',
        correctAnswer: 'Paris',
        points: 8
      },
      {
        type: 'essay',
        points: 12
      }
    ];

    it('should grade all question types correctly', () => {
      const answers = [
        { answer: '4' }, // Correct single-choice
        { answer: ['2', '4'] }, // Correct multiple-choice
        { answer: true }, // Correct true-false
        { answer: 'paris' }, // Correct short-answer (case-insensitive)
        { answer: 'This is an essay answer' } // Essay (requires manual grading)
      ];

      const result = quizService.gradeQuiz(questions, answers);

      expect(result.score).toBe(38); // 10 + 15 + 5 + 8 + 0 (essay not auto-graded)
      expect(result.correctCount).toBe(4); // Essay not counted as correct/incorrect
      expect(result.details).toHaveLength(5);
      expect(result.details[0].isCorrect).toBe(true);
      expect(result.details[4].requiresManualGrading).toBe(true);
    });

    it('should handle incorrect answers', () => {
      const answers = [
        { answer: '3' }, // Incorrect
        { answer: ['1', '3'] }, // Incorrect
        { answer: false }, // Incorrect
        { answer: 'London' }, // Incorrect
        { answer: 'Essay answer' }
      ];

      const result = quizService.gradeQuiz(questions, answers);

      expect(result.score).toBe(0);
      expect(result.correctCount).toBe(0);
    });
  });

  describe('getQuizResults', () => {
    it('should return quiz results for student', async () => {
      const mockSubmissions = [
        {
          id: 'submission-1',
          score: 20,
          percentage: 80,
          submittedAt: 'timestamp-1'
        },
        {
          id: 'submission-2',
          score: 25,
          percentage: 100,
          submittedAt: 'timestamp-2'
        }
      ];

      mockGet.mockResolvedValue({
        docs: mockSubmissions.map(sub => ({
          id: sub.id,
          data: () => sub
        }))
      });

      const result = await quizService.getQuizResults('quiz-123', 'student-456');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].score).toBe(20);
    });
  });

  describe('getQuizAnalytics', () => {
    it('should return quiz analytics', async () => {
      const mockSubmissions = [
        { score: 20, percentage: 80 },
        { score: 25, percentage: 100 },
        { score: 15, percentage: 60 }
      ];

      mockGet.mockResolvedValue({
        docs: mockSubmissions.map(sub => ({ data: () => sub }))
      });

      const result = await quizService.getQuizAnalytics('quiz-123');

      expect(result.success).toBe(true);
      expect(result.data.totalSubmissions).toBe(3);
      expect(result.data.averageScore).toBe(20); // (20+25+15)/3
      expect(result.data.averagePercentage).toBe(80); // (80+100+60)/3
      expect(result.data.passRate).toBe(66.67); // 2 out of 3 passed (>=60%)
    });

    it('should handle no submissions', async () => {
      mockGet.mockResolvedValue({ docs: [] });

      const result = await quizService.getQuizAnalytics('quiz-123');

      expect(result.success).toBe(true);
      expect(result.data.totalSubmissions).toBe(0);
      expect(result.data.averageScore).toBe(0);
      expect(result.data.passRate).toBe(0);
    });
  });

  describe('getQuizzesForBatch', () => {
    it('should return published quizzes for batch', async () => {
      const mockQuizzes = [
        {
          id: 'quiz-1',
          title: 'Quiz 1',
          status: 'published'
        },
        {
          id: 'quiz-2',
          title: 'Quiz 2',
          status: 'published'
        }
      ];

      mockGet.mockResolvedValue({
        docs: mockQuizzes.map(quiz => ({
          id: quiz.id,
          data: () => quiz
        }))
      });

      const result = await quizService.getQuizzesForBatch('batch-123');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(mockWhere).toHaveBeenCalledWith('batchId', '==', 'batch-123');
      expect(mockWhere).toHaveBeenCalledWith('status', '==', 'published');
    });

    it('should filter by subject when provided', async () => {
      mockGet.mockResolvedValue({ docs: [] });

      await quizService.getQuizzesForBatch('batch-123', 'subject-456');

      expect(mockWhere).toHaveBeenCalledWith('subjectId', '==', 'subject-456');
    });
  });

  describe('shuffleArray', () => {
    it('should shuffle array without modifying original', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = quizService.shuffleArray(original);

      expect(shuffled).toHaveLength(5);
      expect(shuffled).toEqual(expect.arrayContaining(original));
      expect(original).toEqual([1, 2, 3, 4, 5]); // Original unchanged
    });
  });
});