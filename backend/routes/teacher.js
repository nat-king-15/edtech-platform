const express = require('express');
const { firestore, admin } = require('../config/firebase');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validation');
const { body, param, query } = require('express-validator');
const muxService = require('../services/muxService');
const storageService = require('../services/storageService');
const quizService = require('../services/quizService');
const validator = require('validator');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow PDF, DOC, DOCX files
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'));
    }
  }
});

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
 * Get chapter content
 * GET /api/teacher/chapters/:chapterId/content
 * Teacher-only endpoint to get chapter content for management
 */
router.get('/chapters/:chapterId/content', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const teacherId = req.user.uid;

    // Get chapter document
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();
    
    // Verify teacher has access to this chapter's subject
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only access chapters for subjects assigned to you'
      });
    }

    // Get chapter content from schedule collection
    const contentQuery = await firestore.collection('schedule')
      .where('chapterId', '==', chapterId)
      .get();

    const content = {
      topicVideos: [],
      topicNotes: [],
      dpp: [],
      dppVideos: [],
      liveTopics: []
    };

    contentQuery.forEach(doc => {
      const contentData = { id: doc.id, ...doc.data() };
      
      switch (contentData.contentType) {
        case 'VIDEO_LECTURE':
          content.topicVideos.push(contentData);
          break;
        case 'NOTES':
          content.topicNotes.push(contentData);
          break;
        case 'DPP':
          content.dpp.push(contentData);
          break;
        case 'DPP_VIDEO_SOLUTION':
          content.dppVideos.push(contentData);
          break;
        case 'LIVE_TOPIC':
          content.liveTopics.push(contentData);
          break;
      }
    });

    res.json({
      success: true,
      chapter: {
        chapterId: chapterDoc.id,
        ...chapterData,
        content
      }
    });

  } catch (error) {
    console.error('Error fetching chapter content:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch chapter content'
    });
  }
});

/**
 * Delete chapter content
 * DELETE /api/teacher/chapters/:chapterId/content/:contentId
 * Teacher-only endpoint to delete specific content from a chapter
 */
router.delete('/chapters/:chapterId/content/:contentId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId, contentId } = req.params;
    const teacherId = req.user.uid;

    // Verify chapter exists and teacher has access
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only manage content for subjects assigned to you'
      });
    }

    // Delete content from schedule collection
    await firestore.collection('schedule').doc(contentId).delete();

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting chapter content:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete content'
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
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
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
      scheduledAt: admin.firestore.Timestamp.fromDate(new Date()),
      status: 'uploading',
      teacherId: req.user.uid,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
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
      scheduledAt: scheduledAt ? admin.firestore.Timestamp.fromDate(new Date(scheduledAt)) : admin.firestore.Timestamp.fromDate(new Date()),
      status: pdfContentTypes.includes(contentType) ? 'ready' : 'pending',
      teacherId: req.user.uid,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
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
router.post('/quizzes', 
  [
    body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
    body('batchId').isAlphanumeric().withMessage('Invalid batch ID format'),
    body('subjectId').isAlphanumeric().withMessage('Invalid subject ID format'),
    body('questions').isArray({ min: 1 }).withMessage('Questions must be a non-empty array'),
    body('settings').optional().isObject().withMessage('Settings must be an object'),
    validateRequest
  ],
  authMiddleware, requireTeacher, async (req, res) => {
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

// Chat Management Endpoints

/**
 * Get teacher chat statistics
 * GET /api/teacher/chat/stats
 */
router.get('/chat/stats', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    const db = firestore;
    
    // Get rooms created by teacher
    const myRoomsSnapshot = await db.collection('chatRooms')
      .where('createdBy.id', '==', teacherId)
      .get();
    const myRooms = myRoomsSnapshot.size;
    
    // Get rooms where teacher is a participant
    const joinedRoomsSnapshot = await db.collection('chatRooms')
      .where('participants', 'array-contains', teacherId)
      .get();
    const joinedRooms = joinedRoomsSnapshot.size;
    
    // Count total messages in teacher's rooms
    let totalMessages = 0;
    let moderationActions = 0;
    
    for (const roomDoc of myRoomsSnapshot.docs) {
      const messagesSnapshot = await db.collection('chatRooms')
        .doc(roomDoc.id)
        .collection('messages')
        .get();
      totalMessages += messagesSnapshot.size;
      
      // Count moderation actions (deleted/reported messages)
      const moderatedSnapshot = await db.collection('chatRooms')
        .doc(roomDoc.id)
        .collection('messages')
        .where('isDeleted', '==', true)
        .get();
      moderationActions += moderatedSnapshot.size;
    }
    
    // Calculate student engagement (simplified metric)
    const studentEngagement = Math.min(100, Math.round((totalMessages / Math.max(joinedRooms, 1)) * 2));
    
    res.json({
      success: true,
      data: {
        myRooms,
        joinedRooms,
        totalMessages,
        studentEngagement,
        moderationActions
      },
      message: 'Chat statistics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching teacher chat stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CHAT_STATS_ERROR',
        message: 'Failed to fetch chat statistics'
      }
    });
  }
});

/**
 * Get teacher chat rooms
 * GET /api/teacher/chat/rooms
 */
router.get('/chat/rooms', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    const db = firestore;
    
    // Get all rooms where teacher is creator or participant
    const roomsSnapshot = await db.collection('chatRooms')
      .where('isActive', '==', true)
      .orderBy('lastActivity', 'desc')
      .get();
    
    const rooms = [];
    
    for (const doc of roomsSnapshot.docs) {
      const roomData = doc.data();
      
      // Check if teacher is creator or participant
      const isCreatedByMe = roomData.createdBy?.id === teacherId;
      const isParticipant = roomData.participants?.includes(teacherId);
      
      if (isCreatedByMe || isParticipant) {
        // Get participant count
        const participantCount = roomData.participants?.length || 0;
        
        // Get message count
        const messagesSnapshot = await db.collection('chatRooms')
          .doc(doc.id)
          .collection('messages')
          .get();
        const messageCount = messagesSnapshot.size;
        
        // Get last message
        const lastMessageSnapshot = await db.collection('chatRooms')
          .doc(doc.id)
          .collection('messages')
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();
        
        let lastMessage = null;
        if (!lastMessageSnapshot.empty) {
          const lastMsg = lastMessageSnapshot.docs[0].data();
          lastMessage = {
            content: lastMsg.content || '',
            sender: lastMsg.sender?.name || 'Unknown',
            timestamp: lastMsg.timestamp
          };
        }
        
        // Get unread count (simplified - assume all messages after last seen)
        const unreadCount = 0; // This would require implementing last seen functionality
        
        // Get reported messages count
        const reportedSnapshot = await db.collection('chatRooms')
          .doc(doc.id)
          .collection('messages')
          .where('isReported', '==', true)
          .get();
        const reportedMessages = reportedSnapshot.size;
        
        rooms.push({
          id: doc.id,
          name: roomData.name || 'Unnamed Room',
          description: roomData.description || '',
          type: roomData.type || 'public',
          participantCount,
          messageCount,
          lastActivity: roomData.lastActivity || roomData.createdAt,
          lastMessage,
          isCreatedByMe,
          isJoined: isParticipant,
          unreadCount,
          courseId: roomData.courseId,
          batchId: roomData.batchId,
          settings: roomData.settings || {
            allowFileSharing: true,
            allowVoiceMessages: true,
            maxParticipants: 100,
            isModerated: false
          },
          reportedMessages
        });
      }
    }
    
    res.json({
      success: true,
      data: rooms,
      message: 'Chat rooms retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching teacher chat rooms:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CHAT_ROOMS_ERROR',
        message: 'Failed to fetch chat rooms'
      }
    });
  }
});

