const express = require('express');
const { firestore } = require('../config/firebase');
const { authMiddleware } = require('../middleware/authMiddleware');
const muxService = require('../services/muxService');
const storageService = require('../services/storageService');
const quizService = require('../services/quizService');

const router = express.Router();

/**
 * Middleware to ensure user has teacher role
 */
const requireTeacher = async (req, res, next) => {
  try {
    const userDoc = await firestore.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User document does not exist'
      });
    }

    const userData = userDoc.data();
    if (userData.role !== 'teacher') {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Teacher role required to access this resource'
      });
    }

    req.teacher = userData;
    next();
  } catch (error) {
    console.error('Error checking teacher role:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify teacher role'
    });
  }
};

/**
 * Get teacher's assigned subjects
 * GET /api/teacher/my-subjects
 * Teacher-only endpoint to view all subjects assigned to the logged-in teacher
 */
router.get('/my-subjects', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { limit = 20, offset = 0, batchId, courseId, isActive, searchQuery } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;
    const teacherId = req.user.uid;

    // Build query for subjects assigned to this teacher
    let query = firestore.collection('subjects')
      .where('teacherId', '==', teacherId);

    // Filter by batchId if provided
    if (batchId) {
      query = query.where('batchId', '==', batchId);
    }

    // Filter by active status if provided
    if (isActive !== undefined) {
      const activeStatus = isActive === 'true';
      query = query.where('isActive', '==', activeStatus);
    } else {
      // Default to active subjects only
      query = query.where('isActive', '==', true);
    }

    // Note: Removed orderBy to avoid composite index requirement
    // We'll sort the results in memory instead

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    const subjects = [];

    // Get batch information for each subject
    for (const doc of snapshot.docs) {
      const subjectData = doc.data();
      
      // Get batch information
      let batchInfo = null;
      try {
        const batchDoc = await firestore.collection('batches').doc(subjectData.batchId).get();
        if (batchDoc.exists) {
          const batchData = batchDoc.data();
          batchInfo = {
            batchId: batchDoc.id,
            title: batchData.title,
            status: batchData.status,
            startDate: batchData.startDate,
            endDate: batchData.endDate || null,
            currentStudents: batchData.currentStudents || 0,
            maxStudents: batchData.maxStudents || null
          };

          // Get course information
          if (batchData.courseId) {
            try {
              const courseDoc = await firestore.collection('courses').doc(batchData.courseId).get();
              if (courseDoc.exists) {
                const courseData = courseDoc.data();
                batchInfo.courseInfo = {
                  courseId: courseDoc.id,
                  title: courseData.title,
                  category: courseData.category
                };
              }
            } catch (error) {
              console.warn(`Failed to fetch course info for batch ${subjectData.batchId}:`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch batch info for subject ${doc.id}:`, error);
      }

      subjects.push({
        subjectId: doc.id,
        ...subjectData,
        batchInfo: batchInfo
      });
    }

    // Apply additional filtering that requires batch/course data
    let filteredSubjects = subjects;
    
    // Filter by courseId if provided
    if (courseId) {
      filteredSubjects = filteredSubjects.filter(subject => 
        subject.batchInfo?.courseInfo?.courseId === courseId
      );
    }
    
    // Filter by search query if provided
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      filteredSubjects = filteredSubjects.filter(subject => 
        subject.title?.toLowerCase().includes(searchLower) ||
        subject.description?.toLowerCase().includes(searchLower) ||
        subject.batchInfo?.title?.toLowerCase().includes(searchLower) ||
        subject.batchInfo?.courseInfo?.title?.toLowerCase().includes(searchLower)
      );
    }

    // Sort subjects by assignment date (newest first) since we can't use orderBy in query
    filteredSubjects.sort((a, b) => {
      const dateA = new Date(a.assignedAt || 0).getTime();
      const dateB = new Date(b.assignedAt || 0).getTime();
      return dateB - dateA; // Descending order
    });

    // Get total count for pagination
    let totalQuery = firestore.collection('subjects')
      .where('teacherId', '==', teacherId);
    
    if (batchId) {
      totalQuery = totalQuery.where('batchId', '==', batchId);
    }
    
    if (isActive !== undefined) {
      const activeStatus = isActive === 'true';
      totalQuery = totalQuery.where('isActive', '==', activeStatus);
    } else {
      totalQuery = totalQuery.where('isActive', '==', true);
    }
    
    const totalSnapshot = await totalQuery.get();
    const totalSubjects = totalSnapshot.size;

    // Get teacher's profile information
    const teacherProfile = {
      uid: req.user.uid,
      name: req.teacher.name || req.user.name,
      email: req.teacher.email || req.user.email,
      role: req.teacher.role
    };

    res.status(200).json({
      success: true,
      data: {
        subjects: filteredSubjects,
        teacherProfile: teacherProfile,
        pagination: {
          total: filteredSubjects.length,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < filteredSubjects.length
        },
        summary: {
          totalAssignedSubjects: filteredSubjects.length,
          activeSubjects: filteredSubjects.filter(s => s.isActive).length,
          uniqueBatches: [...new Set(filteredSubjects.map(s => s.batchId))].length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching teacher subjects:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch assigned subjects'
    });
  }
});

/**
 * Get specific subject details for teacher
 * GET /api/teacher/subjects/:subjectId
 * Teacher-only endpoint to view details of a specific assigned subject
 */
router.get('/subjects/:subjectId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const teacherId = req.user.uid;

    // Validate subjectId
    if (!subjectId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Subject ID is required'
      });
    }

    // Get subject document
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    const subjectData = subjectDoc.data();

    // Verify teacher is assigned to this subject
    if (subjectData.teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only access subjects assigned to you'
      });
    }

    // Get batch information
    let batchInfo = null;
    try {
      const batchDoc = await firestore.collection('batches').doc(subjectData.batchId).get();
      if (batchDoc.exists) {
        const batchData = batchDoc.data();
        batchInfo = {
          batchId: batchDoc.id,
          ...batchData
        };

        // Get course information
        if (batchData.courseId) {
          const courseDoc = await firestore.collection('courses').doc(batchData.courseId).get();
          if (courseDoc.exists) {
            batchInfo.courseInfo = {
              courseId: courseDoc.id,
              ...courseDoc.data()
            };
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch batch info for subject ${subjectId}:`, error);
    }

    res.status(200).json({
      success: true,
      data: {
        subjectId: subjectId,
        ...subjectData,
        batchInfo: batchInfo
      }
    });

  } catch (error) {
    console.error('Error fetching subject details:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch subject details'
    });
  }
});

/**
 * Update subject description (teacher can update their own subjects)
 * PUT /api/teacher/subjects/:subjectId
 * Teacher-only endpoint to update description of assigned subjects
 */
router.put('/subjects/:subjectId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { description } = req.body;
    const teacherId = req.user.uid;

    // Validate subjectId
    if (!subjectId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Subject ID is required'
      });
    }

    // Get subject document
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    const subjectData = subjectDoc.data();

    // Verify teacher is assigned to this subject
    if (subjectData.teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only update subjects assigned to you'
      });
    }

    // Update subject description
    const updateData = {
      description: description ? description.trim() : '',
      updatedAt: new Date().toISOString()
    };

    await firestore.collection('subjects').doc(subjectId).update(updateData);

    // Get updated subject data
    const updatedSubject = await firestore.collection('subjects').doc(subjectId).get();

    res.status(200).json({
      success: true,
      message: 'Subject updated successfully',
      data: {
        subjectId: subjectId,
        ...updatedSubject.data()
      }
    });

  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update subject'
    });
  }
});

