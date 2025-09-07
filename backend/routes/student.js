const express = require('express');
const { firestore } = require('../config/firebase');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validation');
const { body, param, query } = require('express-validator');
const admin = require('firebase-admin');
const razorpay = require('../config/razorpay');
const crypto = require('crypto');
const notificationService = require('../services/notificationService');
const videoProgressService = require('../services/videoProgressService');
const quizService = require('../services/quizService');
const validator = require('validator');
const studentBatchRoutes = require('../src/routes/student/batches');

const router = express.Router();

// Mount batch routes
router.use('/batches', studentBatchRoutes);

/**
 * Middleware to ensure user has student role
 */
const requireStudent = async (req, res, next) => {
  try {
    const userDoc = await firestore.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User document does not exist'
      });
    }

    const userData = userDoc.data();
    if (userData.role !== 'student') {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Student role required to access this resource'
      });
    }

    req.student = userData;
    next();
  } catch (error) {
    console.error('Error checking student role:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify student role'
    });
  }
};

/**
 * Helper function to check if student is enrolled in a batch
 */
const checkEnrollment = async (studentId, batchId) => {
  const enrollmentId = `${studentId}_${batchId}`;
  const enrollmentDoc = await firestore.collection('enrollments').doc(enrollmentId).get();
  return enrollmentDoc.exists;
};

/**
 * Create Razorpay order for batch enrollment
 * POST /api/student/batches/:batchId/create-order
 * Student-only endpoint to create a payment order for batch enrollment
 */
router.post('/batches/:batchId/create-order', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // Check if batch exists and is published
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'The specified batch does not exist'
      });
    }
    
    const batchData = batchDoc.data();
    if (batchData.status !== 'published') {
      return res.status(400).json({
        error: 'Batch Not Available',
        message: 'This batch is not available for enrollment'
      });
    }
    
    // Check if already enrolled
    const studentId = req.user.uid;
    const enrollmentId = `${studentId}_${batchId}`;
    const existingEnrollment = await firestore.collection('enrollments').doc(enrollmentId).get();
    if (existingEnrollment.exists) {
      return res.status(409).json({
        error: 'Already Enrolled',
        message: 'You are already enrolled in this batch'
      });
    }
    
    // Convert price to paise (smallest currency unit for INR)
    const price = batchData.price || 0;
    const amountInPaise = Math.round(price * 100);
    
    // Create Razorpay order
    const options = {
      amount: amountInPaise, // amount in paise
      currency: 'INR',
      receipt: `receipt_order_${new Date().getTime()}`,
      notes: {
        batchId: batchId,
        studentId: studentId,
        batchName: batchData.name
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        batchId: batchId,
        batchName: batchData.name,
        batchDescription: batchData.description
      }
    });
    
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create payment order'
    });
  }
});

/**
 * Verify Razorpay payment and enroll student
 * POST /api/student/payment/verify
 * Student-only endpoint to verify payment and complete enrollment
 */
router.post('/payment/verify', authMiddleware, requireStudent, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      batchId
    } = req.body;
    
    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !batchId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required payment verification fields'
      });
    }
    
    // Verify payment signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        error: 'Payment Verification Failed',
        message: 'Invalid payment signature. Payment verification failed.'
      });
    }
    
    // Payment verified successfully - create enrollment
    const studentId = req.user.uid;
    const enrollmentId = `${studentId}_${batchId}`;
    
    // Check if already enrolled (double-check)
    const existingEnrollment = await firestore.collection('enrollments').doc(enrollmentId).get();
    if (existingEnrollment.exists) {
      return res.status(409).json({
        error: 'Already Enrolled',
        message: 'You are already enrolled in this batch'
      });
    }
    
    // Get batch details for enrollment record
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'The specified batch does not exist'
      });
    }
    
    const batchData = batchDoc.data();
    
    // Create enrollment record
    const enrollmentData = {
      studentId,
      batchId,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentStatus: 'completed',
      amount: batchData.price || 0,
      currency: 'INR',
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    };
    
    await firestore.collection('enrollments').doc(enrollmentId).set(enrollmentData);
    
    // Send enrollment and payment success notifications
    try {
      // Send enrollment success notification
      await notificationService.sendNotification(
        req.user.uid,
        notificationService.notificationTypes.ENROLLMENT_SUCCESS,
        {
          batchName: batchData.name,
          courseName: batchData.courseName || 'Course',
          startDate: batchData.startDate || 'TBD',
          amount: (order.amount / 100).toString() // Convert from paise to rupees
        }
      );
      
      // Send payment success notification
      await notificationService.sendNotification(
        req.user.uid,
        notificationService.notificationTypes.PAYMENT_SUCCESS,
        {
          batchName: batchData.name,
          amount: (order.amount / 100).toString(), // Convert from paise to rupees
          paymentId: razorpay_payment_id,
          paymentDate: new Date().toLocaleDateString('en-IN')
        }
      );
      
      console.log('✅ Enrollment and payment notifications sent successfully');
    } catch (notificationError) {
      console.error('⚠️  Failed to send notifications:', notificationError);
      // Don't fail the enrollment if notifications fail
    }
    
    res.status(200).json({
      success: true,
      message: 'Enrollment successful! Payment verified and enrollment completed.',
      data: {
        enrollmentId,
        batchId,
        batchName: batchData.name,
        paymentId: razorpay_payment_id,
        enrolledAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify payment and complete enrollment'
    });
  }
});

