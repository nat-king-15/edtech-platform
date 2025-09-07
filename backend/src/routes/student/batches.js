const express = require('express');
const { db } = require('../../../config/firebase');
const { authMiddleware, requireRole } = require('../../../middleware/authMiddleware');
const router = express.Router();

// Get student's enrolled batches
router.get('/my-batches', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const userId = req.user.uid;

    // Get user's enrollments
    const enrollmentsSnapshot = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentsSnapshot.empty) {
      return res.json({
        success: true,
        data: [],
        message: 'No enrolled batches found'
      });
    }

    const batches = [];
    for (const enrollmentDoc of enrollmentsSnapshot.docs) {
      const enrollment = enrollmentDoc.data();
      
      // Get batch details
      const batchDoc = await db.collection('batches').doc(enrollment.batchId).get();
      if (batchDoc.exists) {
        const batchData = batchDoc.data();
        
        // Get course details
        let courseData = null;
        if (batchData.courseId) {
          const courseDoc = await db.collection('courses').doc(batchData.courseId).get();
          if (courseDoc.exists) {
            courseData = courseDoc.data();
          }
        }

        batches.push({
          id: batchDoc.id,
          ...batchData,
          courseName: courseData?.name || 'Course',
          enrollmentDate: enrollment.enrolledAt,
          enrollmentStatus: enrollment.status
        });
      }
    }

    res.json({
      success: true,
      data: batches,
      message: 'Batches retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BATCHES_ERROR',
        message: 'Failed to fetch enrolled batches'
      }
    });
  }
});

// Get specific batch details
router.get('/:batchId', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user.uid;

    // Check if student is enrolled in this batch
    const enrollmentSnapshot = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentSnapshot.empty) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You are not enrolled in this batch'
        }
      });
    }

    // Get batch details
    const batchDoc = await db.collection('batches').doc(batchId).get();
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
    
    // Get course details
    let courseData = null;
    if (batchData.courseId) {
      const courseDoc = await db.collection('courses').doc(batchData.courseId).get();
      if (courseDoc.exists) {
        courseData = courseDoc.data();
      }
    }

    res.json({
      success: true,
      data: {
        id: batchDoc.id,
        ...batchData,
        courseName: courseData?.name || 'Course'
      },
      message: 'Batch details retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching batch details:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BATCH_ERROR',
        message: 'Failed to fetch batch details'
      }
    });
  }
});

// Get batch content (videos, PDFs, DPPs)
router.get('/:batchId/content', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user.uid;

    // Check if student is enrolled in this batch
    const enrollmentSnapshot = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentSnapshot.empty) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You are not enrolled in this batch'
        }
      });
    }

    // Get batch details to find associated subjects/chapters
    const batchDoc = await db.collection('batches').doc(batchId).get();
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
    const content = [];

    // Get content from subjects associated with this batch
    if (batchData.subjectIds && batchData.subjectIds.length > 0) {
      for (const subjectId of batchData.subjectIds) {
        // Get chapters for this subject
        const chaptersSnapshot = await db.collection('chapters')
          .where('subjectId', '==', subjectId)
          .orderBy('createdAt', 'desc')
          .get();

        for (const chapterDoc of chaptersSnapshot.docs) {
          const chapterData = chapterDoc.data();
          
          // Get topics for this chapter
          const topicsSnapshot = await db.collection('topics')
            .where('chapterId', '==', chapterDoc.id)
            .orderBy('createdAt', 'desc')
            .get();

          for (const topicDoc of topicsSnapshot.docs) {
            // Get videos for this topic
            const videosSnapshot = await db.collection('videos')
              .where('topicId', '==', topicDoc.id)
              .orderBy('uploadedAt', 'desc')
              .get();

            videosSnapshot.docs.forEach(videoDoc => {
              const videoData = videoDoc.data();
              content.push({
                id: videoDoc.id,
                type: 'video',
                title: videoData.title,
                description: videoData.description,
                muxPlaybackId: videoData.muxPlaybackId,
                muxUploadId: videoData.muxUploadId,
                duration: videoData.duration,
                uploadedAt: videoData.uploadedAt,
                teacherId: videoData.teacherId,
                teacherName: videoData.teacherName,
                subjectName: chapterData.subjectName,
                chapterName: chapterData.title,
                topicName: topicDoc.data().title
              });
            });

            // Get PDFs for this topic
            const pdfsSnapshot = await db.collection('pdfs')
              .where('topicId', '==', topicDoc.id)
              .orderBy('uploadedAt', 'desc')
              .get();

            pdfsSnapshot.docs.forEach(pdfDoc => {
              const pdfData = pdfDoc.data();
              content.push({
                id: pdfDoc.id,
                type: 'pdf',
                title: pdfData.title,
                description: pdfData.description,
                fileUrl: pdfData.fileUrl,
                uploadedAt: pdfData.uploadedAt,
                teacherId: pdfData.teacherId,
                teacherName: pdfData.teacherName,
                subjectName: chapterData.subjectName,
                chapterName: chapterData.title,
                topicName: topicDoc.data().title
              });
            });

            // Get DPPs for this topic
            const dppsSnapshot = await db.collection('dpps')
              .where('topicId', '==', topicDoc.id)
              .orderBy('uploadedAt', 'desc')
              .get();

            dppsSnapshot.docs.forEach(dppDoc => {
              const dppData = dppDoc.data();
              content.push({
                id: dppDoc.id,
                type: 'dpp',
                title: dppData.title,
                description: dppData.description,
                fileUrl: dppData.fileUrl,
                uploadedAt: dppData.uploadedAt,
                teacherId: dppData.teacherId,
                teacherName: dppData.teacherName,
                subjectName: chapterData.subjectName,
                chapterName: chapterData.title,
                topicName: topicDoc.data().title
              });
            });
          }
        }
      }
    }

    // Sort content by upload date (newest first)
    content.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({
      success: true,
      data: content,
      message: 'Batch content retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching batch content:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CONTENT_ERROR',
        message: 'Failed to fetch batch content'
      }
    });
  }
});