/**
 * Get subjects for a specific batch (teacher endpoint)
 * GET /api/teacher/batches/:batchId/subjects
 * Teacher-only endpoint to get subjects for a specific batch
 */
router.get('/batches/:batchId/subjects', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { batchId } = req.params;
    const teacherId = req.user.uid;

    // Validate batchId
    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Batch ID is required'
        }
      });
    }

    // Get subjects for this batch assigned to this teacher
    const subjectsQuery = firestore.collection('subjects')
      .where('batchId', '==', batchId)
      .where('teacherId', '==', teacherId)
      .where('isActive', '==', true);

    const snapshot = await subjectsQuery.get();
    const subjects = [];

    snapshot.forEach(doc => {
      const subjectData = doc.data();
      subjects.push({
        id: doc.id,
        title: subjectData.title,
        description: subjectData.description,
        batchId: subjectData.batchId,
        teacherId: subjectData.teacherId,
        teacherName: subjectData.teacherName,
        teacherEmail: subjectData.teacherEmail,
        isActive: subjectData.isActive,
        createdAt: subjectData.createdAt,
        updatedAt: subjectData.updatedAt
      });
    });

    res.status(200).json({
      success: true,
      message: 'Subjects fetched successfully',
      data: subjects
    });

  } catch (error) {
    console.error('Error fetching batch subjects for teacher:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch subjects for batch'
      }
    });
  }
});

// ===== CHAPTER MANAGEMENT ROUTES =====

/**
 * Get chapters for a subject
 * GET /api/teacher/subjects/:subjectId/chapters
 * Teacher-only endpoint to list all chapters for a specific subject
 */
router.get('/subjects/:subjectId/chapters', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { limit = 50, offset = 0, includeUnpublished = 'true' } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;
    const teacherId = req.user.uid;

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only access chapters for subjects assigned to you'
      });
    }

    // Build query for chapters (simplified to avoid composite index requirement)
    let query = firestore.collection('chapters')
      .where('subjectId', '==', subjectId);

    // Fetch all chapters first (no pagination in query to avoid index issues)
    const snapshot = await query.get();
    const allChapters = [];

    snapshot.forEach(doc => {
      const chapterData = doc.data();
      // Only include active chapters
      if (chapterData.isActive === true) {
        allChapters.push({
          chapterId: doc.id,
          ...chapterData
        });
      }
    });

    // Sort chapters by order since we can't use orderBy in the query
    allChapters.sort((a, b) => (a.order || 0) - (b.order || 0));

    // Apply pagination after sorting
    const totalChapters = allChapters.length;
    const chapters = allChapters.slice(offsetNum, offsetNum + maxLimit);

    res.status(200).json({
      success: true,
      data: {
        chapters: chapters,
        subjectInfo: {
          subjectId: subjectId,
          title: subjectData.title
        },
        pagination: {
          total: totalChapters,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalChapters
        }
      }
    });

  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch chapters'
    });
  }
});

/**
 * Create new chapter
 * POST /api/teacher/subjects/:subjectId/chapters
 * Teacher-only endpoint to create a new chapter for a subject
 */
router.post('/subjects/:subjectId/chapters', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { title, description, content, thumbnail, difficulty, objectives, resources, schedule } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Chapter title is required'
      });
    }

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    const subjectData = subjectDoc.data();
    if (subjectData.teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only create chapters for subjects assigned to you'
      });
    }

    // Get next order number (simplified query to avoid index requirement)
    const existingChapters = await firestore.collection('chapters')
      .where('subjectId', '==', subjectId)
      .get();

    let nextOrder = 1;
    if (!existingChapters.empty) {
      // Find the highest order number manually from active chapters only
      let maxOrder = 0;
      existingChapters.forEach(doc => {
        const chapterData = doc.data();
        // Only consider active chapters for order calculation
        if (chapterData.isActive === true && chapterData.order && chapterData.order > maxOrder) {
          maxOrder = chapterData.order;
        }
      });
      nextOrder = maxOrder + 1;
    }

    // Validate difficulty if provided
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Difficulty must be one of: beginner, intermediate, advanced'
      });
    }

    // Create chapter document
    const chapterData = {
      title: title.trim(),
      subjectId: subjectId,
      order: nextOrder,
      description: description ? description.trim() : '',
      content: content || '',
      thumbnail: thumbnail || '',
      difficulty: difficulty || 'beginner',
      objectives: Array.isArray(objectives) ? objectives : [],
      resources: Array.isArray(resources) ? resources : [],
      schedule: schedule || null,
      isActive: true,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      createdBy: teacherId
    };

    const chapterRef = await firestore.collection('chapters').add(chapterData);

    res.status(201).json({
      success: true,
      message: 'Chapter created successfully',
      data: {
        chapterId: chapterRef.id,
        ...chapterData
      }
    });

  } catch (error) {
    console.error('Error creating chapter:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create chapter'
    });
  }
});

/**
 * Get chapter details
 * GET /api/teacher/chapters/:chapterId
 * Teacher-only endpoint to get specific chapter details
 */
router.get('/chapters/:chapterId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const teacherId = req.user.uid;

    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();

    // Verify teacher has access to this chapter's subject
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only access chapters for subjects assigned to you'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        chapterId: chapterId,
        ...chapterData,
        subjectInfo: {
          subjectId: chapterData.subjectId,
          title: subjectDoc.data().title
        }
      }
    });

  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch chapter'
    });
  }
});

/**
 * Update chapter
 * PUT /api/teacher/chapters/:chapterId
 * Teacher-only endpoint to update chapter details
 */
router.put('/chapters/:chapterId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { title, description, content, duration, difficulty, objectives, resources } = req.body;
    const teacherId = req.user.uid;

    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();

    // Verify teacher has access to this chapter's subject
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only update chapters for subjects assigned to you'
      });
    }

    // Validate difficulty if provided
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Difficulty must be one of: beginner, intermediate, advanced'
      });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    };

    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (content !== undefined) updateData.content = content;
    if (duration !== undefined) updateData.duration = duration ? parseInt(duration) : null;
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (objectives !== undefined) updateData.objectives = Array.isArray(objectives) ? objectives : [];
    if (resources !== undefined) updateData.resources = Array.isArray(resources) ? resources : [];
    if (req.body.thumbnail !== undefined) updateData.thumbnail = req.body.thumbnail;

    await firestore.collection('chapters').doc(chapterId).update(updateData);

    // Get updated chapter data
    const updatedChapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    const updatedChapterData = updatedChapterDoc.data();

    res.status(200).json({
      success: true,
      message: 'Chapter updated successfully',
      data: {
        chapterId: chapterId,
        ...updatedChapterData
      }
    });

  } catch (error) {
    console.error('Error updating chapter:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update chapter'
    });
  }
});

/**
 * Delete chapter (soft delete)
 * DELETE /api/teacher/chapters/:chapterId
 * Teacher-only endpoint to delete a chapter
 */
router.delete('/chapters/:chapterId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const teacherId = req.user.uid;

    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();

    // Verify teacher has access to this chapter's subject
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only delete chapters for subjects assigned to you'
      });
    }

    // Soft delete by setting isActive to false
    await firestore.collection('chapters').doc(chapterId).update({
      isActive: false,
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.status(200).json({
      success: true,
      message: 'Chapter deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting chapter:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete chapter'
    });
  }
});

/**
 * Publish/Unpublish chapter
 * PUT /api/teacher/chapters/:chapterId/publish
 * Teacher-only endpoint to toggle chapter publication status
 */