/**
 * Enroll student in a batch (with simulated payment) - DEPRECATED
 * POST /api/student/batches/:batchId/enroll
 * Student-only endpoint to enroll in a published batch
 * Note: This endpoint is deprecated in favor of Razorpay integration
 */
router.post('/batches/:batchId/enroll', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { batchId } = req.params;
    const studentId = req.user.uid;
    const enrollmentId = `${studentId}_${batchId}`;
    
    // Check if batch exists and is published
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'The specified batch does not exist'
      });
    }
    
    const batchData = batchDoc.data();
    if (batchData.status !== 'published') {
      return res.status(400).json({
        error: 'Batch Not Available',
        message: 'This batch is not available for enrollment'
      });
    }
    
    // Check if already enrolled
    const existingEnrollment = await firestore.collection('enrollments').doc(enrollmentId).get();
    if (existingEnrollment.exists) {
      return res.status(409).json({
        error: 'Already Enrolled',
        message: 'You are already enrolled in this batch'
      });
    }
    
    // Simulate payment processing (in real implementation, integrate with payment gateway)
    // For now, we'll assume payment is successful
    
    // Create enrollment record
    const enrollmentData = {
      studentId,
      batchId,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentStatus: 'completed', // Simulated
      amount: batchData.price || 0,
      currency: batchData.currency || 'USD'
    };
    
    await firestore.collection('enrollments').doc(enrollmentId).set(enrollmentData);
    
    res.status(201).json({
      success: true,
      message: 'Successfully enrolled in batch',
      data: {
        enrollmentId,
        batchId,
        batchName: batchData.name,
        enrolledAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to enroll in batch'
    });
  }
});

/**
 * Get student's enrolled batches
 * GET /api/student/my-batches
 * Student-only endpoint to view all batches the student is enrolled in
 */
