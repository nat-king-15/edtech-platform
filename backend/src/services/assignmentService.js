const { db, storage } = require('../../config/firebase');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');

/**
 * Assignment Service
 * Handles assignment creation, submission, grading, and file management
 */
class AssignmentService {
  /**
   * Create a new assignment
   * @param {Object} assignmentData - Assignment data
   * @param {string} teacherId - ID of the teacher creating the assignment
   * @returns {Promise<Object>} Created assignment data
   */
  async createAssignment(assignmentData, teacherId) {
    try {
      const {
        title,
        description,
        instructions,
        batchId,
        subjectId,
        dueDate,
        maxPoints,
        allowLateSubmission,
        lateSubmissionPenalty,
        allowedFileTypes,
        maxFileSize,
        maxFiles,
        rubric,
        isGroupAssignment,
        maxGroupSize
      } = assignmentData;

      // Validate required fields
      if (!title || !description || !batchId || !subjectId || !dueDate || !maxPoints) {
        throw new Error('Missing required fields');
      }

      // Verify teacher owns the batch
      const batchDoc = await db.collection('batches').doc(batchId).get();
      if (!batchDoc.exists || batchDoc.data().teacherId !== teacherId) {
        throw new Error('Unauthorized: Teacher does not own this batch');
      }

      // Validate due date
      const dueDateObj = new Date(dueDate);
      if (dueDateObj <= new Date()) {
        throw new Error('Due date must be in the future');
      }

      const assignmentId = uuidv4();
      const now = new Date().toISOString();

      const assignment = {
        id: assignmentId,
        title: title.trim(),
        description: description.trim(),
        instructions: instructions?.trim() || '',
        batchId,
        subjectId,
        teacherId,
        dueDate: dueDateObj.toISOString(),
        maxPoints: parseInt(maxPoints),
        allowLateSubmission: allowLateSubmission || false,
        lateSubmissionPenalty: lateSubmissionPenalty || 0,
        allowedFileTypes: allowedFileTypes || ['pdf', 'doc', 'docx', 'txt', 'jpg', 'png'],
        maxFileSize: maxFileSize || 10 * 1024 * 1024, // 10MB default
        maxFiles: maxFiles || 5,
        rubric: rubric || [],
        isGroupAssignment: isGroupAssignment || false,
        maxGroupSize: maxGroupSize || 1,
        status: 'published',
        createdAt: now,
        updatedAt: now,
        statistics: {
          totalSubmissions: 0,
          gradedSubmissions: 0,
          averageScore: 0,
          onTimeSubmissions: 0,
          lateSubmissions: 0
        }
      };

      // Save to Firestore
      await db.collection('assignments').doc(assignmentId).set(assignment);

      return {
        success: true,
        assignmentId,
        assignment
      };
    } catch (error) {
      console.error('Error creating assignment:', error);
      throw error;
    }
  }

  /**
   * Get assignments for a batch
   * @param {string} batchId - Batch ID
   * @param {string} subjectId - Subject ID (optional)
   * @param {string} userId - User ID for permission check
   * @param {string} userRole - User role (teacher/student)
   * @returns {Promise<Array>} List of assignments
   */
  async getAssignmentsForBatch(batchId, subjectId = null, userId, userRole) {
    try {
      let query = db.collection('assignments')
        .where('batchId', '==', batchId)
        .where('status', '==', 'published')
        .orderBy('dueDate', 'asc');

      if (subjectId) {
        query = query.where('subjectId', '==', subjectId);
      }

      const snapshot = await query.get();
      const assignments = [];

      for (const doc of snapshot.docs) {
        const assignment = doc.data();
        
        // For students, add submission status
        if (userRole === 'student') {
          const submissionQuery = await db.collection('submissions')
            .where('assignmentId', '==', assignment.id)
            .where('studentId', '==', userId)
            .orderBy('submittedAt', 'desc')
            .limit(1)
            .get();

          assignment.studentSubmission = submissionQuery.empty ? null : submissionQuery.docs[0].data();
          assignment.isOverdue = new Date() > new Date(assignment.dueDate);
          assignment.canSubmit = assignment.studentSubmission ? 
            (assignment.allowLateSubmission || !assignment.isOverdue) && 
            assignment.studentSubmission.status !== 'graded' :
            (assignment.allowLateSubmission || !assignment.isOverdue);
        }

        assignments.push(assignment);
      }

      return assignments;
    } catch (error) {
      console.error('Error fetching assignments:', error);
      throw error;
    }
  }

