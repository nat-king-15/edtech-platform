const assignmentService = require('../src/services/assignmentService');
const { db, storage } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

// Mock Firebase
jest.mock('../config/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      })),
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn()
              }))
            }))
          })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn()
            })),
            get: jest.fn()
          })),
          limit: jest.fn(() => ({
            get: jest.fn()
          })),
          get: jest.fn()
        })),
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn()
          })),
          get: jest.fn()
        })),
        get: jest.fn()
      }))
    }))
  },
  storage: {
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn(),
        getSignedUrl: jest.fn()
      }))
    }))
  }
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('AssignmentService', () => {
  let mockCollection, mockDoc, mockQuery, mockSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock chain
    mockSnapshot = {
      empty: false,
      docs: [{
        id: 'assignment1',
        data: () => ({
          id: 'assignment1',
          title: 'Test Assignment',
          description: 'Test Description',
          batchId: 'batch1',
          subjectId: 'subject1',
          teacherId: 'teacher1',
          dueDate: '2024-12-31T23:59:59.000Z',
          maxPoints: 100,
          status: 'published'
        })
      }]
    };

    mockDoc = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          id: 'batch1',
          teacherId: 'teacher1',
          name: 'Test Batch'
        })
      }),
      set: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
      delete: jest.fn().mockResolvedValue()
    };

    mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue(mockSnapshot)
    };

    mockCollection = {
      doc: jest.fn().mockReturnValue(mockDoc),
      where: jest.fn().mockReturnValue(mockQuery),
      orderBy: jest.fn().mockReturnValue(mockQuery),
      get: jest.fn().mockResolvedValue(mockSnapshot)
    };

    db.collection.mockReturnValue(mockCollection);
  });

  describe('createAssignment', () => {
    const validAssignmentData = {
      title: 'Test Assignment',
      description: 'Test Description',
      instructions: 'Test Instructions',
      batchId: 'batch1',
      subjectId: 'subject1',
      dueDate: '2024-12-31T23:59:59.000Z',
      maxPoints: 100,
      allowLateSubmission: true,
      lateSubmissionPenalty: 10,
      allowedFileTypes: ['pdf', 'doc'],
      maxFileSize: 5242880, // 5MB
      maxFiles: 3,
      rubric: [{ criteria: 'Quality', points: 50 }],
      isGroupAssignment: false,
      maxGroupSize: 1
    };

    it('should create assignment successfully', async () => {
      const result = await assignmentService.createAssignment(validAssignmentData, 'teacher1');

      expect(result.success).toBe(true);
      expect(result.assignmentId).toBe('mock-uuid-1234');
      expect(mockDoc.set).toHaveBeenCalledWith(expect.objectContaining({
        id: 'mock-uuid-1234',
        title: 'Test Assignment',
        description: 'Test Description',
        teacherId: 'teacher1',
        status: 'published'
      }));
    });

    it('should throw error for missing required fields', async () => {
      const invalidData = { ...validAssignmentData };
      delete invalidData.title;

      await expect(assignmentService.createAssignment(invalidData, 'teacher1'))
        .rejects.toThrow('Missing required fields');
    });

    it('should throw error for unauthorized teacher', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherId: 'different-teacher' })
      });

      await expect(assignmentService.createAssignment(validAssignmentData, 'teacher1'))
        .rejects.toThrow('Unauthorized: Teacher does not own this batch');
    });

    it('should throw error for past due date', async () => {
      const pastData = {
        ...validAssignmentData,
        dueDate: '2020-01-01T00:00:00.000Z'
      };

      await expect(assignmentService.createAssignment(pastData, 'teacher1'))
        .rejects.toThrow('Due date must be in the future');
    });
  });

  describe('getAssignmentsForBatch', () => {
    it('should return assignments for teacher', async () => {
      const assignments = await assignmentService.getAssignmentsForBatch(
        'batch1', null, 'teacher1', 'teacher'
      );

      expect(assignments).toHaveLength(1);
      expect(assignments[0].title).toBe('Test Assignment');
      expect(mockCollection.where).toHaveBeenCalledWith('batchId', '==', 'batch1');
    });

    it('should return assignments with submission status for student', async () => {
      // Mock enrollment check
      const enrollmentSnapshot = {
        empty: false,
        docs: [{ data: () => ({ studentId: 'student1', batchId: 'batch1' }) }]
      };
      
      // Mock submission check
      const submissionSnapshot = {
        empty: true,
        docs: []
      };

      mockCollection.where.mockReturnValueOnce({
        where: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue(enrollmentSnapshot)
            })
          })
        })
      });

      mockCollection.where.mockReturnValueOnce({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue(submissionSnapshot)
            })
          })
        })
      });

      const assignments = await assignmentService.getAssignmentsForBatch(
        'batch1', null, 'student1', 'student'
      );

      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toHaveProperty('studentSubmission', null);
      expect(assignments[0]).toHaveProperty('canSubmit');
    });

    it('should filter by subject when provided', async () => {
      await assignmentService.getAssignmentsForBatch(
        'batch1', 'subject1', 'teacher1', 'teacher'
      );

      expect(mockQuery.where).toHaveBeenCalledWith('subjectId', '==', 'subject1');
    });
  });

  describe('getAssignmentDetails', () => {
    it('should return assignment details for teacher', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: 'assignment1',
          title: 'Test Assignment',
          teacherId: 'teacher1'
        })
      });

      const assignment = await assignmentService.getAssignmentDetails(
        'assignment1', 'teacher1', 'teacher'
      );

      expect(assignment.title).toBe('Test Assignment');
      expect(assignment.teacherId).toBe('teacher1');
    });

    it('should throw error for non-existent assignment', async () => {
      mockDoc.get.mockResolvedValueOnce({ exists: false });

      await expect(assignmentService.getAssignmentDetails(
        'assignment1', 'teacher1', 'teacher'
      )).rejects.toThrow('Assignment not found');
    });

    it('should throw error for unauthorized teacher access', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherId: 'different-teacher' })
      });

      await expect(assignmentService.getAssignmentDetails(
        'assignment1', 'teacher1', 'teacher'
      )).rejects.toThrow('Unauthorized access');
    });
  });

  describe('submitAssignment', () => {
    const mockFile = {
      originalname: 'test.pdf',
      buffer: Buffer.from('test content'),
      size: 1024,
      mimetype: 'application/pdf'
    };

    beforeEach(() => {
      // Mock assignment details
      jest.spyOn(assignmentService, 'getAssignmentDetails').mockResolvedValue({
        id: 'assignment1',
        canSubmit: true,
        isGroupAssignment: false,
        maxFiles: 5,
        allowedFileTypes: ['pdf', 'doc'],
        maxFileSize: 5242880,
        dueDate: '2024-12-31T23:59:59.000Z'
      });

      // Mock storage operations
      const mockFileRef = {
        save: jest.fn().mockResolvedValue(),
        getSignedUrl: jest.fn().mockResolvedValue(['https://example.com/file.pdf'])
      };
      storage.bucket().file.mockReturnValue(mockFileRef);

      // Mock existing submission check
      mockCollection.where.mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({ empty: true, docs: [] })
            })
          })
        })
      });

      // Mock updateAssignmentStatistics
      jest.spyOn(assignmentService, 'updateAssignmentStatistics').mockResolvedValue();
    });

    it('should submit assignment successfully', async () => {
      const submissionData = {
        text: 'My submission text',
        groupMembers: []
      };

      const result = await assignmentService.submitAssignment(
        'assignment1', 'student1', submissionData, [mockFile]
      );

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe('mock-uuid-1234');
      expect(mockDoc.set).toHaveBeenCalledWith(expect.objectContaining({
        id: 'mock-uuid-1234',
        assignmentId: 'assignment1',
        studentId: 'student1',
        text: 'My submission text',
        status: 'submitted'
      }));
    });

    it('should throw error when submission not allowed', async () => {
      assignmentService.getAssignmentDetails.mockResolvedValueOnce({
        canSubmit: false
      });

      await expect(assignmentService.submitAssignment(
        'assignment1', 'student1', {}, []
      )).rejects.toThrow('Assignment submission not allowed');
    });

    it('should throw error for too many files', async () => {
      assignmentService.getAssignmentDetails.mockResolvedValueOnce({
        canSubmit: true,
        maxFiles: 1
      });

      const files = [mockFile, mockFile]; // 2 files when max is 1

      await expect(assignmentService.submitAssignment(
        'assignment1', 'student1', {}, files
      )).rejects.toThrow('Cannot upload more than 1 files');
    });

    it('should validate group assignment requirements', async () => {
      assignmentService.getAssignmentDetails.mockResolvedValueOnce({
        canSubmit: true,
        isGroupAssignment: true,
        maxGroupSize: 3,
        maxFiles: 5,
        allowedFileTypes: ['pdf'],
        maxFileSize: 5242880
      });

      const submissionData = {
        text: 'Group submission',
        groupMembers: [] // Empty group members for group assignment
      };

      await expect(assignmentService.submitAssignment(
        'assignment1', 'student1', submissionData, []
      )).rejects.toThrow('Group members are required for group assignments');
    });
  });

  describe('gradeSubmission', () => {
    beforeEach(() => {
      // Mock submission document
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: 'submission1',
          assignmentId: 'assignment1',
          studentId: 'student1',
          isLate: false
        })
      });

      // Mock assignment details
      jest.spyOn(assignmentService, 'getAssignmentDetails').mockResolvedValue({
        id: 'assignment1',
        maxPoints: 100,
        lateSubmissionPenalty: 10
      });

      // Mock updateAssignmentStatistics
      jest.spyOn(assignmentService, 'updateAssignmentStatistics').mockResolvedValue();
    });

    it('should grade submission successfully', async () => {
      const gradingData = {
        grade: 85,
        feedback: 'Good work!',
        rubricScores: [{ criteria: 'Quality', score: 85 }]
      };

      const result = await assignmentService.gradeSubmission(
        'submission1', 'teacher1', gradingData
      );

      expect(result.success).toBe(true);
      expect(result.grade).toBe(85);
      expect(mockDoc.update).toHaveBeenCalledWith(expect.objectContaining({
        grade: 85,
        feedback: 'Good work!',
        status: 'graded'
      }));
    });

    it('should apply late penalty when applicable', async () => {
      // Mock late submission
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          id: 'submission1',
          assignmentId: 'assignment1',
          studentId: 'student1',
          isLate: true
        })
      });

      const gradingData = { grade: 90, feedback: 'Late but good' };

      const result = await assignmentService.gradeSubmission(
        'submission1', 'teacher1', gradingData
      );

      // 90 - (10% of 90) = 90 - 9 = 81
      expect(result.grade).toBe(81);
      expect(mockDoc.update).toHaveBeenCalledWith(expect.objectContaining({
        grade: 81,
        latePenaltyApplied: 9
      }));
    });

    it('should throw error for invalid grade', async () => {
      const gradingData = { grade: 150, feedback: 'Too high' }; // Above maxPoints

      await expect(assignmentService.gradeSubmission(
        'submission1', 'teacher1', gradingData
      )).rejects.toThrow('Grade must be between 0 and 100');
    });

    it('should throw error for non-existent submission', async () => {
      mockDoc.get.mockResolvedValueOnce({ exists: false });

      await expect(assignmentService.gradeSubmission(
        'submission1', 'teacher1', { grade: 85 }
      )).rejects.toThrow('Submission not found');
    });
  });

  describe('getSubmissions', () => {
    beforeEach(() => {
      // Mock assignment details check
      jest.spyOn(assignmentService, 'getAssignmentDetails').mockResolvedValue({
        id: 'assignment1',
        teacherId: 'teacher1'
      });

      // Mock submissions query
      const submissionSnapshot = {
        docs: [{
          data: () => ({
            id: 'submission1',
            assignmentId: 'assignment1',
            studentId: 'student1',
            status: 'submitted',
            isLate: false
          })
        }]
      };

      mockQuery.get.mockResolvedValue(submissionSnapshot);

      // Mock student details
      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          name: 'John Doe',
          email: 'john@example.com'
        })
      });
    });

    it('should return submissions for assignment', async () => {
      const submissions = await assignmentService.getSubmissions(
        'assignment1', 'teacher1', {}
      );

      expect(submissions).toHaveLength(1);
      expect(submissions[0].studentName).toBe('John Doe');
      expect(submissions[0].studentEmail).toBe('john@example.com');
    });

    it('should filter submissions by status', async () => {
      const filters = { status: 'graded' };
      
      // Mock submission with different status
      const submissionSnapshot = {
        docs: [{
          data: () => ({
            id: 'submission1',
            status: 'submitted', // Different from filter
            isLate: false
          })
        }]
      };
      mockQuery.get.mockResolvedValue(submissionSnapshot);

      const submissions = await assignmentService.getSubmissions(
        'assignment1', 'teacher1', filters
      );

      expect(submissions).toHaveLength(0); // Filtered out
    });
  });

  describe('updateAssignmentStatistics', () => {
    it('should update assignment statistics correctly', async () => {
      const submissionsSnapshot = {
        docs: [
          { data: () => ({ status: 'graded', grade: 85, isLate: false }) },
          { data: () => ({ status: 'graded', grade: 90, isLate: true }) },
          { data: () => ({ status: 'submitted', isLate: false }) }
        ]
      };

      mockQuery.get.mockResolvedValue(submissionsSnapshot);

      await assignmentService.updateAssignmentStatistics('assignment1');

      expect(mockDoc.update).toHaveBeenCalledWith(expect.objectContaining({
        statistics: {
          totalSubmissions: 3,
          gradedSubmissions: 2,
          averageScore: 87.5, // (85 + 90) / 2
          onTimeSubmissions: 2,
          lateSubmissions: 1
        }
      }));
    });
  });

  describe('deleteAssignment', () => {
    beforeEach(() => {
      // Mock assignment details check
      jest.spyOn(assignmentService, 'getAssignmentDetails').mockResolvedValue({
        id: 'assignment1',
        teacherId: 'teacher1'
      });
    });

    it('should delete assignment when no submissions exist', async () => {
      // Mock no submissions
      mockQuery.get.mockResolvedValue({ empty: true, docs: [] });

      const result = await assignmentService.deleteAssignment('assignment1', 'teacher1');

      expect(result.success).toBe(true);
      expect(mockDoc.delete).toHaveBeenCalled();
    });

    it('should throw error when submissions exist', async () => {
      // Mock existing submissions
      mockQuery.get.mockResolvedValue({
        empty: false,
        docs: [{ id: 'submission1' }]
      });

      await expect(assignmentService.deleteAssignment('assignment1', 'teacher1'))
        .rejects.toThrow('Cannot delete assignment with existing submissions');
    });
  });
});