/**
 * Generate Mux upload URL for video content
 * POST /api/teacher/generate-upload-url
 * Teacher-only endpoint to get a signed upload URL for video content
 */
router.post('/generate-upload-url', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { title, subjectId, batchId, contentType } = req.body;

    // Validate required fields
    if (!title || !subjectId || !batchId || !contentType) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title, subjectId, batchId, and contentType are required'
      });
    }

    // Validate content type for video
    const videoContentTypes = ['VIDEO_LECTURE', 'DPP_VIDEO_SOLUTION'];
    if (!videoContentTypes.includes(contentType)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Content type must be VIDEO_LECTURE or DPP_VIDEO_SOLUTION for video uploads'
      });
    }

    // Verify teacher has access to the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== req.user.uid) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You are not assigned to this subject'
      });
    }

    // Create initial schedule document
    const scheduleData = {
      batchId,
      subjectId,
      title: title.trim(),
      contentType,
      scheduledAt: new Date(),
      status: 'uploading',
      teacherId: req.user.uid,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const scheduleRef = await firestore.collection('schedule').add(scheduleData);
    const scheduleId = scheduleRef.id;

    // Generate Mux upload URL
    const uploadData = await muxService.generateUploadUrl(scheduleId, {
      title,
      subject_id: subjectId,
      batch_id: batchId,
      content_type: contentType
    });

    res.status(200).json({
      success: true,
      message: 'Upload URL generated successfully',
      data: {
        scheduleId,
        uploadUrl: uploadData.uploadUrl,
        uploadId: uploadData.uploadId
      }
    });

  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate upload URL'
    });
  }
});