router.put('/chapters/:chapterId/publish', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { isPublished } = req.body;
    const teacherId = req.user.uid;

    if (typeof isPublished !== 'boolean') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'isPublished must be a boolean value'
      });
    }

    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter with the provided ID does not exist'
      });
    }

    const chapterData = chapterDoc.data();

    // Verify teacher has access to this chapter's subject
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only publish chapters for subjects assigned to you'
      });
    }

    await firestore.collection('chapters').doc(chapterId).update({
      isPublished: isPublished,
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.status(200).json({
      success: true,
      message: `Chapter ${isPublished ? 'published' : 'unpublished'} successfully`,
      data: {
        chapterId: chapterId,
        isPublished: isPublished
      }
    });

  } catch (error) {
    console.error('Error updating chapter publication status:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update chapter publication status'
    });
  }
});

// ===== TOPICS ROUTES =====

/**
 * Get topics for a chapter
 * GET /api/teacher/subjects/:subjectId/chapters/:chapterId/topics
 * Teacher-only endpoint to get all topics for a specific chapter
 */
router.get('/subjects/:subjectId/chapters/:chapterId/topics', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only access topics for subjects assigned to you'
      });
    }

    // Verify chapter exists and belongs to the subject
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists || chapterDoc.data().subjectId !== subjectId) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter not found or does not belong to this subject'
      });
    }

    // Get topics for this chapter
    const topicsSnapshot = await firestore.collection('topics')
      .where('chapterId', '==', chapterId)
      .where('isActive', '==', true)
      .orderBy('order', 'asc')
      .get();

    const topics = [];
    topicsSnapshot.forEach(doc => {
      topics.push({
        topicId: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      data: {
        topics,
        chapterInfo: {
          chapterId,
          title: chapterDoc.data().title
        }
      }
    });

  } catch (error) {
    console.error('Error fetching topics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch topics'
    });
  }
});

/**
 * Create new topic
 * POST /api/teacher/subjects/:subjectId/chapters/:chapterId/topics
 * Teacher-only endpoint to create a new topic for a chapter
 */
router.post('/subjects/:subjectId/chapters/:chapterId/topics', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId } = req.params;
    const { title, description, difficulty, objectives, duration } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Topic title is required'
      });
    }

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only create topics for subjects assigned to you'
      });
    }

    // Verify chapter exists and belongs to the subject
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists || chapterDoc.data().subjectId !== subjectId) {
      return res.status(404).json({
        error: 'Chapter Not Found',
        message: 'Chapter not found or does not belong to this subject'
      });
    }

    // Get next order number for topics in this chapter
    const existingTopics = await firestore.collection('topics')
      .where('chapterId', '==', chapterId)
      .where('isActive', '==', true)
      .get();

    let nextOrder = 1;
    if (!existingTopics.empty) {
      let maxOrder = 0;
      existingTopics.forEach(doc => {
        const topicData = doc.data();
        if (topicData.order && topicData.order > maxOrder) {
          maxOrder = topicData.order;
        }
      });
      nextOrder = maxOrder + 1;
    }

    // Validate difficulty if provided
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Difficulty must be one of: beginner, intermediate, advanced'
      });
    }

    // Create topic document
    const topicData = {
      title: title.trim(),
      chapterId: chapterId,
      subjectId: subjectId,
      order: nextOrder,
      description: description ? description.trim() : '',
      difficulty: difficulty || 'beginner',
      objectives: Array.isArray(objectives) ? objectives : [],
      duration: duration ? parseInt(duration) : null,
      isActive: true,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      createdBy: teacherId
    };

    const topicRef = await firestore.collection('topics').add(topicData);

    res.status(201).json({
      success: true,
      message: 'Topic created successfully',
      data: {
        topicId: topicRef.id,
        ...topicData
      }
    });

  } catch (error) {
    console.error('Error creating topic:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create topic'
    });
  }
});

/**
 * Update topic
 * PUT /api/teacher/topics/:topicId
 * Teacher-only endpoint to update topic details
 */
router.put('/topics/:topicId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { title, description, difficulty, objectives, duration } = req.body;
    const teacherId = req.user.uid;

    const topicDoc = await firestore.collection('topics').doc(topicId).get();
    if (!topicDoc.exists) {
      return res.status(404).json({
        error: 'Topic Not Found',
        message: 'Topic with the provided ID does not exist'
      });
    }

    const topicData = topicDoc.data();

    // Verify teacher has access to this topic's subject
    const subjectDoc = await firestore.collection('subjects').doc(topicData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only update topics for subjects assigned to you'
      });
    }

    // Validate difficulty if provided
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Difficulty must be one of: beginner, intermediate, advanced'
      });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    };

    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (objectives !== undefined) updateData.objectives = Array.isArray(objectives) ? objectives : [];
    if (duration !== undefined) updateData.duration = duration ? parseInt(duration) : null;

    await firestore.collection('topics').doc(topicId).update(updateData);

    // Get updated topic data
    const updatedTopicDoc = await firestore.collection('topics').doc(topicId).get();
    const updatedTopicData = updatedTopicDoc.data();

    res.status(200).json({
      success: true,
      message: 'Topic updated successfully',
      data: {
        topicId: topicId,
        ...updatedTopicData
      }
    });

  } catch (error) {
    console.error('Error updating topic:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update topic'
    });
  }
});

/**
 * Delete topic (soft delete)
 * DELETE /api/teacher/topics/:topicId
 * Teacher-only endpoint to delete a topic
 */
router.delete('/topics/:topicId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { topicId } = req.params;
    const teacherId = req.user.uid;

    const topicDoc = await firestore.collection('topics').doc(topicId).get();
    if (!topicDoc.exists) {
      return res.status(404).json({
        error: 'Topic Not Found',
        message: 'Topic with the provided ID does not exist'
      });
    }

    const topicData = topicDoc.data();

    // Verify teacher has access to this topic's subject
    const subjectDoc = await firestore.collection('subjects').doc(topicData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only delete topics for subjects assigned to you'
      });
    }

    // Soft delete by setting isActive to false
    await firestore.collection('topics').doc(topicId).update({
      isActive: false,
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.status(200).json({
      success: true,
      message: 'Topic deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting topic:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete topic'
    });
  }
});

// ===== CONTENT UPLOAD ROUTES =====

/**
 * Generate Mux upload URL for video content
 * POST /api/teacher/generate-upload-url
 * Teacher-only endpoint to generate Mux upload URL for video content
 */
router.post('/generate-upload-url', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { title, chapterId, contentType, scheduledAt } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || !chapterId || !contentType || !scheduledAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: title, chapterId, contentType, scheduledAt' }
      });
    }

    // Verify teacher has access to this chapter
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Create schedule document first
    const scheduleRef = firestore.collection('schedule');
    const scheduleDoc = await scheduleRef.add({
      title,
      chapterId,
      contentType,
      scheduledAt: admin.firestore.Timestamp.fromDate(new Date(scheduledAt)),
      status: 'UPLOADING',
      teacherId,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    // Generate Mux upload URL
    const uploadUrl = await muxService.generateUploadUrl({
      passthrough: scheduleDoc.id,
      metadata: {
        title,
        chapterId,
        contentType,
        teacherId
      }
    });

    res.json({
      success: true,
      data: {
        uploadUrl,
        scheduleId: scheduleDoc.id
      }
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to generate upload URL' }
    });
  }
});

/**
 * Upload content to Firebase Storage
 * POST /api/teacher/upload-content
 * Teacher-only endpoint to upload non-video content to Firebase Storage
 */