router.get('/my-batches', authMiddleware, requireStudent, async (req, res) => {
  try {
    const studentId = req.user.uid;
    const { limit = 20, offset = 0 } = req.query;
    
    // Get all enrollments for this student
    const enrollmentsSnapshot = await firestore.collection('enrollments')
      .where('studentId', '==', studentId)
      .orderBy('enrolledAt', 'desc')
      .limit(Math.min(parseInt(limit), 50))
      .offset(parseInt(offset) || 0)
      .get();
    
    const batches = [];
    
    // Fetch batch details for each enrollment
    for (const enrollmentDoc of enrollmentsSnapshot.docs) {
      const enrollmentData = enrollmentDoc.data();
      const batchDoc = await firestore.collection('batches').doc(enrollmentData.batchId).get();
      
      if (batchDoc.exists) {
        const batchData = batchDoc.data();
        batches.push({
          id: batchDoc.id,
          name: batchData.name,
          description: batchData.description,
          courseId: batchData.courseId,
          courseName: batchData.courseName,
          startDate: batchData.startDate,
          endDate: batchData.endDate,
          status: batchData.status,
          enrolledAt: enrollmentData.enrolledAt,
          paymentStatus: enrollmentData.paymentStatus
        });
      }
    }
    
    res.json({
      success: true,
      data: batches,
      pagination: {
        limit: Math.min(parseInt(limit), 50),
        offset: parseInt(offset) || 0,
        total: batches.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching student batches:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch enrolled batches'
    });
  }
});

/**
 * Get content for an enrolled batch (with schedule filtering)
 * GET /api/student/batches/:batchId/content
 * Student-only endpoint to access content for an enrolled batch
 * Only returns content where scheduledAt is in the past
 */
router.get('/batches/:batchId/content', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { batchId } = req.params;
    const studentId = req.user.uid;
    
    // Verify enrollment
    const isEnrolled = await checkEnrollment(studentId, batchId);
    if (!isEnrolled) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You are not enrolled in this batch'
      });
    }
    
    // Get current timestamp for filtering
    const now = admin.firestore.Timestamp.now();
    
    // Fetch all scheduled content for this batch where scheduledAt <= now
    const scheduleSnapshot = await firestore.collection('schedule')
      .where('batchId', '==', batchId)
      .where('scheduledAt', '<=', now)
      .orderBy('scheduledAt', 'asc')
      .get();
    
    // Group content by subject
    const contentBySubject = {};
    
    for (const doc of scheduleSnapshot.docs) {
      const scheduleData = doc.data();
      const subjectId = scheduleData.subjectId;
      
      // Get subject details
      if (!contentBySubject[subjectId]) {
        const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
        const subjectData = subjectDoc.exists ? subjectDoc.data() : { name: 'Unknown Subject' };
        
        contentBySubject[subjectId] = {
          subjectId,
          subjectName: subjectData.name,
          content: []
        };
      }
      
      // Add content item
      contentBySubject[subjectId].content.push({
        id: doc.id,
        title: scheduleData.title,
        description: scheduleData.description,
        contentType: scheduleData.contentType,
        scheduledAt: scheduleData.scheduledAt,
        duration: scheduleData.duration,
        // Include content URLs/data based on type
        ...(scheduleData.contentType === 'VIDEO' && {
          videoUrl: scheduleData.videoUrl,
          playbackId: scheduleData.playbackId
        }),
        ...(scheduleData.contentType === 'LECTURE_NOTES_PDF' && {
          pdfUrl: scheduleData.pdfUrl
        }),
        ...(scheduleData.contentType === 'DPP_PDF' && {
          pdfUrl: scheduleData.pdfUrl
        })
      });
    }
    
    // Convert to array and sort by subject name
    const subjects = Object.values(contentBySubject).sort((a, b) => 
      a.subjectName.localeCompare(b.subjectName)
    );
    
    // Sort content within each subject by scheduled date
    subjects.forEach(subject => {
      subject.content.sort((a, b) => {
        const dateA = a.scheduledAt.toDate ? a.scheduledAt.toDate() : new Date(a.scheduledAt);
        const dateB = b.scheduledAt.toDate ? b.scheduledAt.toDate() : new Date(b.scheduledAt);
        return dateA - dateB;
      });
    });
    
    res.json({
      success: true,
      data: {
        batchId,
        subjects,
        totalContent: scheduleSnapshot.size,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error fetching batch content:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch batch content'
    });
  }
});

// ==================== NOTIFICATION ENDPOINTS ====================

/**
 * Get notifications for the authenticated student
 * GET /api/student/notifications
 * Query params: limit, offset, unreadOnly
 */
router.get('/notifications', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    
    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      unreadOnly: unreadOnly === 'true'
    };

    const notifications = await notificationService.getUserNotifications(req.user.uid, options);
    
    res.json({
      success: true,
      data: notifications,
      pagination: {
        limit: options.limit,
        offset: options.offset,
        count: notifications.length
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch notifications'
    });
  }
});

/**
 * Get unread notification count for the authenticated student
 * GET /api/student/notifications/unread-count
 */
router.get('/notifications/unread-count', authMiddleware, requireStudent, async (req, res) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user.uid);
    
    res.json({
      success: true,
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch unread notification count'
    });
  }
});

/**
 * Mark a specific notification as read
 * PUT /api/student/notifications/:notificationId/read
 */