/**
 * Generate Firebase Storage upload URL for PDF files
 * POST /api/teacher/generate-pdf-upload-url
 * Teacher-only endpoint to get a signed upload URL for PDF content
 */
router.post('/generate-pdf-upload-url', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { fileName, subjectId, batchId, contentType } = req.body;

    // Validate required fields
    if (!fileName || !subjectId || !batchId || !contentType) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'fileName, subjectId, batchId, and contentType are required'
      });
    }

    // Validate content type for PDFs
    const pdfContentTypes = ['LECTURE_NOTES_PDF', 'DPP_PDF'];
    if (!pdfContentTypes.includes(contentType)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Content type must be LECTURE_NOTES_PDF or DPP_PDF for PDF uploads'
      });
    }

    // Verify teacher has access to the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== req.user.uid) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You are not assigned to this subject'
      });
    }

    // Generate Firebase Storage upload URL
    const uploadData = await storageService.generateUploadUrl(fileName, 'application/pdf', {
      teacherId: req.user.uid,
      subjectId,
      batchId,
      contentType
    });

    res.status(200).json({
      success: true,
      message: 'PDF upload URL generated successfully',
      data: {
        uploadUrl: uploadData.uploadUrl,
        filePath: uploadData.filePath,
        fileName: uploadData.fileName
      }
    });

  } catch (error) {
    console.error('Error generating PDF upload URL:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate PDF upload URL'
    });
  }
});

/**
 * Schedule new content item
 * POST /api/teacher/schedule
 * Teacher-only endpoint to schedule new content (PDFs or initial video entries)
 */
router.post('/schedule', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { batchId, subjectId, title, contentType, scheduledAt, fileUrl } = req.body;

    // Validate required fields
    if (!batchId || !subjectId || !title || !contentType) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'batchId, subjectId, title, and contentType are required'
      });
    }

    // Validate content type
    const validContentTypes = ['VIDEO_LECTURE', 'LECTURE_NOTES_PDF', 'DPP_PDF', 'DPP_VIDEO_SOLUTION'];
    if (!validContentTypes.includes(contentType)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid content type. Must be one of: ' + validContentTypes.join(', ')
      });
    }

    // For PDF content types, fileUrl is required
    const pdfContentTypes = ['LECTURE_NOTES_PDF', 'DPP_PDF'];
    if (pdfContentTypes.includes(contentType) && !fileUrl) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'fileUrl is required for PDF content types'
      });
    }

    // Verify teacher has access to the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== req.user.uid) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You are not assigned to this subject'
      });
    }

    // Verify batch exists
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch does not exist'
      });
    }

    // Create schedule document
    const scheduleData = {
      batchId,
      subjectId,
      title: title.trim(),
      contentType,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      status: pdfContentTypes.includes(contentType) ? 'ready' : 'pending',
      teacherId: req.user.uid,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add fileUrl for PDF content
    if (fileUrl) {
      scheduleData.fileUrl = fileUrl;
    }

    const scheduleRef = await firestore.collection('schedule').add(scheduleData);

    res.status(201).json({
      success: true,
      message: 'Content scheduled successfully',
      data: {
        scheduleId: scheduleRef.id,
        ...scheduleData
      }
    });

  } catch (error) {
    console.error('Error scheduling content:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to schedule content'
    });
  }
});