router.post('/upload-content', authMiddleware, requireTeacher, upload.single('file'), async (req, res) => {
  try {
    const { title, description, chapterId, contentType, scheduledAt } = req.body;
    const teacherId = req.user.uid;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: { message: 'No file uploaded' }
      });
    }

    // Validate required fields
    if (!title || !chapterId || !contentType || !scheduledAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: title, chapterId, contentType, scheduledAt' }
      });
    }

    // Verify teacher has access to this chapter
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Upload file to Firebase Storage
    const bucket = admin.storage().bucket();
    const fileName = `content/${chapterId}/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(file.buffer);
    });

    // Make file publicly accessible
    await fileUpload.makePublic();
    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Create schedule document
    const scheduleRef = firestore.collection('schedule');
    const scheduleDoc = await scheduleRef.add({
      title,
      description: description || '',
      chapterId,
      contentType,
      scheduledAt: admin.firestore.Timestamp.fromDate(new Date(scheduledAt)),
      status: 'READY',
      teacherId,
      fileUrl,
      fileName,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.json({
      success: true,
      data: {
        scheduleId: scheduleDoc.id,
        fileUrl
      }
    });
  } catch (error) {
    console.error('Error uploading content:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to upload content' }
    });
  }
});

/**
 * Get chapter content
 * GET /api/teacher/chapters/:chapterId/content
 * Teacher-only endpoint to get all content for a specific chapter
 */
router.get('/chapters/:chapterId/content', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher has access to this chapter
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Get all content for this chapter
    const scheduleRef = firestore.collection('schedule');
    const contentQuery = await scheduleRef
      .where('chapterId', '==', chapterId)
      .orderBy('scheduledAt', 'asc')
      .get();

    const content = {
      topicVideos: [],
      topicNotes: [],
      dpp: [],
      dppVideos: [],
      liveTopics: []
    };

    contentQuery.forEach(doc => {
      const data = doc.data();
      const item = {
        id: doc.id,
        title: data.title,
        description: data.description || '',
        scheduledAt: data.scheduledAt,
        status: data.status,
        contentType: data.contentType,
        muxPlaybackId: data.muxPlaybackId,
        fileUrl: data.fileUrl,
        // Live stream specific fields
        liveStreamId: data.liveStreamId,
        streamKey: data.streamKey,
        rtmpUrl: data.rtmpUrl,
        liveStreamStatus: data.liveStreamStatus,
        recordingStatus: data.recordingStatus,
        convertedToTopicVideo: data.convertedToTopicVideo,
        error: data.error
      };

      switch (data.contentType) {
        case 'VIDEO_LECTURE':
          content.topicVideos.push(item);
          break;
        case 'LECTURE_NOTES_PDF':
          content.topicNotes.push(item);
          break;
        case 'DPP_PDF':
          content.dpp.push(item);
          break;
        case 'DPP_VIDEO_SOLUTION':
          content.dppVideos.push(item);
          break;
        case 'LIVE_TOPIC':
          content.liveTopics.push(item);
          break;
      }
    });

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Error fetching chapter content:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch chapter content' }
    });
  }
});

/**
 * Update content
 * PUT /api/teacher/content/:contentId
 * Teacher-only endpoint to update content metadata
 */
router.put('/content/:contentId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { title, description, scheduledAt } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || !scheduledAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: title, scheduledAt' }
      });
    }

    // Get content document
    const contentDoc = await firestore.collection('schedule').doc(contentId).get();
    if (!contentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Content not found' }
      });
    }

    const contentData = contentDoc.data();
    
    // Verify teacher has access to this content
    const chapterDoc = await firestore.collection('chapters').doc(contentData.chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Update content document
    await firestore.collection('schedule').doc(contentId).update({
      title: title.trim(),
      description: description ? description.trim() : '',
      scheduledAt: admin.firestore.Timestamp.fromDate(new Date(scheduledAt)),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.json({
      success: true,
      message: 'Content updated successfully'
    });
  } catch (error) {
    console.error('Error updating content:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update content' }
    });
  }
});

/**
 * Delete chapter content
 * DELETE /api/teacher/chapters/:chapterId/content/:contentId
 * Teacher-only endpoint to delete specific content
 */
router.delete('/chapters/:chapterId/content/:contentId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId, contentId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher has access to this chapter
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Get content document
    const contentDoc = await firestore.collection('schedule').doc(contentId).get();
    if (!contentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Content not found' }
      });
    }

    const contentData = contentDoc.data();
    
    // Verify content belongs to this chapter
    if (contentData.chapterId !== chapterId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Content does not belong to this chapter' }
      });
    }

    // Delete file from Firebase Storage if it exists
    if (contentData.fileName) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.file(contentData.fileName).delete();
      } catch (error) {
        console.error('Error deleting file from storage:', error);
        // Continue with document deletion even if file deletion fails
      }
    }

    // Delete content document
    await firestore.collection('schedule').doc(contentId).delete();

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting content:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete content' }
    });
  }
});

/**
 * Schedule a live topic
 * POST /api/teacher/schedule-live-topic
 * Teacher-only endpoint to schedule a live streaming topic
 */
router.post('/schedule-live-topic', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { chapterId, title, description, scheduledAt } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!chapterId || !title || !scheduledAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: chapterId, title, scheduledAt' }
      });
    }

    // Verify teacher has access to this chapter
    const chapterDoc = await firestore.collection('chapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Chapter not found' }
      });
    }

    const chapterData = chapterDoc.data();
    const subjectDoc = await firestore.collection('subjects').doc(chapterData.subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    const subjectData = subjectDoc.data();
    const scheduledDate = new Date(scheduledAt);
    const now = new Date();

    // Validate scheduled time is in the future
    if (scheduledDate <= now) {
      return res.status(400).json({
        success: false,
        error: { message: 'Scheduled time must be in the future' }
      });
    }

    // Create schedule document
    const scheduleData = {
      chapterId,
      subjectId: chapterData.subjectId,
      batchId: subjectData.batchId,
      teacherId,
      title: title.trim(),
      description: description ? description.trim() : '',
      contentType: 'LIVE_TOPIC',
      scheduledAt: scheduledDate,
      status: 'scheduled',
      liveStreamStatus: 'scheduled',
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    };

    const scheduleRef = await firestore.collection('schedule').add(scheduleData);
    
    // Create Mux live stream immediately
    try {
      const muxService = require('../services/muxService');
      const liveStreamData = await muxService.createLiveStream(scheduleRef.id, {
        metadata: {
          title: scheduleData.title,
          description: scheduleData.description,
          chapterId: scheduleData.chapterId,
          subjectId: scheduleData.subjectId,
          batchId: scheduleData.batchId
        }
      });

      // Update schedule document with live stream details
      await firestore.collection('schedule').doc(scheduleRef.id).update({
        liveStreamId: liveStreamData.liveStreamId,
        streamKey: liveStreamData.streamKey,
        livePlaybackIds: liveStreamData.playbackIds,
        rtmpUrl: liveStreamData.rtmpUrl,
        liveStreamStatus: 'ready',
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      });

      console.log(`✅ Live stream created successfully for schedule: ${scheduleRef.id}`);
    } catch (muxError) {
      console.error('Error creating Mux live stream:', muxError);
      // Update schedule status to indicate Mux creation failed
      await firestore.collection('schedule').doc(scheduleRef.id).update({
        status: 'mux_failed',
        error: muxError.message,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date())
      });
    }
    
    // Add to scheduler service
    const schedulerService = require('../services/schedulerService');
    schedulerService.addScheduledStream(scheduleRef.id, scheduledDate);

    res.json({
      success: true,
      message: 'Live topic scheduled successfully',
      data: {
        scheduleId: scheduleRef.id,
        scheduledAt: admin.firestore.Timestamp.fromDate(scheduledDate)
      }
    });
  } catch (error) {
    console.error('Error scheduling live topic:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to schedule live topic' }
    });
  }
});

/**
 * Get live stream details
 * GET /api/teacher/live-stream/:scheduleId
 * Teacher-only endpoint to get live stream details
 */
router.get('/live-stream/:scheduleId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const teacherId = req.user.uid;

    // Get schedule document
    const scheduleDoc = await firestore.collection('schedule').doc(scheduleId).get();
    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Schedule not found' }
      });
    }

    const scheduleData = scheduleDoc.data();
    
    // Verify teacher has access
    if (scheduleData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Return live stream details
    res.json({
      success: true,
      data: {
        scheduleId,
        title: scheduleData.title,
        description: scheduleData.description,
        scheduledAt: scheduleData.scheduledAt,
        status: scheduleData.status,
        liveStreamStatus: scheduleData.liveStreamStatus,
        liveStreamId: scheduleData.liveStreamId,
        streamKey: scheduleData.streamKey,
        rtmpUrl: scheduleData.rtmpUrl,
        livePlaybackIds: scheduleData.livePlaybackIds,
        recordingPlaybackId: scheduleData.recordingPlaybackId
      }
    });
  } catch (error) {
    console.error('Error getting live stream details:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get live stream details' }
    });
  }
});

/**
 * Update live topic schedule
 * PUT /api/teacher/live-topic/:scheduleId
 * Teacher-only endpoint to update live topic schedule
 */
router.put('/live-topic/:scheduleId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { title, description, scheduledAt } = req.body;
    const teacherId = req.user.uid;

    // Get schedule document
    const scheduleDoc = await firestore.collection('schedule').doc(scheduleId).get();
    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Schedule not found' }
      });
    }

    const scheduleData = scheduleDoc.data();
    
    // Verify teacher has access
    if (scheduleData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Validate scheduled time if provided
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt);
      const now = new Date();
      
      if (scheduledDate <= now) {
        return res.status(400).json({
          success: false,
          error: { message: 'Scheduled time must be in the future' }
        });
      }
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    };

    if (title) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (scheduledAt) {
      updateData.scheduledAt = admin.firestore.Timestamp.fromDate(new Date(scheduledAt));
      
      // Update scheduler service
      const schedulerService = require('../services/schedulerService');
      schedulerService.updateScheduledStream(scheduleId, new Date(scheduledAt));
    }

    // Update schedule document
    await firestore.collection('schedule').doc(scheduleId).update(updateData);

    res.json({
      success: true,
      message: 'Live topic updated successfully'
    });
  } catch (error) {
    console.error('Error updating live topic:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update live topic' }
    });
  }
});

/**
 * Cancel live topic
 * DELETE /api/teacher/live-topic/:scheduleId
 * Teacher-only endpoint to cancel a scheduled live topic
 */
router.delete('/live-topic/:scheduleId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const teacherId = req.user.uid;

    // Get schedule document
    const scheduleDoc = await firestore.collection('schedule').doc(scheduleId).get();
    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Schedule not found' }
      });
    }

    const scheduleData = scheduleDoc.data();
    
    // Verify teacher has access
    if (scheduleData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Cancel from scheduler service
    const schedulerService = require('../services/schedulerService');
    schedulerService.cancelScheduledStream(scheduleId);

    // Delete live stream from Mux if it exists
    if (scheduleData.liveStreamId) {
      try {
        const muxService = require('../services/muxService');
        await muxService.deleteLiveStream(scheduleData.liveStreamId);
      } catch (error) {
        console.warn('Error deleting Mux live stream:', error);
      }
    }

    // Delete schedule document
    await firestore.collection('schedule').doc(scheduleId).delete();

    res.json({
      success: true,
      message: 'Live topic cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling live topic:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to cancel live topic' }
    });
  }
});

/**
 * GET /api/teacher/live-streams
 * Get all live streams for the teacher
 */
router.get('/live-streams', authMiddleware, async (req, res) => {
  try {
    const teacherId = req.user.uid;

    // Get all live streams created by this teacher
    const liveStreamsSnapshot = await firestore.collection('schedule')
      .where('contentType', '==', 'LIVE_TOPIC')
      .where('teacherId', '==', teacherId)
      .orderBy('scheduledAt', 'desc')
      .get();

    const liveStreams = [];

    for (const doc of liveStreamsSnapshot.docs) {
      const scheduleData = doc.data();
      
      // Get chapter details
      const chapterDoc = await firestore.collection('chapters').doc(scheduleData.chapterId).get();
      const chapterData = chapterDoc.exists ? chapterDoc.data() : null;
      
      // Get subject details
      const subjectDoc = await firestore.collection('subjects').doc(scheduleData.subjectId).get();
      const subjectData = subjectDoc.exists ? subjectDoc.data() : null;
      
      // Get batch details
      const batchDoc = await firestore.collection('batches').doc(scheduleData.batchId).get();
      const batchData = batchDoc.exists ? batchDoc.data() : null;

      liveStreams.push({
        id: doc.id,
        title: scheduleData.title,
        description: scheduleData.description,
        scheduledAt: scheduleData.scheduledAt.toDate(),
        status: scheduleData.status,
        liveStreamStatus: scheduleData.liveStreamStatus,
        chapterId: scheduleData.chapterId,
        chapterTitle: chapterData?.title || 'Unknown Chapter',
        subjectId: scheduleData.subjectId,
        subjectTitle: subjectData?.title || 'Unknown Subject',
        batchId: scheduleData.batchId,
        batchName: batchData?.name || 'Unknown Batch',
        streamKey: scheduleData.streamKey,
        rtmpUrl: scheduleData.rtmpUrl,
        recordingStatus: scheduleData.recordingStatus,
        convertedToTopicVideo: scheduleData.convertedToTopicVideo || false,
        createdAt: scheduleData.createdAt.toDate(),
        updatedAt: scheduleData.updatedAt.toDate()
      });
    }

    res.json({
      success: true,
      data: liveStreams
    });
  } catch (error) {
    console.error('Error fetching live streams:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch live streams' }
    });
  }
});

/**
 * Start live stream
 * POST /api/teacher/live-topics/:liveTopicId/start
 * Teacher-only endpoint to start a scheduled live stream
 */
router.post('/live-topics/:liveTopicId/start', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { liveTopicId } = req.params;
    const teacherId = req.user.uid;

    // Get the live topic document
    const liveTopicDoc = await firestore.collection('schedule').doc(liveTopicId).get();
    if (!liveTopicDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Live topic not found' }
      });
    }

    const liveTopicData = liveTopicDoc.data();
    
    // Verify teacher has access to this live topic
    if (liveTopicData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Check if the stream is in scheduled status
    if (liveTopicData.liveStreamStatus !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: { message: 'Stream is not in scheduled status' }
      });
    }

    // Update the live stream status to 'live'
    await firestore.collection('schedule').doc(liveTopicId).update({
      liveStreamStatus: 'live',
      status: 'live',
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.json({
      success: true,
      message: 'Live stream started successfully'
    });
  } catch (error) {
    console.error('Error starting live stream:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to start live stream' }
    });
  }
});

/**
 * End live stream
 * POST /api/teacher/live-topics/:liveTopicId/end
 * Teacher-only endpoint to end a live stream
 */
router.post('/live-topics/:liveTopicId/end', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { liveTopicId } = req.params;
    const teacherId = req.user.uid;

    // Get the live topic document
    const liveTopicDoc = await firestore.collection('schedule').doc(liveTopicId).get();
    if (!liveTopicDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { message: 'Live topic not found' }
      });
    }

    const liveTopicData = liveTopicDoc.data();
    
    // Verify teacher has access to this live topic
    if (liveTopicData.teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Check if the stream is currently live
    if (liveTopicData.liveStreamStatus !== 'live') {
      return res.status(400).json({
        success: false,
        error: { message: 'Stream is not currently live' }
      });
    }

    // Update the live stream status to 'ended'
    await firestore.collection('schedule').doc(liveTopicId).update({
      liveStreamStatus: 'ended',
      status: 'ended',
      updatedAt: admin.firestore.Timestamp.fromDate(new Date())
    });

    res.json({
      success: true,
      message: 'Live stream ended successfully'
    });
  } catch (error) {
    console.error('Error ending live stream:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to end live stream' }
    });
  }
});

/**
 * Get teacher notifications
 * GET /api/teacher/notifications
 */
router.get('/notifications', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const teacherId = req.user.uid;

    let query = firestore.collection('notifications')
      .where('userId', '==', teacherId)
      .orderBy('createdAt', 'desc');

    if (type) {
      query = query.where('type', '==', type);
    }

    const offset = (page - 1) * limit;
    const snapshot = await query.limit(parseInt(limit)).offset(offset).get();

    const notifications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt
    }));

    // Get total count for pagination
    const totalSnapshot = await firestore.collection('notifications')
      .where('userId', '==', teacherId)
      .get();
    const totalItems = totalSnapshot.size;
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      success: true,
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching teacher notifications:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch notifications' }
    });
  }
});

/**
 * Get teacher unread notifications count
 * GET /api/teacher/notifications/unread-count
 */
router.get('/notifications/unread-count', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;

    const snapshot = await firestore.collection('notifications')
      .where('userId', '==', teacherId)
      .where('read', '==', false)
      .get();

    res.json({
      success: true,
      unreadCount: snapshot.size
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch unread count' }
    });
  }
});

/**
 * Mark teacher notification as read
 * PUT /api/teacher/notifications/:notificationId/read
 */
router.put('/notifications/:notificationId/read', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const teacherId = req.user.uid;

    const notificationRef = firestore.collection('notifications').doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found'
        },
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.userId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied'
        },
        timestamp: admin.firestore.Timestamp.fromDate(new Date())
      });
    }

    await notificationRef.update({
      read: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Notification marked as read',
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to mark notification as read'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

/**
 * Mark all teacher notifications as read
 * PUT /api/teacher/notifications/mark-all-read
 */
router.put('/notifications/mark-all-read', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;

    const snapshot = await firestore.collection('notifications')
      .where('userId', '==', teacherId)
      .where('read', '==', false)
      .get();

    const batch = firestore.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: {
        updatedCount: snapshot.size
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to mark all notifications as read'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

/**
 * Get teacher assignment statistics
 * GET /api/teacher/assignments/stats
 * Teacher-only endpoint to get assignment statistics
 */
router.get('/assignments/stats', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    
    // Get teacher's assignments
    const assignmentsSnapshot = await firestore.collection('assignments')
      .where('teacherId', '==', teacherId)
      .get();
    
    let totalAssignments = 0;
    let publishedAssignments = 0;
    let draftAssignments = 0;
    let overdueAssignments = 0;
    let thisWeekAssignments = 0;
    
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    assignmentsSnapshot.forEach(doc => {
      const data = doc.data();
      totalAssignments++;
      
      if (data.status === 'published') {
        publishedAssignments++;
      } else if (data.status === 'draft') {
        draftAssignments++;
      }
      
      // Check if assignment is overdue
      if (data.dueDate && new Date(data.dueDate) < now && data.status === 'published') {
        overdueAssignments++;
      }
      
      // Check if created this week
      if (data.createdAt && new Date(data.createdAt) >= oneWeekAgo) {
        thisWeekAssignments++;
      }
    });
    
    // Get pending grading count
    const submissionsSnapshot = await firestore.collection('assignmentSubmissions')
      .where('teacherId', '==', teacherId)
      .where('status', '==', 'submitted')
      .get();
    
    const pendingGrading = submissionsSnapshot.size;
    
    // Calculate average submission rate
    let totalSubmissionRate = 0;
    let assignmentCount = 0;
    
    for (const doc of assignmentsSnapshot.docs) {
      const assignmentData = doc.data();
      if (assignmentData.status === 'published') {
        const assignmentSubmissions = await firestore.collection('assignmentSubmissions')
          .where('assignmentId', '==', doc.id)
          .get();
        
        // Get enrolled students count for this assignment's batch
        const enrollmentsSnapshot = await firestore.collection('enrollments')
          .where('batchId', '==', assignmentData.batchId)
          .where('status', '==', 'active')
          .get();
        
        const enrolledStudents = enrollmentsSnapshot.size;
        if (enrolledStudents > 0) {
          const submissionRate = (assignmentSubmissions.size / enrolledStudents) * 100;
          totalSubmissionRate += submissionRate;
          assignmentCount++;
        }
      }
    }
    
    const averageSubmissionRate = assignmentCount > 0 ? totalSubmissionRate / assignmentCount : 0;
    
    res.json({
      success: true,
      data: {
        totalAssignments,
        publishedAssignments,
        draftAssignments,
        pendingGrading,
        averageSubmissionRate: Math.round(averageSubmissionRate * 100) / 100,
        thisWeekAssignments,
        overdueAssignments
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
    
  } catch (error) {
    console.error('Error fetching teacher assignment stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ASSIGNMENT_STATS_ERROR',
        message: 'Failed to fetch assignment statistics'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

/**
 * Get teacher assignments
 * GET /api/teacher/assignments
 * Teacher-only endpoint to get all assignments created by teacher
 */
router.get('/assignments', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    const { status, batchId, subjectId, limit = 20, offset = 0 } = req.query;
    
    let query = firestore.collection('assignments')
      .where('teacherId', '==', teacherId);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    if (batchId) {
      query = query.where('batchId', '==', batchId);
    }
    
    if (subjectId) {
      query = query.where('subjectId', '==', subjectId);
    }
    
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const assignments = [];
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Get submission count
      const submissionsSnapshot = await firestore.collection('assignmentSubmissions')
        .where('assignmentId', '==', doc.id)
        .get();
      
      const submissionCount = submissionsSnapshot.size;
      const gradedCount = submissionsSnapshot.docs.filter(subDoc => {
        const subData = subDoc.data();
        return subData.status === 'graded';
      }).length;
      
      // Get subject and batch info
      let subjectInfo = null;
      let batchInfo = null;
      
      if (data.subjectId) {
        try {
          const subjectDoc = await firestore.collection('subjects').doc(data.subjectId).get();
          if (subjectDoc.exists) {
            subjectInfo = {
              id: subjectDoc.id,
              title: subjectDoc.data().title
            };
          }
        } catch (err) {
          console.warn('Could not fetch subject info:', err);
        }
      }
      
      if (data.batchId) {
        try {
          const batchDoc = await firestore.collection('batches').doc(data.batchId).get();
          if (batchDoc.exists) {
            batchInfo = {
              id: batchDoc.id,
              title: batchDoc.data().title
            };
          }
        } catch (err) {
          console.warn('Could not fetch batch info:', err);
        }
      }
      
      assignments.push({
        id: doc.id,
        title: data.title,
        description: data.description,
        type: data.type,
        status: data.status,
        dueDate: data.dueDate,
        maxMarks: data.maxMarks,
        submissionCount,
        gradedCount,
        pendingGrading: submissionCount - gradedCount,
        subject: subjectInfo,
        batch: batchInfo,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      });
    }
    
    res.json({
      success: true,
      data: assignments,
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
    
  } catch (error) {
    console.error('Error fetching teacher assignments:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ASSIGNMENTS_FETCH_ERROR',
        message: 'Failed to fetch assignments'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

/**
 * Get teacher assignment submissions
 * GET /api/teacher/assignments/submissions
 * Teacher-only endpoint to get recent submissions for teacher's assignments
 */
router.get('/assignments/submissions', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    const { limit = 10, status } = req.query;
    
    let query = firestore.collection('assignmentSubmissions')
      .where('teacherId', '==', teacherId);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query
      .orderBy('submittedAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const submissions = [];
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Get student info
      let studentInfo = null;
      if (data.studentId) {
        try {
          const studentDoc = await firestore.collection('users').doc(data.studentId).get();
          if (studentDoc.exists) {
            const studentData = studentDoc.data();
            studentInfo = {
              id: studentDoc.id,
              name: studentData.displayName || studentData.name || studentData.email,
              email: studentData.email
            };
          }
        } catch (err) {
          console.warn('Could not fetch student info:', err);
        }
      }
      
      // Get assignment info
      let assignmentInfo = null;
      if (data.assignmentId) {
        try {
          const assignmentDoc = await firestore.collection('assignments').doc(data.assignmentId).get();
          if (assignmentDoc.exists) {
            assignmentInfo = {
              id: assignmentDoc.id,
              title: assignmentDoc.data().title,
              maxMarks: assignmentDoc.data().maxMarks
            };
          }
        } catch (err) {
          console.warn('Could not fetch assignment info:', err);
        }
      }
      
      submissions.push({
        id: doc.id,
        assignmentId: data.assignmentId,
        studentId: data.studentId,
        studentName: studentInfo?.name || 'Unknown Student',
        assignmentTitle: assignmentInfo?.title || 'Unknown Assignment',
        submittedAt: data.submittedAt,
        status: data.status,
        score: data.score,
        maxMarks: assignmentInfo?.maxMarks,
        feedback: data.feedback,
        isLate: data.isLate || false,
        gradedAt: data.gradedAt,
        attachments: data.attachments || []
      });
    }
    
    res.json({
      success: true,
      data: submissions,
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
    
  } catch (error) {
    console.error('Error fetching teacher assignment submissions:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SUBMISSIONS_FETCH_ERROR',
        message: 'Failed to fetch assignment submissions'
      },
      timestamp: admin.firestore.Timestamp.fromDate(new Date())
    });
  }
});

/**
 * Get teacher reports statistics
 * GET /api/teacher/reports/stats
 * Teacher-only endpoint to get report statistics
 */
router.get('/reports/stats', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.user.uid;
    
    // Get teacher's subjects count
    const subjectsSnapshot = await firestore.collection('subjects')
      .where('teacherId', '==', teacherId)
      .where('isActive', '==', true)
      .get();
    
    const totalSubjects = subjectsSnapshot.size;
    
    // Get teacher's batches (from subjects)
    const batchIds = [...new Set(subjectsSnapshot.docs.map(doc => doc.data().batchId))];
    
    // Get total students across all batches
    let totalStudents = 0;
    if (batchIds.length > 0) {
      const enrollmentsSnapshot = await firestore.collection('enrollments')
        .where('batchId', 'in', batchIds.slice(0, 10)) // Firestore 'in' limit is 10
        .where('status', '==', 'active')
        .get();
      totalStudents = enrollmentsSnapshot.size;
    }
    
    // Get recent activity (scheduled content from last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentScheduleSnapshot = await firestore.collection('schedule')
      .where('teacherId', '==', teacherId)
      .where('createdAt', '>=', thirtyDaysAgo)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    const recentActivity = recentScheduleSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        type: data.type || 'content',
        createdAt: data.createdAt.toDate().toISOString(),
        status: data.status || 'scheduled'
      };
    });
    
    res.json({
      success: true,
      data: {
        totalSubjects,
        totalStudents,
        activeBatches: batchIds.length,
        recentActivity,
        monthlyContent: recentScheduleSnapshot.size
      }
    });
    
  } catch (error) {
    console.error('Error fetching teacher reports stats:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch reports statistics' }
    });
  }
});

// ===== TOPIC CONTENT MANAGEMENT ROUTES =====

/**
 * Get topic content
 * GET /api/teacher/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content
 */
router.get('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Get topic content from subcollections
    const topicRef = firestore.collection('topics').doc(topicId);
    
    const [videosSnapshot, notesSnapshot, dppSnapshot, dppVideosSnapshot] = await Promise.all([
      topicRef.collection('videos').orderBy('uploadedAt', 'desc').get(),
      topicRef.collection('notes').orderBy('uploadedAt', 'desc').get(),
      topicRef.collection('dpp').orderBy('createdAt', 'desc').get(),
      topicRef.collection('dppVideos').orderBy('uploadedAt', 'desc').get()
    ]);

    const content = {
      videos: videosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      notes: notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      dpp: dppSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      dppVideos: dppVideosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    };

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Error fetching topic content:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch topic content' }
    });
  }
});

/**
 * Upload video content to topic
 * POST /api/teacher/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/videos
 */
router.post('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/videos', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId } = req.params;
    const { title, description } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { message: 'Title is required and must be a non-empty string' }
      });
    }

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Generate unique timestamp for this upload
    const uploadTimestamp = Date.now();
    
    // Create Mux upload URL
    const uploadData = await muxService.generateUploadUrl({
      passthrough: `${topicId}_video_${uploadTimestamp}`,
      metadata: {
        title,
        description: description || '',
        topicId,
        chapterId,
        subjectId,
        teacherId,
        contentType: 'topic_video'
      }
    });

    // Create initial video document
    const videoData = {
      title: title.trim(),
      description: description ? description.trim() : '',
      status: 'processing',
      uploadedAt: admin.firestore.Timestamp.fromDate(new Date()),
      muxUploadId: uploadTimestamp.toString(), // Store the timestamp as uploadId for webhook matching
      teacherId
    };

    const videoRef = await firestore.collection('topics').doc(topicId).collection('videos').add(videoData);

    res.json({
      success: true,
      data: {
        videoId: videoRef.id,
        uploadUrl: uploadData.uploadUrl,
        uploadId: uploadData.uploadId
      }
    });
  } catch (error) {
    console.error('Error creating video upload:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create video upload' }
    });
  }
});

/**
 * Upload notes (PDF) to topic
 * POST /api/teacher/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/notes
 */
router.post('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/notes', authMiddleware, requireTeacher, upload.single('file'), async (req, res) => {
  try {
    const { subjectId, chapterId, topicId } = req.params;
    const { title, description } = req.body;
    const teacherId = req.user.uid;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: { message: 'No file uploaded' }
      });
    }

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Upload file to Firebase Storage
    const bucket = admin.storage().bucket();
    const fileName = `topics/${topicId}/notes/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(file.buffer);
    });

    // Make file publicly accessible
    await fileUpload.makePublic();
    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Create notes document
    const notesData = {
      title: title.trim(),
      description: description ? description.trim() : '',
      fileUrl,
      fileName: file.originalname,
      fileType: file.mimetype === 'application/pdf' ? 'pdf' : 'doc',
      fileSize: file.size,
      uploadedAt: admin.firestore.Timestamp.fromDate(new Date()),
      teacherId
    };

    const notesRef = await firestore.collection('topics').doc(topicId).collection('notes').add(notesData);

    res.json({
      success: true,
      data: {
        notesId: notesRef.id,
        fileUrl
      }
    });
  } catch (error) {
    console.error('Error uploading notes:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to upload notes' }
    });
  }
});