// Get specific content item
router.get('/:batchId/content/:contentId', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const { batchId, contentId } = req.params;
    const userId = req.user.uid;

    // Check if student is enrolled in this batch
    const enrollmentSnapshot = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentSnapshot.empty) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You are not enrolled in this batch'
        }
      });
    }

    // Try to find content in videos, pdfs, or dpps collections
    let contentDoc = null;
    let contentType = null;
    
    // Check videos collection
    contentDoc = await db.collection('videos').doc(contentId).get();
    if (contentDoc.exists) {
      contentType = 'video';
    } else {
      // Check pdfs collection
      contentDoc = await db.collection('pdfs').doc(contentId).get();
      if (contentDoc.exists) {
        contentType = 'pdf';
      } else {
        // Check dpps collection
        contentDoc = await db.collection('dpps').doc(contentId).get();
        if (contentDoc.exists) {
          contentType = 'dpp';
        }
      }
    }

    if (!contentDoc || !contentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONTENT_NOT_FOUND',
          message: 'Content not found'
        }
      });
    }

    const contentData = contentDoc.data();

    // Get additional context (topic, chapter, subject)
    let topicData = null;
    let chapterData = null;
    
    if (contentData.topicId) {
      const topicDoc = await db.collection('topics').doc(contentData.topicId).get();
      if (topicDoc.exists) {
        topicData = topicDoc.data();
        
        if (topicData.chapterId) {
          const chapterDoc = await db.collection('chapters').doc(topicData.chapterId).get();
          if (chapterDoc.exists) {
            chapterData = chapterDoc.data();
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        id: contentDoc.id,
        type: contentType,
        ...contentData,
        topicName: topicData?.title,
        chapterName: chapterData?.title,
        subjectName: chapterData?.subjectName
      },
      message: 'Content retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching content:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CONTENT_ERROR',
        message: 'Failed to fetch content'
      }
    });
  }
});

// Update watch progress for video content
router.post('/:batchId/content/:contentId/progress', authMiddleware, requireRole(['student']), async (req, res) => {
  try {
    const { batchId, contentId } = req.params;
    const { progress } = req.body;
    const userId = req.user.uid;

    // Validate progress
    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PROGRESS',
          message: 'Progress must be a number between 0 and 100'
        }
      });
    }

    // Check if student is enrolled in this batch
    const enrollmentSnapshot = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentSnapshot.empty) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You are not enrolled in this batch'
        }
      });
    }

    // Update or create progress record
    const progressRef = db.collection('watchProgress').doc(`${userId}_${contentId}`);
    await progressRef.set({
      studentId: userId,
      contentId: contentId,
      batchId: batchId,
      progress: progress,
      lastWatched: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.json({
      success: true,
      message: 'Progress updated successfully'
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_PROGRESS_ERROR',
        message: 'Failed to update progress'
      }
    });
  }
});

module.exports = router;