/**
 * Get subject's content schedule
 * GET /api/teacher/subjects/:subjectId/schedule
 * Teacher-only endpoint to fetch full content schedule for a subject
 */
router.get('/subjects/:subjectId/schedule', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { limit = 20, offset = 0, contentType, status } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;

    // Verify teacher has access to the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== req.user.uid) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You are not assigned to this subject'
      });
    }

    // Build query
    let query = firestore.collection('schedule')
      .where('subjectId', '==', subjectId)
      .orderBy('scheduledAt', 'desc');

    // Add filters
    if (contentType) {
      query = query.where('contentType', '==', contentType);
    }
    if (status) {
      query = query.where('status', '==', status);
    }

    // Execute query with pagination
    const snapshot = await query.limit(maxLimit).offset(offsetNum).get();
    
    const scheduleItems = [];
    snapshot.forEach(doc => {
      scheduleItems.push({
        scheduleId: doc.id,
        ...doc.data(),
        scheduledAt: doc.data().scheduledAt?.toDate?.() || doc.data().scheduledAt,
        createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.() || doc.data().updatedAt
      });
    });

    // Get total count for pagination
    let countQuery = firestore.collection('schedule').where('subjectId', '==', subjectId);
    if (contentType) {
      countQuery = countQuery.where('contentType', '==', contentType);
    }
    if (status) {
      countQuery = countQuery.where('status', '==', status);
    }
    const countSnapshot = await countQuery.get();
    const totalCount = countSnapshot.size;

    res.status(200).json({
      success: true,
      message: 'Schedule retrieved successfully',
      data: {
        scheduleItems,
        pagination: {
          total: totalCount,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalCount
        },
        subject: {
          subjectId,
          name: subjectData.name,
          code: subjectData.code
        }
      }
    });

  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch schedule'
    });
  }
});

/**
 * Get video analytics for a batch
 * GET /api/teacher/batches/:batchId/video-analytics
 * Teacher-only endpoint to view video progress analytics for students in a batch
 */
router.get('/batches/:batchId/video-analytics', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { videoId, subjectId } = req.query;
    
    // Import videoProgressService here to avoid circular dependency
    const videoProgressService = require('../services/videoProgressService');
    
    const result = await videoProgressService.getVideoAnalytics(
      batchId,
      videoId,
      subjectId
    );
    
    res.json({
      success: true,
      message: 'Video analytics fetched successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error fetching video analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ANALYTICS_ERROR',
        message: 'Failed to fetch video analytics',
        details: error.message
      }
    });
  }
});

/**
 * Get individual student's video progress
 * GET /api/teacher/students/:studentId/video-progress
 * Teacher-only endpoint to view a specific student's video progress
 */
router.get('/students/:studentId/video-progress', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { batchId, videoId } = req.query;
    
    // Import videoProgressService here to avoid circular dependency
    const videoProgressService = require('../services/videoProgressService');
    
    const result = await videoProgressService.getProgress(
      studentId,
      videoId,
      batchId
    );
    
    res.json({
      success: true,
      message: 'Student video progress fetched successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error fetching student video progress:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_STUDENT_PROGRESS_ERROR',
        message: 'Failed to fetch student video progress',
        details: error.message
      }
    });
  }
});

/**
 * Get batch progress overview
 * GET /api/teacher/batches/:batchId/progress-overview
 * Teacher-only endpoint to get overall progress statistics for a batch
 */