/**
 * Create DPP for topic
 * POST /api/teacher/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dpp
 */
router.post('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dpp', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId } = req.params;
    const { title, description, questions, timeLimit, totalMarks } = req.body;
    const teacherId = req.user.uid;

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Validate questions
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Questions are required and must be a non-empty array' }
      });
    }

    // Create DPP document
    const dppData = {
      title: title.trim(),
      description: description ? description.trim() : '',
      questions: questions.map((q, index) => ({
        id: `q_${index + 1}`,
        question: q.question.trim(),
        options: q.options.map(opt => opt.trim()),
        correctAnswer: q.correctAnswer,
        explanation: q.explanation ? q.explanation.trim() : ''
      })),
      timeLimit: timeLimit || 60,
      totalMarks: totalMarks || questions.length,
      isPublished: false,
      createdAt: admin.firestore.Timestamp.fromDate(new Date()),
      teacherId
    };

    const dppRef = await firestore.collection('topics').doc(topicId).collection('dpp').add(dppData);

    res.json({
      success: true,
      data: {
        dppId: dppRef.id
      }
    });
  } catch (error) {
    console.error('Error creating DPP:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create DPP' }
    });
  }
});

/**
 * Upload DPP video to topic
 * POST /api/teacher/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dppVideos
 */