router.put('/notifications/:notificationId/read', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Notification ID is required'
      });
    }

    await notificationService.markAsRead(notificationId, req.user.uid);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    
    if (error.message === 'Notification not found') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Notification not found'
      });
    }
    
    if (error.message === 'Unauthorized access to notification') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only mark your own notifications as read'
      });
    }
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to mark notification as read'
    });
  }
});

/**
 * Mark all notifications as read for the authenticated student
 * PUT /api/student/notifications/mark-all-read
 */
router.put('/notifications/mark-all-read', authMiddleware, requireStudent, async (req, res) => {
  try {
    const result = await notificationService.markAllAsRead(req.user.uid);
    
    res.json({
      success: true,
      message: `${result.updatedCount} notifications marked as read`,
      data: {
        updatedCount: result.updatedCount
      }
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to mark all notifications as read'
    });
  }
});

/**
 * Update video progress endpoint
 * POST /api/student/video-progress
 * Student-only endpoint to update video watching progress
 */
router.post('/video-progress', 
  [
    body('videoId').isAlphanumeric().withMessage('Invalid video ID format'),
    body('batchId').isAlphanumeric().withMessage('Invalid batch ID format'),
    body('subjectId').isAlphanumeric().withMessage('Invalid subject ID format'),
    body('currentTime').isNumeric().withMessage('Current time must be a number'),
    body('duration').isNumeric().withMessage('Duration must be a number'),
    body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
    validateRequest
  ],
  authMiddleware, requireStudent, async (req, res) => {
  try {
    const { videoId, batchId, subjectId, currentTime, duration, completed } = req.body;
    
    // Validate required fields
    if (!videoId || !batchId || !subjectId || currentTime === undefined || duration === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'videoId, batchId, subjectId, currentTime, and duration are required'
        }
      });
    }
    
    // Validate that student is enrolled in the batch
    const isEnrolled = await checkEnrollment(req.user.uid, batchId);
    if (!isEnrolled) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'NOT_ENROLLED',
          message: 'You must be enrolled in this batch to track video progress'
        }
      });
    }
    
    const result = await videoProgressService.updateProgress(
      req.user.uid,
      videoId,
      batchId,
      subjectId,
      parseFloat(currentTime),
      parseFloat(duration),
      completed
    );
    
    res.json({
      success: true,
      message: 'Video progress updated successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error updating video progress:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_PROGRESS_ERROR',
        message: 'Failed to update video progress',
        details: error.message
      }
    });
  }
});

/**
 * Get video progress
 * GET /api/student/video-progress
 * GET /api/student/video-progress?videoId=xxx
 * GET /api/student/video-progress?batchId=xxx
 * Student-only endpoint to get video watching progress
 */
router.get('/video-progress', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { videoId, batchId } = req.query;
    
    const result = await videoProgressService.getProgress(
      req.user.uid,
      videoId,
      batchId
    );
    
    res.json({
      success: true,
      message: 'Video progress fetched successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error fetching video progress:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_PROGRESS_ERROR',
        message: 'Failed to fetch video progress',
        details: error.message
      }
    });
  }
});

/**
 * Get batch progress summary
 * GET /api/student/batches/:batchId/progress-summary
 * Student-only endpoint to get overall progress summary for a batch
 */
router.get('/batches/:batchId/progress-summary', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // Validate that student is enrolled in the batch
    const isEnrolled = await checkEnrollment(req.user.uid, batchId);
    if (!isEnrolled) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'NOT_ENROLLED',
          message: 'You must be enrolled in this batch to view progress summary'
        }
      });
    }
    
    const result = await videoProgressService.getBatchProgressSummary(
      req.user.uid,
      batchId
    );
    
    res.json({
      success: true,
      message: 'Batch progress summary fetched successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error fetching batch progress summary:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_PROGRESS_SUMMARY_ERROR',
        message: 'Failed to fetch batch progress summary',
        details: error.message
      }
    });
  }
});

/**
 * Mark video as completed
 * PUT /api/student/video-progress/:videoId/complete
 * Student-only endpoint to mark a video as completed
 */