router.get('/batches/:batchId/progress-overview', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // Import videoProgressService here to avoid circular dependency
    const videoProgressService = require('../services/videoProgressService');
    
    // Get all students in the batch first
    const enrollmentsSnapshot = await firestore
      .collection('enrollments')
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();
    
    const studentIds = enrollmentsSnapshot.docs.map(doc => doc.data().studentId);
    
    // Get progress summary for each student
    const progressPromises = studentIds.map(async (studentId) => {
      const result = await videoProgressService.getBatchProgressSummary(studentId, batchId);
      return {
        studentId,
        ...result.data
      };
    });
    
    const studentProgress = await Promise.all(progressPromises);
    
    // Calculate overall batch statistics
    const totalStudents = studentProgress.length;
    const totalVideosWatched = studentProgress.reduce((sum, student) => sum + (student.videosWatched || 0), 0);
    const totalWatchTime = studentProgress.reduce((sum, student) => sum + (student.totalWatchTime || 0), 0);
    const averageCompletion = totalStudents > 0 
      ? studentProgress.reduce((sum, student) => sum + (student.completionPercentage || 0), 0) / totalStudents 
      : 0;
    
    res.json({
      success: true,
      message: 'Batch progress overview fetched successfully',
      data: {
        batchId,
        totalStudents,
        totalVideosWatched,
        totalWatchTime,
        averageCompletion: Math.round(averageCompletion * 100) / 100,
        studentProgress
      }
    });
    
  } catch (error) {
    console.error('Error fetching batch progress overview:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BATCH_OVERVIEW_ERROR',
        message: 'Failed to fetch batch progress overview',
        details: error.message
      }
    });
  }
});

// Quiz management endpoints
/**
 * Create a new quiz
 * POST /api/teacher/quizzes
 * Body: { title, description, batchId, subjectId, questions, settings }
 */
router.post('/quizzes', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    const quizData = {
      ...req.body,
      createdBy: teacherId
    };

    // Verify teacher has access to the batch
    const batchDoc = await firestore.collection('batches').doc(req.body.batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BATCH_NOT_FOUND',
          message: 'Batch not found'
        }
      });
    }

    const batchData = batchDoc.data();
    if (batchData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to create quizzes for this batch'
        }
      });
    }

    const result = await quizService.createQuiz(quizData);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create quiz',
        details: error.message
      }
    });
  }
});

/**
 * Get quiz analytics for teachers
 * GET /api/teacher/quizzes/:quizId/analytics
 */
router.get('/quizzes/:quizId/analytics', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { quizId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher owns the quiz
    const quizDoc = await firestore.collection('quizzes').doc(quizId).get();
    if (!quizDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'QUIZ_NOT_FOUND',
          message: 'Quiz not found'
        }
      });
    }

    const quizData = quizDoc.data();
    if (quizData.createdBy !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to view analytics for this quiz'
        }
      });
    }

    const result = await quizService.getQuizAnalytics(quizId);
    res.json(result);
  } catch (error) {
    console.error('Error getting quiz analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get quiz analytics',
        details: error.message
      }
    });
  }
});

/**
 * Get all quizzes created by teacher
 * GET /api/teacher/quizzes
 * Query params: batchId (optional), subjectId (optional)
 */
router.get('/quizzes', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { batchId, subjectId } = req.query;
    const teacherId = req.user.uid;

    let query = firestore
      .collection('quizzes')
      .where('createdBy', '==', teacherId);

    if (batchId) {
      query = query.where('batchId', '==', batchId);
    }

    if (subjectId) {
      query = query.where('subjectId', '==', subjectId);
    }

    const snapshot = await query.orderBy('createdAt', 'desc').get();
    const quizzes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    console.error('Error getting teacher quizzes:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get quizzes',
        details: error.message
      }
    });
  }
});

/**
 * Update quiz status (publish/unpublish/archive)
 * PATCH /api/teacher/quizzes/:quizId/status
 * Body: { status: 'draft' | 'published' | 'archived' }
 */
router.patch('/quizzes/:quizId/status', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { quizId } = req.params;
    const { status } = req.body;
    const teacherId = req.user.uid;

    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status. Must be draft, published, or archived'
        }
      });
    }

    // Verify teacher owns the quiz
    const quizDoc = await firestore.collection('quizzes').doc(quizId).get();
    if (!quizDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'QUIZ_NOT_FOUND',
          message: 'Quiz not found'
        }
      });
    }

    const quizData = quizDoc.data();
    if (quizData.createdBy !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to modify this quiz'
        }
      });
    }

    await firestore.collection('quizzes').doc(quizId).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      data: {
        quizId,
        status
      }
    });
  } catch (error) {
    console.error('Error updating quiz status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update quiz status',
        details: error.message
      }
    });
  }
});

module.exports = router;