router.post('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dppVideos', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId } = req.params;
    const { title, description, dppId } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { message: 'Title is required and must be a non-empty string' }
      });
    }

    // Verify teacher has access to this subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied' }
      });
    }

    // Generate unique timestamp for this upload
    const uploadTimestamp = Date.now();
    
    // Create Mux upload URL
    const uploadData = await muxService.generateUploadUrl({
      passthrough: `${topicId}_dpp_video_${uploadTimestamp}`,
      metadata: {
        title,
        description: description || '',
        topicId,
        chapterId,
        subjectId,
        dppId: dppId || '',
        teacherId,
        contentType: 'dpp_video'
      }
    });

    // Create initial DPP video document
    const dppVideoData = {
      title: title.trim(),
      description: description ? description.trim() : '',
      dppId: dppId || '',
      status: 'processing',
      uploadedAt: admin.firestore.Timestamp.fromDate(new Date()),
      muxUploadId: uploadTimestamp.toString(), // Store the timestamp as uploadId for webhook matching
      teacherId
    };

    const dppVideoRef = await firestore.collection('topics').doc(topicId).collection('dppVideos').add(dppVideoData);

    res.json({
      success: true,
      data: {
        dppVideoId: dppVideoRef.id,
        uploadUrl: uploadData.uploadUrl,
        uploadId: uploadData.uploadId
      }
    });
  } catch (error) {
    console.error('Error creating DPP video upload:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create DPP video upload' }
    });
  }
});