  /**
   * Get assignment details
   * @param {string} assignmentId - Assignment ID
   * @param {string} userId - User ID for permission check
   * @param {string} userRole - User role
   * @returns {Promise<Object>} Assignment details
   */
  async getAssignmentDetails(assignmentId, userId, userRole) {
    try {
      const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();
      
      if (!assignmentDoc.exists) {
        throw new Error('Assignment not found');
      }

      const assignment = assignmentDoc.data();

      // Check permissions
      if (userRole === 'teacher' && assignment.teacherId !== userId) {
        throw new Error('Unauthorized access');
      }

      if (userRole === 'student') {
        // Check if student is enrolled in the batch
        const enrollmentDoc = await db.collection('enrollments')
          .where('studentId', '==', userId)
          .where('batchId', '==', assignment.batchId)
          .where('status', '==', 'active')
          .limit(1)
          .get();

        if (enrollmentDoc.empty) {
          throw new Error('Student not enrolled in this batch');
        }

        // Get student's submission if exists
        const submissionQuery = await db.collection('submissions')
          .where('assignmentId', '==', assignmentId)
          .where('studentId', '==', userId)
          .orderBy('submittedAt', 'desc')
          .limit(1)
          .get();

        assignment.studentSubmission = submissionQuery.empty ? null : submissionQuery.docs[0].data();
        assignment.isOverdue = new Date() > new Date(assignment.dueDate);
        assignment.canSubmit = assignment.studentSubmission ? 
          (assignment.allowLateSubmission || !assignment.isOverdue) && 
          assignment.studentSubmission.status !== 'graded' :
          (assignment.allowLateSubmission || !assignment.isOverdue);
      }

      return assignment;
    } catch (error) {
      console.error('Error fetching assignment details:', error);
      throw error;
    }
  }

  /**
   * Submit assignment
   * @param {string} assignmentId - Assignment ID
   * @param {string} studentId - Student ID
   * @param {Object} submissionData - Submission data
   * @param {Array} files - Uploaded files
   * @returns {Promise<Object>} Submission result
   */
  async submitAssignment(assignmentId, studentId, submissionData, files = []) {
    try {
      const { text, groupMembers = [] } = submissionData;

      // Get assignment details
      const assignment = await this.getAssignmentDetails(assignmentId, studentId, 'student');
      
      if (!assignment.canSubmit) {
        throw new Error('Assignment submission not allowed');
      }

      // Validate group assignment
      if (assignment.isGroupAssignment) {
        if (groupMembers.length === 0) {
          throw new Error('Group members are required for group assignments');
        }
        if (groupMembers.length > assignment.maxGroupSize) {
          throw new Error(`Group size cannot exceed ${assignment.maxGroupSize} members`);
        }
      }

      // Validate files
      if (files.length > assignment.maxFiles) {
        throw new Error(`Cannot upload more than ${assignment.maxFiles} files`);
      }

      const submissionId = uuidv4();
      const now = new Date();
      const isLate = now > new Date(assignment.dueDate);
      
      // Upload files to Firebase Storage
      const uploadedFiles = [];
      for (const file of files) {
        // Validate file type
        const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
        if (!assignment.allowedFileTypes.includes(fileExtension)) {
          throw new Error(`File type ${fileExtension} is not allowed`);
        }

        // Validate file size
        if (file.size > assignment.maxFileSize) {
          throw new Error(`File ${file.originalname} exceeds maximum size limit`);
        }

        const fileName = `${submissionId}_${Date.now()}_${file.originalname}`;
        const filePath = `assignments/${assignmentId}/submissions/${submissionId}/${fileName}`;
        
        const fileRef = storage.bucket().file(filePath);
        await fileRef.save(file.buffer, {
          metadata: {
            contentType: file.mimetype,
            metadata: {
              originalName: file.originalname,
              uploadedBy: studentId,
              submissionId
            }
          }
        });

        const [downloadURL] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2500' // Long expiry for assignment files
        });

        uploadedFiles.push({
          id: uuidv4(),
          originalName: file.originalname,
          fileName,
          filePath,
          downloadURL,
          size: file.size,
          type: file.mimetype,
          uploadedAt: now.toISOString()
        });
      }

      // Create submission
      const submission = {
        id: submissionId,
        assignmentId,
        studentId,
        text: text?.trim() || '',
        files: uploadedFiles,
        groupMembers: assignment.isGroupAssignment ? groupMembers : [],
        submittedAt: now.toISOString(),
        isLate,
        status: 'submitted',
        grade: null,
        feedback: '',
        gradedAt: null,
        gradedBy: null,
        version: 1
      };

      // Check if this is a resubmission
      const existingSubmissionQuery = await db.collection('submissions')
        .where('assignmentId', '==', assignmentId)
        .where('studentId', '==', studentId)
        .orderBy('submittedAt', 'desc')
        .limit(1)
        .get();

      if (!existingSubmissionQuery.empty) {
        const existingSubmission = existingSubmissionQuery.docs[0].data();
        submission.version = existingSubmission.version + 1;
        
        // Mark previous submission as superseded
        await db.collection('submissions').doc(existingSubmissionQuery.docs[0].id)
          .update({ status: 'superseded' });
      }

      // Save submission
      await db.collection('submissions').doc(submissionId).set(submission);

      // Update assignment statistics
      await this.updateAssignmentStatistics(assignmentId);