router.put('/video-progress/:videoId/complete', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { videoId } = req.params;
    
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_VIDEO_ID',
          message: 'Video ID is required'
        }
      });
    }
    
    const result = await videoProgressService.markVideoCompleted(
      req.user.uid,
      videoId
    );
    
    res.json({
      success: true,
      message: 'Video marked as completed successfully',
      data: result.data
    });
    
  } catch (error) {
    console.error('Error marking video as completed:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'MARK_COMPLETED_ERROR',
        message: 'Failed to mark video as completed',
        details: error.message
      }
    });
  }
});

// Quiz endpoints
/**
 * Get available quizzes for student's batches
 * GET /api/student/quizzes
 * Query params: batchId (optional), subjectId (optional)
 */
router.get('/quizzes', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { batchId, subjectId } = req.query;
    const studentId = req.user.uid;

    // If no batchId provided, get all student's batches
    if (!batchId) {
      const enrollmentsSnapshot = await firestore
        .collection('enrollments')
        .where('studentId', '==', studentId)
        .get();

      const batchIds = enrollmentsSnapshot.docs.map(doc => doc.data().batchId);
      
      if (batchIds.length === 0) {
        return res.json({
          success: true,
          data: []
        });
      }

      // Get quizzes for all batches
      const allQuizzes = [];
      for (const batch of batchIds) {
        const result = await quizService.getQuizzesForBatch(batch, subjectId);
        allQuizzes.push(...result.data);
      }

      return res.json({
        success: true,
        data: allQuizzes
      });
    }

    // Verify student is enrolled in the batch
    const enrollmentSnapshot = await firestore
      .collection('enrollments')
      .where('studentId', '==', studentId)
      .where('batchId', '==', batchId)
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

    const result = await quizService.getQuizzesForBatch(batchId, subjectId);
    res.json(result);
  } catch (error) {
    console.error('Error getting quizzes:', error);
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
 * Get quiz details for taking the quiz
 * GET /api/student/quizzes/:quizId
 */
router.get('/quizzes/:quizId', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { quizId } = req.params;
    const studentId = req.user.uid;

    const result = await quizService.getQuizForStudent(quizId, studentId);
    res.json(result);
  } catch (error) {
    console.error('Error getting quiz:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get quiz',
        details: error.message
      }
    });
  }
});

/**
 * Submit quiz answers
 * POST /api/student/quizzes/:quizId/submit
 * Body: { answers: Array, timeSpent: Number }
 */
router.post('/quizzes/:quizId/submit', 
  [
    param('quizId').isAlphanumeric().withMessage('Invalid quiz ID format'),
    body('answers').isArray().withMessage('Answers must be an array'),
    body('timeSpent').isNumeric().withMessage('Time spent must be a number'),
    validateRequest
  ],
  authMiddleware, requireStudent, async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, timeSpent } = req.body;
    const studentId = req.user.uid;

    if (!Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Answers must be an array'
        }
      });
    }

    const result = await quizService.submitQuiz(quizId, studentId, answers, timeSpent);
    res.json(result);
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to submit quiz',
        details: error.message
      }
    });
  }
});

/**
 * Get quiz results/submissions for a student
 * GET /api/student/quizzes/:quizId/results
 */
router.get('/quizzes/:quizId/results', authMiddleware, requireStudent, async (req, res) => {
  try {
    const { quizId } = req.params;
    const studentId = req.user.uid;

    const result = await quizService.getQuizResults(quizId, studentId);
    res.json(result);
  } catch (error) {
    console.error('Error getting quiz results:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get quiz results',
        details: error.message
      }
    });
  }
});



/**
 * @swagger
 * /api/student/notifications/{notificationId}/read:
 *   post:
 *     summary: Mark notification as read
 *     tags: [Student]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Internal server error
 */
router.post('/notifications/:notificationId/read', 
  authMiddleware, 
  requireStudent,
  [
    param('notificationId').isString().notEmpty().withMessage('Notification ID is required')
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { notificationId } = req.params;
      const studentId = req.user.uid;

      // Check if notification exists and belongs to student
      const notificationDoc = await firestore.collection('notifications').doc(notificationId).get();
      
      if (!notificationDoc.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Notification not found'
          }
        });
      }

      const notificationData = notificationDoc.data();
      if (notificationData.userId !== studentId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied to this notification'
          }
        });
      }

      // Mark as read
      await firestore.collection('notifications').doc(notificationId).update({
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark notification as read',
          details: error.message
        }
      });
    }
  }
);

module.exports = router;