// PUT routes for updating content

// Update video content
router.put('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/videos/:videoId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, videoId } = req.params;
    const { title, description } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Title is required'
        }
      });
    }

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to update this content'
        }
      });
    }

    // Update video document
    const videoRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('videos')
      .doc(videoId);

    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'VIDEO_NOT_FOUND',
          message: 'Video not found'
        }
      });
    }

    await videoRef.update({
      title,
      description: description || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Video updated successfully'
    });

  } catch (error) {
    console.error('Error updating video:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update video'
      }
    });
  }
});

// Update notes content
router.put('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/notes/:noteId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, noteId } = req.params;
    const { title, description } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Title is required'
        }
      });
    }

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to update this content'
        }
      });
    }

    // Update note document
    const noteRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('notes')
      .doc(noteId);

    const noteDoc = await noteRef.get();
    if (!noteDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOTE_NOT_FOUND',
          message: 'Note not found'
        }
      });
    }

    await noteRef.update({
      title,
      description: description || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Note updated successfully'
    });

  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update note'
      }
    });
  }
});

// Update DPP content
router.put('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dpp/:dppId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, dppId } = req.params;
    const { title, description, questions, timeLimit, totalMarks, isPublished } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Title and questions are required'
        }
      });
    }

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to update this content'
        }
      });
    }

    // Update DPP document
    const dppRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('dpp')
      .doc(dppId);

    const dppDoc = await dppRef.get();
    if (!dppDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DPP_NOT_FOUND',
          message: 'DPP not found'
        }
      });
    }

    await dppRef.update({
      title,
      description: description || '',
      questions,
      timeLimit: timeLimit || null,
      totalMarks: totalMarks || questions.length,
      isPublished: isPublished || false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'DPP updated successfully'
    });

  } catch (error) {
    console.error('Error updating DPP:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update DPP'
      }
    });
  }
});