      return {
        success: true,
        submissionId,
        submission
      };
    } catch (error) {
      console.error('Error submitting assignment:', error);
      throw error;
    }
  }

  /**
   * Grade assignment submission
   * @param {string} submissionId - Submission ID
   * @param {string} teacherId - Teacher ID
   * @param {Object} gradingData - Grading data
   * @returns {Promise<Object>} Grading result
   */
  async gradeSubmission(submissionId, teacherId, gradingData) {
    try {
      const { grade, feedback, rubricScores = [] } = gradingData;

      // Get submission
      const submissionDoc = await db.collection('submissions').doc(submissionId).get();
      if (!submissionDoc.exists) {
        throw new Error('Submission not found');
      }

      const submission = submissionDoc.data();

      // Get assignment to verify teacher ownership
      const assignment = await this.getAssignmentDetails(submission.assignmentId, teacherId, 'teacher');
      
      // Validate grade
      if (grade < 0 || grade > assignment.maxPoints) {
        throw new Error(`Grade must be between 0 and ${assignment.maxPoints}`);
      }

      const now = new Date().toISOString();
      const updates = {
        grade: parseFloat(grade),
        feedback: feedback?.trim() || '',
        rubricScores,
        gradedAt: now,
        gradedBy: teacherId,
        status: 'graded'
      };

      // Apply late submission penalty if applicable
      if (submission.isLate && assignment.lateSubmissionPenalty > 0) {
        const penaltyAmount = (assignment.lateSubmissionPenalty / 100) * grade;
        updates.grade = Math.max(0, grade - penaltyAmount);
        updates.latePenaltyApplied = penaltyAmount;
      }

      await db.collection('submissions').doc(submissionId).update(updates);

      // Update assignment statistics
      await this.updateAssignmentStatistics(submission.assignmentId);

      return {
        success: true,
        submissionId,
        grade: updates.grade,
        feedback: updates.feedback
      };
    } catch (error) {
      console.error('Error grading submission:', error);
      throw error;
    }
  }

  /**
   * Get submissions for an assignment
   * @param {string} assignmentId - Assignment ID
   * @param {string} teacherId - Teacher ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} List of submissions
   */
  async getSubmissions(assignmentId, teacherId, filters = {}) {
    try {
      // Verify teacher ownership
      await this.getAssignmentDetails(assignmentId, teacherId, 'teacher');

      let query = db.collection('submissions')
        .where('assignmentId', '==', assignmentId)
        .where('status', 'in', ['submitted', 'graded'])
        .orderBy('submittedAt', 'desc');

      const snapshot = await query.get();
      const submissions = [];

      for (const doc of snapshot.docs) {
        const submission = doc.data();
        
        // Get student details
        const studentDoc = await db.collection('users').doc(submission.studentId).get();
        if (studentDoc.exists) {
          const student = studentDoc.data();
          submission.studentName = student.name;
          submission.studentEmail = student.email;
        }

        // Apply filters
        if (filters.status && submission.status !== filters.status) continue;
        if (filters.isLate !== undefined && submission.isLate !== filters.isLate) continue;

        submissions.push(submission);
      }

      return submissions;
    } catch (error) {
      console.error('Error fetching submissions:', error);
      throw error;
    }
  }

  /**
   * Update assignment statistics
   * @param {string} assignmentId - Assignment ID
   * @returns {Promise<void>}
   */
  async updateAssignmentStatistics(assignmentId) {
    try {
      const submissionsQuery = await db.collection('submissions')
        .where('assignmentId', '==', assignmentId)
        .where('status', 'in', ['submitted', 'graded'])
        .get();

      const submissions = submissionsQuery.docs.map(doc => doc.data());
      const gradedSubmissions = submissions.filter(s => s.status === 'graded');
      const onTimeSubmissions = submissions.filter(s => !s.isLate);
      const lateSubmissions = submissions.filter(s => s.isLate);
      
      const averageScore = gradedSubmissions.length > 0 ?
        gradedSubmissions.reduce((sum, s) => sum + s.grade, 0) / gradedSubmissions.length : 0;

      const statistics = {
        totalSubmissions: submissions.length,
        gradedSubmissions: gradedSubmissions.length,
        averageScore: Math.round(averageScore * 100) / 100,
        onTimeSubmissions: onTimeSubmissions.length,
        lateSubmissions: lateSubmissions.length
      };

      await db.collection('assignments').doc(assignmentId).update({
        statistics,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating assignment statistics:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Delete assignment
   * @param {string} assignmentId - Assignment ID
   * @param {string} teacherId - Teacher ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteAssignment(assignmentId, teacherId) {
    try {
      // Verify teacher ownership
      await this.getAssignmentDetails(assignmentId, teacherId, 'teacher');

      // Check if there are any submissions
      const submissionsQuery = await db.collection('submissions')
        .where('assignmentId', '==', assignmentId)
        .limit(1)
        .get();

      if (!submissionsQuery.empty) {
        throw new Error('Cannot delete assignment with existing submissions');
      }

      // Delete assignment
      await db.collection('assignments').doc(assignmentId).delete();

      return { success: true };
    } catch (error) {
      console.error('Error deleting assignment:', error);
      throw error;
    }
  }
}

module.exports = new AssignmentService();