// Update DPP video content
router.put('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dppVideos/:dppVideoId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, dppVideoId } = req.params;
    const { title, description } = req.body;
    const teacherId = req.user.uid;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Title is required'
        }
      });
    }

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to update this content'
        }
      });
    }

    // Update DPP video document
    const dppVideoRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('dppVideos')
      .doc(dppVideoId);

    const dppVideoDoc = await dppVideoRef.get();
    if (!dppVideoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DPP_VIDEO_NOT_FOUND',
          message: 'DPP video not found'
        }
      });
    }

    await dppVideoRef.update({
      title,
      description: description || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'DPP video updated successfully'
    });

  } catch (error) {
    console.error('Error updating DPP video:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update DPP video'
      }
    });
  }
});

// DELETE routes for removing content

// Delete video content
router.delete('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/videos/:videoId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, videoId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to delete this content'
        }
      });
    }

    // Get video document
    const videoRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('videos')
      .doc(videoId);

    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'VIDEO_NOT_FOUND',
          message: 'Video not found'
        }
      });
    }

    const videoData = videoDoc.data();

    // Delete from Mux if muxAssetId exists
    if (videoData.muxAssetId) {
      try {
        await muxService.deleteAsset(videoData.muxAssetId);
      } catch (muxError) {
        console.error('Error deleting Mux asset:', muxError);
        // Continue with Firestore deletion even if Mux deletion fails
      }
    }

    // Delete from Firestore
    await videoRef.delete();

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete video'
      }
    });
  }
});

// Delete notes content
router.delete('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/notes/:noteId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, noteId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to delete this content'
        }
      });
    }

    // Get note document
    const noteRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('notes')
      .doc(noteId);

    const noteDoc = await noteRef.get();
    if (!noteDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOTE_NOT_FOUND',
          message: 'Note not found'
        }
      });
    }

    const noteData = noteDoc.data();

    // Delete file from Firebase Storage if fileUrl exists
    if (noteData.fileUrl) {
      try {
        await storageService.deleteFile(noteData.fileUrl);
      } catch (storageError) {
        console.error('Error deleting file from storage:', storageError);
        // Continue with Firestore deletion even if storage deletion fails
      }
    }

    // Delete from Firestore
    await noteRef.delete();

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete note'
      }
    });
  }
});

// Delete DPP content
router.delete('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dpp/:dppId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, dppId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to delete this content'
        }
      });
    }

    // Get DPP document
    const dppRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('dpp')
      .doc(dppId);

    const dppDoc = await dppRef.get();
    if (!dppDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DPP_NOT_FOUND',
          message: 'DPP not found'
        }
      });
    }

    // Delete from Firestore
    await dppRef.delete();

    res.json({
      success: true,
      message: 'DPP deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting DPP:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete DPP'
      }
    });
  }
});

// Delete DPP video content
router.delete('/subjects/:subjectId/chapters/:chapterId/topics/:topicId/content/dppVideos/:dppVideoId', authMiddleware, requireTeacher, async (req, res) => {
  try {
    const { subjectId, chapterId, topicId, dppVideoId } = req.params;
    const teacherId = req.user.uid;

    // Verify teacher owns the subject
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists || subjectDoc.data().teacherId !== teacherId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to delete this content'
        }
      });
    }

    // Get DPP video document
    const dppVideoRef = firestore.collection('subjects')
      .doc(subjectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('topics')
      .doc(topicId)
      .collection('dppVideos')
      .doc(dppVideoId);

    const dppVideoDoc = await dppVideoRef.get();
    if (!dppVideoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DPP_VIDEO_NOT_FOUND',
          message: 'DPP video not found'
        }
      });
    }

    const dppVideoData = dppVideoDoc.data();

    // Delete from Mux if muxAssetId exists
    if (dppVideoData.muxAssetId) {
      try {
        await muxService.deleteAsset(dppVideoData.muxAssetId);
      } catch (muxError) {
        console.error('Error deleting Mux asset:', muxError);
        // Continue with Firestore deletion even if Mux deletion fails
      }
    }

    // Delete from Firestore
    await dppVideoRef.delete();

    res.json({
      success: true,
      message: 'DPP video deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting DPP video:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete DPP video'
      }
    });
  }
});

module.exports = router;