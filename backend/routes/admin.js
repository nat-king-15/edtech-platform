const express = require('express');
const { auth, firestore, storage, FieldValue } = require('../config/firebase');
const { authMiddleware, requireAdmin } = require('../middleware/authMiddleware');
const emailService = require('../utils/emailService');
const notificationService = require('../services/notificationService');
const { CacheManager, CacheKeys, CacheTTL } = require('../utils/cache');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Middleware to log all incoming requests to this router
router.use((req, res, next) => {
  console.log(`[ADMIN ROUTER] Received ${req.method} request for ${req.originalUrl} from ${req.ip}`);
  next();
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * Set user role endpoint
 * POST /api/admin/users/:uid/set-role
 * Admin-only endpoint to assign roles to users
 */
router.post('/users/:uid/set-role', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;

    // Validate role
    const validRoles = ['student', 'teacher', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid Role',
        message: `Role must be one of: ${validRoles.join(', ')}`
      });
    }

    // Validate UID
    if (!uid) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'User UID is required'
      });
    }

    // Check if user exists in Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({
          error: 'User Not Found',
          message: 'User with the provided UID does not exist'
        });
      }
      throw error;
    }

    // Set custom claims for the user
    await auth.setCustomUserClaims(uid, { role });

    // Update user document in Firestore
    const userDocRef = firestore.collection('users').doc(uid);
    await userDocRef.set({
      email: userRecord.email,
      name: userRecord.displayName || userRecord.email.split('@')[0],
      role: role,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.uid
    }, { merge: true });

    // Invalidate related caches
    CacheManager.del(CacheKeys.TEACHERS_LIST);
    CacheManager.del(CacheKeys.ADMIN_DASHBOARD_STATS);
    CacheManager.invalidatePattern('users:*');

    res.status(200).json({
      success: true,
      message: `Role '${role}' assigned to user successfully`,
      data: {
        uid: uid,
        email: userRecord.email,
        role: role,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error setting user role:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to set user role'
    });
  }
});



/**
 * Get user details endpoint
 * GET /api/admin/users/:uid
 * Admin-only endpoint to get user information
 */
router.get('/users/:uid', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    // Get user from Firebase Auth
    const userRecord = await auth.getUser(uid);
    
    // Get user document from Firestore
    const userDoc = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    res.status(200).json({
      success: true,
      data: {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled,
        customClaims: userRecord.customClaims || {},
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
        firestoreData: userData
      }
    });

  } catch (error) {
    console.error('Error getting user details:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User with the provided UID does not exist'
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user details'
    });
  }
});

/**
 * List all users endpoint
 * GET /api/admin/users
 * Admin-only endpoint to list all users with pagination
 */
router.get('/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { limit = 10, pageToken, role } = req.query;
    const maxResults = Math.min(parseInt(limit), 100); // Limit to 100 users per request

    // If requesting teachers, query Firestore directly instead of Firebase Auth
    if (role === 'teacher') {
      // Try to get from cache first
      const cachedTeachers = CacheManager.get(CacheKeys.TEACHERS_LIST);
      if (cachedTeachers) {
        console.log('🚀 Returning cached teachers data');
        return res.status(200).json({
          success: true,
          data: cachedTeachers,
          cached: true
        });
      }

      const teachersSnapshot = await firestore.collection('users').where('role', '==', 'teacher').get();
      const teachersData = teachersSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().displayName || doc.data().name || doc.data().email.split('@')[0],
        email: doc.data().email
      }));
      
      // Cache the teachers data for 10 minutes
      CacheManager.set(CacheKeys.TEACHERS_LIST, teachersData, CacheTTL.LONG);
      
      console.log('🔍 Teachers found from Firestore:', teachersData.length);
      console.log('🔍 Teachers data:', teachersData);
      
      return res.status(200).json({
        success: true,
        data: teachersData
      });
    }

    // For other roles or no role filter, use Firebase Auth (existing behavior)
    const listUsersResult = await auth.listUsers(maxResults, pageToken);

    let users = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      displayName: userRecord.displayName,
      disabled: userRecord.disabled,
      role: userRecord.customClaims?.role || 'student',
      creationTime: userRecord.metadata.creationTime,
      lastSignInTime: userRecord.metadata.lastSignInTime
    }));

    // Filter by role if specified
    if (role && role !== 'all') {
      users = users.filter(user => user.role === role);
    }

    res.status(200).json({
      success: true,
      data: {
        users: users,
        pageToken: listUsersResult.pageToken,
        totalUsers: users.length
      }
    });

  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list users'
    });
  }
});

/**
 * Update user status endpoint (activate/disable)
 * PUT /api/admin/users/:uid/status
 * Admin-only endpoint to activate or disable users
 */
router.put('/users/:uid/status', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { disabled } = req.body;

    // Validate input
    if (typeof disabled !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'disabled field must be a boolean value'
      });
    }

    // Validate UID
    if (!uid) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'User UID is required'
      });
    }

    // Check if user exists in Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({
          error: 'User Not Found',
          message: 'User with the provided UID does not exist'
        });
      }
      throw error;
    }

    // Update user status in Firebase Auth
    await auth.updateUser(uid, { disabled });

    // Update user document in Firestore for consistency
    const userDocRef = firestore.collection('users').doc(uid);
    await userDocRef.set({
      disabled: disabled,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.uid
    }, { merge: true });

    // Invalidate related caches
    CacheManager.del(CacheKeys.TEACHERS_LIST);
    CacheManager.del(CacheKeys.ADMIN_DASHBOARD_STATS);
    CacheManager.invalidatePattern('users:*');

    res.status(200).json({
      success: true,
      message: `User ${disabled ? 'disabled' : 'activated'} successfully`,
      data: {
        uid: uid,
        email: userRecord.email,
        disabled: disabled,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update user status'
    });
  }
});

/**
 * Delete user endpoint
 * DELETE /api/admin/users/:uid
 * Admin-only endpoint to delete users
 */
router.delete('/users/:uid', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    // Validate UID
    if (!uid) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'User UID is required'
      });
    }

    // Check if user exists in Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({
          error: 'User Not Found',
          message: 'User with the provided UID does not exist'
        });
      }
      throw error;
    }

    // Store user data for response before deletion
    const userData = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName
    };

    // Delete user from Firebase Auth
    await auth.deleteUser(uid);

    // Delete user document from Firestore
    await firestore.collection('users').doc(uid).delete();

    // Also clean up related data (enrollments, progress, etc.)
    const batch = firestore.batch();
    
    // Delete enrollments
    const enrollmentsSnapshot = await firestore.collection('enrollments')
      .where('studentId', '==', uid).get();
    enrollmentsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete progress records
    const progressSnapshot = await firestore.collection('progress')
      .where('studentId', '==', uid).get();
    progressSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete transactions/payments
    const transactionsSnapshot = await firestore.collection('transactions')
      .where('userId', '==', uid).get();
    transactionsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Commit the batch delete
    await batch.commit();

    // Invalidate related caches
    CacheManager.del(CacheKeys.TEACHERS_LIST);
    CacheManager.del(CacheKeys.ADMIN_DASHBOARD_STATS);
    CacheManager.invalidatePattern('users:*');
    CacheManager.invalidatePattern('enrollments:*');

    res.status(200).json({
      success: true,
      message: 'User and all related data deleted successfully',
      data: userData
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete user'
    });
  }
});

/**
 * Create course endpoint
 * POST /api/admin/courses
 * Admin-only endpoint to create new courses
 */
router.post('/courses', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { title, category, thumbnailUrl, description, tags } = req.body;

    // Validate required fields
    if (!title || !category) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title and category are required fields'
      });
    }

    // thumbnailUrl is now optional
    if (thumbnailUrl && thumbnailUrl.trim()) {
      // Validate URL format only if provided
      try {
        new URL(thumbnailUrl);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'thumbnailUrl must be a valid URL'
        });
      }
    }

    // Create course document
    const courseData = {
      title: title.trim(),
      category: category.trim(),
      description: description ? description.trim() : '',
      tags: Array.isArray(tags) ? tags : [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.uid
    };

    // Add thumbnailUrl only if provided
    if (thumbnailUrl && thumbnailUrl.trim()) {
      courseData.thumbnailUrl = thumbnailUrl.trim();
    }

    const courseRef = await firestore.collection('courses').add(courseData);

    // Invalidate related caches
    CacheManager.invalidatePattern('courses:*');
    CacheManager.del(CacheKeys.ADMIN_DASHBOARD_STATS);

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: {
        courseId: courseRef.id,
        ...courseData
      }
    });

  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create course'
    });
  }
});

/**
 * Create batch endpoint
 * POST /api/admin/batches
 * Admin-only endpoint to create new batches
 */
router.post('/batches', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { 
      title, 
      courseId, 
      description, 
      price, 
      teachers, 
      startDate, 
      status,
      endDate,
      maxStudents,
      duration,
      schedule
    } = req.body;

    // Validate required fields
    if (!title || !courseId || !description || price === undefined || !teachers || !startDate || !status) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title, courseId, description, price, teachers, startDate, and status are required fields'
      });
    }

    // Validate status
    if (!['draft', 'published'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid Status',
        message: 'Status must be either "draft" or "published"'
      });
    }

    // Validate price
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({
        error: 'Invalid Price',
        message: 'Price must be a positive number'
      });
    }

    // Validate teachers array
    if (!Array.isArray(teachers) || teachers.length === 0) {
      return res.status(400).json({
        error: 'Invalid Teachers',
        message: 'Teachers must be a non-empty array'
      });
    }

    // Validate each teacher object
    for (const teacher of teachers) {
      if (!teacher.name || !teacher.subject || !teacher.imageUrl) {
        return res.status(400).json({
          error: 'Invalid Teacher Data',
          message: 'Each teacher must have name, subject, and imageUrl'
        });
      }
    }

    // Validate courseId exists
    const courseDoc = await firestore.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Course Not Found',
        message: 'The specified courseId does not exist'
      });
    }

    // Validate startDate
    const startDateTime = new Date(startDate);
    if (isNaN(startDateTime.getTime())) {
      return res.status(400).json({
        error: 'Invalid Date',
        message: 'startDate must be a valid date'
      });
    }

    // Create batch document
    const batchData = {
      title: title.trim(),
      courseId: courseId.trim(),
      description: description.trim(),
      price: price,
      teachers: teachers,
      startDate: startDateTime,
      status: status,
      currentStudents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.uid
    };

    // Add optional fields if provided
    if (endDate) {
      const endDateTime = new Date(endDate);
      if (!isNaN(endDateTime.getTime())) {
        batchData.endDate = endDateTime;
      }
    }
    if (maxStudents && typeof maxStudents === 'number' && maxStudents > 0) {
      batchData.maxStudents = maxStudents;
    }
    if (duration) {
      batchData.duration = duration.trim();
    }
    if (schedule) {
      batchData.schedule = schedule;
    }

    const batchRef = await firestore.collection('batches').add(batchData);

    // Invalidate related caches
    CacheManager.deletePattern('batches:*');
    CacheManager.delete(CacheKeys.ADMIN_DASHBOARD_STATS);
    console.log('🗑️ Invalidated batches and dashboard caches after batch creation');

    res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      data: {
        batchId: batchRef.id,
        ...batchData
      }
    });

  } catch (error) {
    console.error('Error creating batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create batch'
    });
  }
});

/**
 * Update batch endpoint
 * PUT /api/admin/batches/:batchId
 * Admin-only endpoint to update batch details
 */
router.put('/batches/:batchId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;
    const updateData = req.body;

    // Validate batchId
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Check if batch exists (batches are stored in courses subcollections)
    let batchDoc = null;
    let courseId = null;
    
    // First try to find in root batches collection (legacy)
    const rootBatchDoc = await firestore.collection('batches').doc(batchId).get();
    if (rootBatchDoc.exists) {
      batchDoc = rootBatchDoc;
      courseId = rootBatchDoc.data().courseId;
    } else {
      // Search in courses subcollections
      const coursesSnapshot = await firestore.collection('courses').get();
      for (const courseDoc of coursesSnapshot.docs) {
        const batchInCourse = await firestore.collection('courses').doc(courseDoc.id).collection('batches').doc(batchId).get();
        if (batchInCourse.exists) {
          batchDoc = batchInCourse;
          courseId = courseDoc.id;
          break;
        }
      }
    }
    
    if (!batchDoc) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }
    
    console.log('✅ Batch found in course:', courseId);

    // Validate status if provided
    if (updateData.status && !['draft', 'published'].includes(updateData.status)) {
      return res.status(400).json({
        error: 'Invalid Status',
        message: 'Status must be either "draft" or "published"'
      });
    }

    // Validate price if provided
    if (updateData.price !== undefined && (typeof updateData.price !== 'number' || updateData.price < 0)) {
      return res.status(400).json({
        error: 'Invalid Price',
        message: 'Price must be a positive number'
      });
    }

    // Validate courseId if provided
    if (updateData.courseId) {
      const courseDoc = await firestore.collection('courses').doc(updateData.courseId).get();
      if (!courseDoc.exists) {
        return res.status(404).json({
          error: 'Course Not Found',
          message: 'The specified courseId does not exist'
        });
      }
    }

    // Validate teachers if provided
    if (updateData.teachers) {
      if (!Array.isArray(updateData.teachers) || updateData.teachers.length === 0) {
        return res.status(400).json({
          error: 'Invalid Teachers',
          message: 'Teachers must be a non-empty array'
        });
      }

      for (const teacher of updateData.teachers) {
        if (!teacher.name || !teacher.subject || !teacher.imageUrl) {
          return res.status(400).json({
            error: 'Invalid Teacher Data',
            message: 'Each teacher must have name, subject, and imageUrl'
          });
        }
      }
    }

    // Validate dates if provided
    if (updateData.startDate) {
      const startDateTime = new Date(updateData.startDate);
      if (isNaN(startDateTime.getTime())) {
        return res.status(400).json({
          error: 'Invalid Date',
          message: 'startDate must be a valid date'
        });
      }
      updateData.startDate = startDateTime;
    }

    if (updateData.endDate) {
      const endDateTime = new Date(updateData.endDate);
      if (isNaN(endDateTime.getTime())) {
        return res.status(400).json({
          error: 'Invalid Date',
          message: 'endDate must be a valid date'
        });
      }
      updateData.endDate = endDateTime;
    }

    // Remove fields that shouldn't be updated
    delete updateData.createdAt;
    delete updateData.createdBy;
    delete updateData.currentStudents; // This should be managed separately

    // Add update timestamp
    updateData.updatedAt = new Date().toISOString();

    // Update the batch
    await firestore.collection('batches').doc(batchId).update(updateData);

    // Get updated batch data
    const updatedBatch = await firestore.collection('batches').doc(batchId).get();

    // Invalidate related caches
    CacheManager.deletePattern('batches:*');
    CacheManager.delete(CacheKeys.ADMIN_DASHBOARD_STATS);
    console.log('🗑️ Invalidated batches and dashboard caches after batch update');

    res.status(200).json({
      success: true,
      message: 'Batch updated successfully',
      data: {
        batchId: batchId,
        ...updatedBatch.data()
      }
    });

  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update batch'
    });
  }
});

/**
 * List courses endpoint
 * GET /api/admin/courses
 * Admin-only endpoint to list all courses
 */
router.get('/courses', authMiddleware, requireAdmin, async (req, res) => {
  try {
    console.log('🎯 Admin courses endpoint hit with query:', req.query);
    const { limit = 20, offset = 0, category, isActive } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;

    // Create cache key based on query parameters
    const cacheKey = `${CacheKeys.COURSES_LIST}:${JSON.stringify({ limit: maxLimit, offset: offsetNum, category, isActive })}`;
    
    // Try to get from cache first
    const cachedCourses = CacheManager.get(cacheKey);
    if (cachedCourses) {
      console.log('🚀 Returning cached courses data');
      return res.status(200).json({
        ...cachedCourses,
        cached: true
      });
    }

    let query = firestore.collection('courses');

    // Filter by category if provided
    if (category) {
      query = query.where('category', '==', category);
    }

    // Filter by active status if provided
    if (isActive !== undefined) {
      const activeStatus = isActive === 'true';
      query = query.where('isActive', '==', activeStatus);
    }

    // Order by creation date (newest first) - only if createdAt field exists
    // For now, we'll skip ordering to avoid errors with missing createdAt fields
    // query = query.orderBy('createdAt', 'desc');

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    console.log('📊 Courses query snapshot size:', snapshot.size);
    const courses = [];

    snapshot.forEach(doc => {
      const courseData = {
        id: doc.id,
        courseId: doc.id, // Keep for backward compatibility
        ...doc.data()
      };
      courses.push(courseData);
      console.log('📋 Course added:', doc.id, courseData.title);
      console.log('📋 Full course data:', JSON.stringify(courseData, null, 2));
    });
    
    console.log('📦 Total courses to return:', courses.length);

    // Get total count for pagination
    let totalQuery = firestore.collection('courses');
    if (category) {
      totalQuery = totalQuery.where('category', '==', category);
    }
    if (isActive !== undefined) {
      const activeStatus = isActive === 'true';
      totalQuery = totalQuery.where('isActive', '==', activeStatus);
    }
    const totalSnapshot = await totalQuery.get();
    const totalCourses = totalSnapshot.size;

    const responseData = {
      success: true,
      data: {
        courses: courses,
        pagination: {
          total: totalCourses,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalCourses
        }
      }
    };

    // Cache the response for 5 minutes
    CacheManager.set(cacheKey, responseData, CacheTTL.MEDIUM);

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error listing courses:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list courses'
    });
  }
});

/**
 * Update course endpoint
 * PUT /api/admin/courses/:courseId
 * Admin-only endpoint to update existing courses
 */
router.put('/courses/:courseId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, category, thumbnailUrl, description, tags } = req.body;

    // Check if course exists
    const courseRef = firestore.collection('courses').doc(courseId);
    const courseDoc = await courseRef.get();
    
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Course Not Found',
        message: 'Course with the provided ID does not exist'
      });
    }

    // Validate URL format if thumbnailUrl is provided
    if (thumbnailUrl) {
      try {
        new URL(thumbnailUrl);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'thumbnailUrl must be a valid URL'
        });
      }
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date().toISOString()
    };

    if (title) updateData.title = title.trim();
    if (category) updateData.category = category.trim();
    if (thumbnailUrl) updateData.thumbnailUrl = thumbnailUrl.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];

    // Update course document
    await courseRef.update(updateData);

    // Get updated course data
    const updatedDoc = await courseRef.get();
    const updatedCourse = { id: courseId, ...updatedDoc.data() };

    res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse
    });

  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update course'
    });
  }
});

/**
 * Delete course endpoint
 * DELETE /api/admin/courses/:courseId
 * Admin-only endpoint to delete courses
 */
router.delete('/courses/:courseId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;

    // Check if course exists
    const courseRef = firestore.collection('courses').doc(courseId);
    const courseDoc = await courseRef.get();
    
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Course Not Found',
        message: 'Course with the provided ID does not exist'
      });
    }

    // Check if there are any batches associated with this course
    const batchesSnapshot = await firestore.collection('batches')
      .where('courseId', '==', courseId)
      .get();

    if (!batchesSnapshot.empty) {
      return res.status(400).json({
        error: 'Cannot Delete Course',
        message: 'Cannot delete course that has associated batches. Please delete all batches first.'
      });
    }

    // Delete the course
    await courseRef.delete();

    res.status(200).json({
      success: true,
      message: 'Course deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete course'
    });
  }
});

/**
 * Upload file endpoint
 * POST /api/admin/upload
 * Admin-only endpoint to upload files (images) to Firebase Storage
 */
router.post('/upload', authMiddleware, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No File Provided',
        message: 'Please select a file to upload'
      });
    }

    const file = req.file;
    const fileName = `course-thumbnails/${uuidv4()}-${file.originalname}`;
    const bucket = storage.bucket();
    const fileUpload = bucket.file(fileName);

    // Create a stream to upload the file
    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    return new Promise((resolve, reject) => {
      stream.on('error', (error) => {
        console.error('Upload error:', error);
        reject(error);
      });

      stream.on('finish', async () => {
        try {
          // Make the file publicly accessible
          await fileUpload.makePublic();
          
          // Get the public URL
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          
          resolve({
            success: true,
            data: {
              url: publicUrl,
              fileName: fileName
            },
            message: 'File uploaded successfully'
          });
        } catch (error) {
          console.error('Error making file public:', error);
          reject(error);
        }
      });

      stream.end(file.buffer);
    }).then((result) => {
      res.status(200).json(result);
    }).catch((error) => {
      throw error;
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to upload file'
    });
  }
});

/**
 * List batches endpoint
 * GET /api/admin/batches
 * Admin-only endpoint to list all batches
 */
router.get('/batches', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { limit = 20, offset = 0, courseId, status } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;

    // Create cache key based on query parameters
    const cacheKey = `batches:list:${JSON.stringify({ limit: maxLimit, offset: offsetNum, courseId, status })}`;
    
    // Try to get from cache first
    const cachedBatches = CacheManager.get(cacheKey);
    if (cachedBatches) {
      console.log('🚀 Returning cached batches data');
      return res.status(200).json({
        ...cachedBatches,
        cached: true
      });
    }

    let query = firestore.collection('batches');

    // Filter by courseId if provided
    if (courseId) {
      query = query.where('courseId', '==', courseId);
    }

    // Filter by status if provided
    if (status) {
      if (!['draft', 'published'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid Status',
          message: 'Status must be either "draft" or "published"'
        });
      }
      query = query.where('status', '==', status);
    }

    // Order by creation date (newest first)
    query = query.orderBy('createdAt', 'desc');

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    const batches = [];

    // Collect unique course IDs to batch fetch course details (optimize N+1 query)
    const courseIds = new Set();
    const batchesData = [];
    
    snapshot.docs.forEach(doc => {
      const batchData = doc.data();
      batchesData.push({
        batchId: doc.id,
        ...batchData
      });
      if (batchData.courseId) {
        courseIds.add(batchData.courseId);
      }
    });

    // Batch fetch all course details in one go
    const coursesMap = new Map();
    if (courseIds.size > 0) {
      try {
        const coursePromises = Array.from(courseIds).map(courseId => 
          firestore.collection('courses').doc(courseId).get()
        );
        const courseDocs = await Promise.all(coursePromises);
        
        courseDocs.forEach(courseDoc => {
          if (courseDoc.exists) {
            coursesMap.set(courseDoc.id, {
              courseId: courseDoc.id,
              title: courseDoc.data().title,
              category: courseDoc.data().category
            });
          }
        });
      } catch (error) {
        console.warn('Failed to batch fetch course info:', error);
      }
    }

    // Combine batch data with course info
    batchesData.forEach(batchData => {
      batches.push({
        ...batchData,
        courseInfo: coursesMap.get(batchData.courseId) || null
      });
    });

    // Get total count for pagination
    let totalQuery = firestore.collection('batches');
    if (courseId) {
      totalQuery = totalQuery.where('courseId', '==', courseId);
    }
    if (status) {
      totalQuery = totalQuery.where('status', '==', status);
    }
    const totalSnapshot = await totalQuery.get();
    const totalBatches = totalSnapshot.size;

    const responseData = {
      success: true,
      data: {
        batches: batches,
        pagination: {
          total: totalBatches,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalBatches
        }
      }
    };

    // Cache the response for 5 minutes
    CacheManager.set(cacheKey, responseData, CacheTTL.MEDIUM);
    console.log('💾 Cached batches data');

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error listing batches:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list batches'
    });
  }
});

/**
 * Create subject endpoint
 * POST /api/admin/batches/:batchId/subjects
 * Admin-only endpoint to create subjects linked to batches
 */
router.post('/batches/:batchId/subjects', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { title, description, teacherId } = req.body;

    // Validate required fields
    if (!title) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title is required'
      });
    }

    // Validate batchId
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Check if batch exists (batches are stored in courses subcollections)
    let batchDoc = null;
    let courseId = null;
    
    // First try to find in root batches collection (legacy)
    const rootBatchDoc = await firestore.collection('batches').doc(batchId).get();
    if (rootBatchDoc.exists) {
      batchDoc = rootBatchDoc;
      courseId = rootBatchDoc.data().courseId;
    } else {
      // Search in courses subcollections
      const coursesSnapshot = await firestore.collection('courses').get();
      for (const courseDoc of coursesSnapshot.docs) {
        const batchInCourse = await firestore.collection('courses').doc(courseDoc.id).collection('batches').doc(batchId).get();
        if (batchInCourse.exists) {
          batchDoc = batchInCourse;
          courseId = courseDoc.id;
          break;
        }
      }
    }
    
    if (!batchDoc) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }
    
    console.log('✅ Batch found in course:', courseId);

    // Initialize teacher data
    let teacherName = null;
    let teacherEmail = null;
    let assignedAt = null;
    let assignedBy = null;

    // If teacherId is provided, fetch teacher details
    if (teacherId && teacherId.trim() !== '') {
      const teacherDoc = await firestore.collection('users').doc(teacherId.trim()).get();
      if (!teacherDoc.exists) {
        return res.status(400).json({
          error: 'Teacher Not Found',
          message: 'Teacher with the provided ID does not exist'
        });
      }

      const teacherData = teacherDoc.data();
      if (teacherData.role !== 'teacher') {
        return res.status(400).json({
          error: 'Invalid Teacher',
          message: 'User is not a teacher'
        });
      }

      teacherName = teacherData.displayName || teacherData.name || teacherData.email.split('@')[0];
      teacherEmail = teacherData.email;
      assignedAt = new Date().toISOString();
      assignedBy = req.user.uid;
    }

    // Create subject document
    const subjectData = {
      title: title.trim(),
      batchId: batchId,
      description: description ? description.trim() : '',
      teacherId: teacherId && teacherId.trim() !== '' ? teacherId.trim() : null,
      teacherName: teacherName,
      teacherEmail: teacherEmail,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.uid,
      assignedAt: assignedAt,
      assignedBy: assignedBy
    };

    const subjectRef = await firestore.collection('subjects').add(subjectData);

    // If teacher is assigned, update teacher's user document with subject info
    if (teacherId && teacherId.trim() !== '') {
      try {
        const teacherUserRef = firestore.collection('users').doc(teacherId.trim());
        await teacherUserRef.update({
          [`assignedSubjects.${subjectRef.id}`]: {
            subjectId: subjectRef.id,
            title: subjectData.title,
            batchId: batchId,
            assignedAt: assignedAt,
            isActive: true
          },
          updatedAt: new Date().toISOString()
        });
        console.log('✅ Updated teacher user document with subject assignment');
      } catch (error) {
        console.warn('⚠️ Failed to update teacher user document:', error);
        // Don't fail the entire operation if user document update fails
      }
    }

    // Get batch information for response
    const batchData = batchDoc.data();

    res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: {
        subjectId: subjectRef.id,
        ...subjectData,
        batchInfo: {
          batchId: batchId,
          title: batchData.title
        }
      }
    });

  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create subject'
    });
  }
});

/**
 * Assign teacher to subject endpoint
 * PUT /api/admin/subjects/:subjectId/assign-teacher
 * Admin-only endpoint to assign teachers to subjects with email notification
 */
router.put('/subjects/:subjectId/assign-teacher', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { teacherId, teacherName, teacherEmail } = req.body;

    // Validate required fields
    if (!teacherId || !teacherName || !teacherEmail) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'teacherId, teacherName, and teacherEmail are required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(teacherEmail)) {
      return res.status(400).json({
        error: 'Invalid Email',
        message: 'teacherEmail must be a valid email address'
      });
    }

    // Validate subjectId
    if (!subjectId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Subject ID is required'
      });
    }

    // Check if subject exists
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    const subjectData = subjectDoc.data();

    // Verify teacher exists and has teacher role
    try {
      const teacherRecord = await auth.getUser(teacherId);
      const teacherDoc = await firestore.collection('users').doc(teacherId).get();
      
      if (!teacherDoc.exists) {
        return res.status(404).json({
          error: 'Teacher Not Found',
          message: 'Teacher user document does not exist'
        });
      }

      const teacherUserData = teacherDoc.data();
      if (teacherUserData.role !== 'teacher') {
        return res.status(400).json({
          error: 'Invalid Teacher Role',
          message: 'User must have teacher role to be assigned to subjects'
        });
      }
    } catch (error) {
      return res.status(404).json({
        error: 'Teacher Not Found',
        message: 'Teacher with the provided ID does not exist'
      });
    }

    // Get batch information for email
    const batchDoc = await firestore.collection('batches').doc(subjectData.batchId).get();
    if (!batchDoc.exists) {
      return res.status(500).json({
        error: 'Data Integrity Error',
        message: 'Associated batch not found'
      });
    }

    const batchData = batchDoc.data();

    // Update subject with teacher assignment
    const updateData = {
      teacherId: teacherId,
      teacherName: teacherName.trim(),
      teacherEmail: teacherEmail.trim().toLowerCase(),
      assignedAt: new Date().toISOString(),
      assignedBy: req.user.uid,
      updatedAt: new Date().toISOString()
    };

    await firestore.collection('subjects').doc(subjectId).update(updateData);

    // Update teacher's user document with subject assignment
    try {
      const teacherUserRef = firestore.collection('users').doc(teacherId);
      await teacherUserRef.update({
        [`assignedSubjects.${subjectId}`]: {
          subjectId: subjectId,
          title: subjectData.title,
          batchId: subjectData.batchId,
          assignedAt: updateData.assignedAt,
          isActive: true
        },
        updatedAt: new Date().toISOString()
      });
      console.log('✅ Updated teacher user document with subject assignment');
    } catch (error) {
      console.warn('⚠️ Failed to update teacher user document:', error);
      // Don't fail the entire operation if user document update fails
    }

    // Send email notification to teacher
    try {
      await emailService.sendTeacherAssignmentEmail({
        teacherEmail: teacherEmail.trim().toLowerCase(),
        teacherName: teacherName.trim(),
        subjectTitle: subjectData.title,
        batchTitle: batchData.title,
        dashboardUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
      });

      console.log(`📧 Assignment notification sent to ${teacherEmail}`);
    } catch (emailError) {
      console.error('⚠️ Failed to send email notification:', emailError);
      // Don't fail the request if email fails, but log the error
    }

    // Get updated subject data
    const updatedSubject = await firestore.collection('subjects').doc(subjectId).get();

    res.status(200).json({
      success: true,
      message: 'Teacher assigned successfully',
      data: {
        subjectId: subjectId,
        ...updatedSubject.data(),
        batchInfo: {
          batchId: subjectData.batchId,
          title: batchData.title
        }
      },
      emailSent: true // Indicates email notification was attempted
    });

  } catch (error) {
    console.error('Error assigning teacher to subject:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to assign teacher to subject'
    });
  }
});

/**
 * Get batch details endpoint
 * GET /api/admin/batches/:batchId
 * Admin-only endpoint to get details of a specific batch
 */
router.get('/batches/:batchId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Validate batchId
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Get batch details
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }

    const batchData = batchDoc.data();

    // Get course details if courseId exists
    let courseData = null;
    if (batchData.courseId) {
      const courseDoc = await firestore.collection('courses').doc(batchData.courseId).get();
      if (courseDoc.exists) {
        courseData = courseDoc.data();
      }
    }

    res.status(200).json({
      success: true,
      data: {
        batchId: batchId,
        ...batchData,
        course: courseData ? {
          courseId: batchData.courseId,
          ...courseData
        } : null
      }
    });

  } catch (error) {
    console.error('Error getting batch details:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get batch details'
    });
  }
});

/**
 * List subjects for a batch endpoint
 * GET /api/admin/batches/:batchId/subjects
 * Admin-only endpoint to list all subjects for a specific batch
 */
router.get('/batches/:batchId/subjects', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;
    
    console.log('🎯 GET subjects endpoint hit for batchId:', batchId);
    console.log('🔒 User:', req.user);
    console.log('📋 Query params:', { limit, offset });

    // Validate batchId
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Check if batch exists (batches are stored in courses subcollections)
    let batchDoc = null;
    let courseId = null;
    
    // First try to find in root batches collection (legacy)
    const rootBatchDoc = await firestore.collection('batches').doc(batchId).get();
    if (rootBatchDoc.exists) {
      batchDoc = rootBatchDoc;
      courseId = rootBatchDoc.data().courseId;
    } else {
      // Search in courses subcollections
      const coursesSnapshot = await firestore.collection('courses').get();
      for (const courseDoc of coursesSnapshot.docs) {
        const batchInCourse = await firestore.collection('courses').doc(courseDoc.id).collection('batches').doc(batchId).get();
        if (batchInCourse.exists) {
          batchDoc = batchInCourse;
          courseId = courseDoc.id;
          break;
        }
      }
    }
    
    if (!batchDoc) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }
    
    console.log('✅ Batch found in course:', courseId);
    const batchData = batchDoc.data();

    // Query subjects for the batch
    let query = firestore.collection('subjects')
      .where('batchId', '==', batchId)
      .where('isActive', '==', true);

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    const subjects = [];

    snapshot.forEach(doc => {
      subjects.push({
        subjectId: doc.id,
        ...doc.data()
      });
    });

    // Get total count for pagination
    const totalSnapshot = await firestore.collection('subjects')
      .where('batchId', '==', batchId)
      .where('isActive', '==', true)
      .get();
    const totalSubjects = totalSnapshot.size;

    res.status(200).json({
      success: true,
      data: {
        subjects: subjects,
        batchInfo: {
          batchId: batchId,
          title: batchData.title
        },
        pagination: {
          total: totalSubjects,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalSubjects
        }
      }
    });

  } catch (error) {
    console.error('Error listing subjects for batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list subjects for batch'
    });
  }
});

/**
 * Get single subject endpoint
 * GET /api/admin/subjects/:subjectId
 * Admin-only endpoint to get details of a specific subject
 */
router.get('/subjects/:subjectId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { subjectId } = req.params;

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

    // Get batch info
    const batchDoc = await firestore.collection('batches').doc(subjectData.batchId).get();
    const batchInfo = batchDoc.exists ? {
      batchId: subjectData.batchId,
      title: batchDoc.data().title
    } : null;

    res.status(200).json({
      success: true,
      data: {
        subjectId: subjectDoc.id,
        ...subjectData,
        batchInfo
      }
    });

  } catch (error) {
    console.error('Error fetching subject:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch subject'
    });
  }
});

/**
 * Update subject endpoint
 * PUT /api/admin/subjects/:subjectId
 * Admin-only endpoint to update subject details
 */
router.put('/subjects/:subjectId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { title, description, teacherId } = req.body;

    // Validate subjectId
    if (!subjectId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Subject ID is required'
      });
    }

    // Validate required fields
    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Subject title is required'
      });
    }

    if (title.length > 200) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Subject title must be less than 200 characters'
      });
    }

    // Check if subject exists
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    // Prepare base update data
    const updateData = {
      title: title.trim(),
      description: description?.trim() || '',
      updatedAt: new Date().toISOString()
    };

    // Handle teacher assignment if teacherId is provided in request body
    if (req.body.hasOwnProperty('teacherId')) {
      if (teacherId && teacherId.trim() !== '') {
        // Assign new teacher
        const teacherDoc = await firestore.collection('users').doc(teacherId.trim()).get();
        if (!teacherDoc.exists) {
          return res.status(400).json({
            error: 'Teacher Not Found',
            message: 'Teacher with the provided ID does not exist'
          });
        }

        const teacherData = teacherDoc.data();
        if (teacherData.role !== 'teacher') {
          return res.status(400).json({
            error: 'Invalid Teacher',
            message: 'User is not a teacher'
          });
        }

        updateData.teacherId = teacherId.trim();
        updateData.teacherName = teacherData.displayName || teacherData.name || teacherData.email.split('@')[0];
        updateData.teacherEmail = teacherData.email;
        updateData.assignedAt = new Date().toISOString();
        updateData.assignedBy = req.user.uid;
      } else {
        // Remove teacher assignment (teacherId is null or empty string)
        updateData.teacherId = null;
        updateData.teacherName = null;
        updateData.teacherEmail = null;
        updateData.assignedAt = null;
        updateData.assignedBy = null;
      }
    }

    // Get current subject data before update to handle teacher changes
    const currentSubject = subjectDoc.data();
    const oldTeacherId = currentSubject.teacherId;

    // Update subject
    await firestore.collection('subjects').doc(subjectId).update(updateData);

    // Handle teacher assignment changes in users collection
    if (req.body.hasOwnProperty('teacherId')) {
      // Remove subject from old teacher's document if there was one
      if (oldTeacherId && oldTeacherId.trim() !== '') {
        try {
          const oldTeacherRef = firestore.collection('users').doc(oldTeacherId.trim());
          await oldTeacherRef.update({
            [`assignedSubjects.${subjectId}`]: FieldValue.delete(),
            updatedAt: new Date().toISOString()
          });
          console.log('✅ Removed subject from old teacher user document');
        } catch (error) {
          console.warn('⚠️ Failed to remove subject from old teacher user document:', error);
        }
      }

      // Add subject to new teacher's document if assigned
      if (teacherId && teacherId.trim() !== '') {
        try {
          const newTeacherRef = firestore.collection('users').doc(teacherId.trim());
          await newTeacherRef.update({
            [`assignedSubjects.${subjectId}`]: {
              subjectId: subjectId,
              title: updateData.title,
              batchId: currentSubject.batchId,
              assignedAt: updateData.assignedAt,
              isActive: true
            },
            updatedAt: new Date().toISOString()
          });
          console.log('✅ Added subject to new teacher user document');
        } catch (error) {
          console.warn('⚠️ Failed to add subject to new teacher user document:', error);
        }
      }
    }

    // Get updated subject
    const updatedSubject = await firestore.collection('subjects').doc(subjectId).get();

    res.status(200).json({
      success: true,
      data: {
        subjectId: updatedSubject.id,
        ...updatedSubject.data()
      },
      message: 'Subject updated successfully'
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
 * Delete subject endpoint
 * DELETE /api/admin/subjects/:subjectId
 * Admin-only endpoint to soft delete a subject
 */
router.delete('/subjects/:subjectId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { subjectId } = req.params;

    // Validate subjectId
    if (!subjectId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Subject ID is required'
      });
    }

    // Check if subject exists
    const subjectDoc = await firestore.collection('subjects').doc(subjectId).get();
    if (!subjectDoc.exists) {
      return res.status(404).json({
        error: 'Subject Not Found',
        message: 'Subject with the provided ID does not exist'
      });
    }

    // Soft delete by setting isActive to false
    await firestore.collection('subjects').doc(subjectId).update({
      isActive: false,
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: 'Subject deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete subject'
    });
  }
});

/**
 * List all subjects endpoint
 * GET /api/admin/subjects
 * Admin-only endpoint to list all subjects across all batches
 */
router.get('/subjects', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { limit = 20, offset = 0, batchId, isActive = 'true' } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;
    const activeFilter = isActive === 'true';

    // Build query
    let query = firestore.collection('subjects')
      .where('isActive', '==', activeFilter)
      .orderBy('createdAt', 'desc');

    // Filter by batchId if provided
    if (batchId) {
      query = query.where('batchId', '==', batchId);
    }

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    const subjects = [];

    // Get batch info for each subject
    const batchCache = new Map();
    
    for (const doc of snapshot.docs) {
      const subjectData = doc.data();
      
      // Get batch info (with caching)
      let batchInfo = null;
      if (subjectData.batchId) {
        if (batchCache.has(subjectData.batchId)) {
          batchInfo = batchCache.get(subjectData.batchId);
        } else {
          const batchDoc = await firestore.collection('batches').doc(subjectData.batchId).get();
          if (batchDoc.exists) {
            batchInfo = {
              batchId: subjectData.batchId,
              title: batchDoc.data().title
            };
            batchCache.set(subjectData.batchId, batchInfo);
          }
        }
      }

      subjects.push({
        subjectId: doc.id,
        ...subjectData,
        batchInfo
      });
    }

    // Get total count for pagination
    let totalQuery = firestore.collection('subjects')
      .where('isActive', '==', activeFilter);
    
    if (batchId) {
      totalQuery = totalQuery.where('batchId', '==', batchId);
    }
    
    const totalSnapshot = await totalQuery.get();
    const totalSubjects = totalSnapshot.size;

    res.status(200).json({
      success: true,
      data: {
        subjects: subjects,
        pagination: {
          total: totalSubjects,
          limit: maxLimit,
          offset: offsetNum,
          hasMore: offsetNum + maxLimit < totalSubjects
        }
      }
    });

  } catch (error) {
    console.error('Error listing subjects:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list subjects'
    });
  }
});

/**
 * Publish batch endpoint
 * PUT /api/admin/batches/:batchId/publish
 * Admin-only endpoint to publish a batch after content validation
 */
router.put('/batches/:batchId/publish', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Validate batch ID
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Check if batch exists
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }

    const batchData = batchDoc.data();

    // Check if batch is already published
    if (batchData.status === 'published') {
      return res.status(400).json({
        error: 'Batch Already Published',
        message: 'This batch is already published'
      });
    }

    // Get all subjects for this batch
    const subjectsSnapshot = await firestore.collection('subjects')
      .where('batchId', '==', batchId)
      .where('isActive', '==', true)
      .get();

    if (subjectsSnapshot.empty) {
      return res.status(400).json({
        error: 'No Subjects Found',
        message: 'Cannot publish batch without any subjects'
      });
    }

    // Check content for each subject (minimum content validation)
    const subjectIds = [];
    subjectsSnapshot.forEach(doc => {
      subjectIds.push(doc.id);
    });

    // Check if there's at least one content item for each subject
    const contentValidation = await Promise.all(
      subjectIds.map(async (subjectId) => {
        const scheduleSnapshot = await firestore.collection('schedule')
          .where('subjectId', '==', subjectId)
          .where('batchId', '==', batchId)
          .limit(1)
          .get();
        
        return {
          subjectId,
          hasContent: !scheduleSnapshot.empty
        };
      })
    );

    // Find subjects without content
    const subjectsWithoutContent = contentValidation.filter(item => !item.hasContent);
    
    if (subjectsWithoutContent.length > 0) {
      // Get subject names for better error message
      const subjectNames = [];
      for (const item of subjectsWithoutContent) {
        const subjectDoc = await firestore.collection('subjects').doc(item.subjectId).get();
        if (subjectDoc.exists) {
          subjectNames.push(subjectDoc.data().name);
        }
      }

      return res.status(400).json({
        error: 'Insufficient Content',
        message: `Cannot publish batch. The following subjects have no scheduled content: ${subjectNames.join(', ')}`,
        details: {
          subjectsWithoutContent: subjectNames
        }
      });
    }

    // Update batch status to published
    await firestore.collection('batches').doc(batchId).update({
      status: 'published',
      publishedAt: new Date(),
      publishedBy: req.user.uid
    });

    // Invalidate related caches
    CacheManager.deletePattern('batches:*');
    CacheManager.delete(CacheKeys.ADMIN_DASHBOARD_STATS);
    console.log('🗑️ Invalidated batches and dashboard caches after batch publishing');

    // Send notification email to admin
    try {
      await emailService.sendEmail(
        req.user.email,
        'Batch Published Successfully',
        `The batch "${batchData.title}" has been successfully published and is now visible to students.`
      );
    } catch (emailError) {
      console.warn('Failed to send publication notification email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Batch published successfully',
      data: {
        batchId: batchId,
        title: batchData.title,
        status: 'published',
        publishedAt: new Date(),
        subjectsCount: subjectIds.length,
        contentValidation: contentValidation
      }
    });

  } catch (error) {
    console.error('Error publishing batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to publish batch'
    });
  }
});

/**
 * Create batch announcement endpoint
 * POST /api/admin/batches/:batchId/announcements
 * Admin-only endpoint to create announcements for a specific batch
 */
router.post('/batches/:batchId/announcements', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { title, content } = req.body;

    // Validate required fields
    if (!title || !content) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Title and content are required'
      });
    }

    // Validate batch ID
    if (!batchId) {
      return res.status(400).json({
        error: 'Invalid Request',
        message: 'Batch ID is required'
      });
    }

    // Check if batch exists
    const batchDoc = await firestore.collection('batches').doc(batchId).get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Batch Not Found',
        message: 'Batch with the provided ID does not exist'
      });
    }

    // Create announcement document
    const announcementData = {
      batchId: batchId,
      title: title.trim(),
      content: content.trim(),
      createdAt: new Date(),
      createdBy: req.user.uid,
      global: false
    };

    // Add announcement to Firestore
    const announcementRef = await firestore.collection('announcements').add(announcementData);

    const batchData = batchDoc.data();
    
    // Send notifications to all enrolled students
    try {
      // Get all enrolled students for this batch
      const enrollmentsSnapshot = await firestore.collection('enrollments')
        .where('batchId', '==', batchId)
        .get();
      
      const enrolledStudentIds = [];
      enrollmentsSnapshot.forEach(doc => {
        const enrollmentData = doc.data();
        enrolledStudentIds.push(enrollmentData.studentId);
      });
      
      if (enrolledStudentIds.length > 0) {
        // Send batch announcement notifications to all enrolled students
        await notificationService.sendBulkNotification(
          enrolledStudentIds,
          notificationService.notificationTypes.BATCH_ANNOUNCEMENT,
          {
            batchName: batchData.name || batchData.title,
            announcementTitle: title,
            announcementContent: content.length > 200 ? content.substring(0, 200) + '...' : content
          }
        );
        
        console.log(`✅ Batch announcement notifications sent to ${enrolledStudentIds.length} students`);
      }
    } catch (notificationError) {
      console.error('⚠️  Failed to send batch announcement notifications:', notificationError);
      // Don't fail the announcement creation if notifications fail
    }
    
    // Send notification email to admin
    try {
      await emailService.sendEmail({
        to: req.user.email,
        subject: 'Announcement Created',
        html: `Your announcement "${title}" has been created for batch "${batchData.name || batchData.title}".`
      });
    } catch (emailError) {
      console.warn('Failed to send announcement notification email:', emailError);
    }

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      data: {
        announcementId: announcementRef.id,
        ...announcementData,
        batchInfo: {
          title: batchData.title
        }
      }
    });

  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create announcement'
    });
  }
});

/**
 * Get dashboard statistics endpoint
 * GET /api/admin/dashboard/stats
 * Admin-only endpoint to get dashboard statistics
 */
router.get('/dashboard/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    // Try to get from cache first
    const cachedStats = CacheManager.get(CacheKeys.ADMIN_DASHBOARD_STATS);
    if (cachedStats) {
      console.log('🚀 Returning cached dashboard stats');
      return res.status(200).json({
        ...cachedStats,
        cached: true
      });
    }

    // Get total users count
    const usersSnapshot = await firestore.collection('users').get();
    const totalUsers = usersSnapshot.size;
    
    // Count users by role
    let studentCount = 0;
    let teacherCount = 0;
    let adminCount = 0;
    let activeUsers = 0;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      const role = userData.role || 'student';
      
      if (role === 'student') studentCount++;
      else if (role === 'teacher') teacherCount++;
      else if (role === 'admin') adminCount++;
      
      // Check if user was active in last 30 days
      if (userData.lastLoginAt && new Date(userData.lastLoginAt) > thirtyDaysAgo) {
        activeUsers++;
      }
    });
    
    // Get total courses count
    const coursesSnapshot = await firestore.collection('courses').get();
    const totalCourses = coursesSnapshot.size;
    
    // Get total batches count
    const batchesSnapshot = await firestore.collection('batches').get();
    const totalBatches = batchesSnapshot.size;
    
    // Get total enrollments and calculate revenue
    const enrollmentsSnapshot = await firestore.collection('enrollments').get();
    const totalEnrollments = enrollmentsSnapshot.size;
    
    let totalRevenue = 0;
    let monthlyRevenue = 0;
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    enrollmentsSnapshot.forEach(doc => {
      const enrollmentData = doc.data();
      if (enrollmentData.amount && enrollmentData.paymentStatus === 'completed') {
        totalRevenue += enrollmentData.amount;
        
        // Calculate monthly revenue
        if (enrollmentData.enrolledAt) {
          const enrollmentDate = new Date(enrollmentData.enrolledAt);
          if (enrollmentDate.getMonth() === currentMonth && enrollmentDate.getFullYear() === currentYear) {
            monthlyRevenue += enrollmentData.amount;
          }
        }
      }
    });
    
    // Get recent users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentUsersSnapshot = await firestore.collection('users')
      .where('createdAt', '>=', sevenDaysAgo.toISOString())
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    
    const recentUsers = [];
    recentUsersSnapshot.forEach(doc => {
      const userData = doc.data();
      recentUsers.push({
        id: doc.id,
        name: userData.name || userData.email?.split('@')[0] || 'Unknown',
        email: userData.email,
        role: userData.role || 'student',
        createdAt: userData.createdAt
      });
    });
    
    // Get recent courses
    const recentCoursesSnapshot = await firestore.collection('courses')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    
    const recentCourses = [];
    recentCoursesSnapshot.forEach(doc => {
      const courseData = doc.data();
      recentCourses.push({
        id: doc.id,
        title: courseData.title,
        category: courseData.category,
        createdAt: courseData.createdAt,
        isActive: courseData.isActive
      });
    });
    
    const responseData = {
      success: true,
      data: {
        userStats: {
          totalUsers,
          activeUsers,
          studentCount,
          teacherCount,
          adminCount,
          newRegistrations: recentUsers.length
        },
        courseStats: {
          totalCourses,
          totalBatches,
          totalEnrollments
        },
        revenueStats: {
          totalRevenue,
          monthlyRevenue
        },
        recentUsers,
        recentCourses
      }
    };

    // Cache the dashboard stats for 2 minutes (shorter TTL due to dynamic data)
    CacheManager.set(CacheKeys.ADMIN_DASHBOARD_STATS, responseData, CacheTTL.SHORT * 2);

    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error getting dashboard statistics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get dashboard statistics'
    });
  }
});

/**
 * Get enrollment analytics endpoint
 * GET /api/admin/analytics/enrollments
 * Admin-only endpoint to get detailed enrollment statistics
 */
router.get('/analytics/enrollments', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { timeframe = '30d', batchId, courseId } = req.query;
    
    // Create cache key based on query parameters
    const cacheKey = `analytics:enrollments:${JSON.stringify({ timeframe, batchId, courseId })}`;
    
    // Try to get from cache first
    const cachedAnalytics = CacheManager.get(cacheKey);
    if (cachedAnalytics) {
      console.log('🚀 Returning cached enrollment analytics data');
      return res.status(200).json({
        ...cachedAnalytics,
        cached: true
      });
    }
    
    // Calculate date range based on timeframe
    let startDate = new Date();
    switch (timeframe) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Build query for enrollments
    let enrollmentQuery = firestore.collection('enrollments')
      .where('enrolledAt', '>=', startDate.toISOString())
      .orderBy('enrolledAt', 'desc');
    
    if (batchId) {
      enrollmentQuery = enrollmentQuery.where('batchId', '==', batchId);
    }
    
    const enrollmentSnapshot = await enrollmentQuery.get();
    const enrollments = [];
    const dailyEnrollments = {};
    const batchEnrollments = {};
    const courseEnrollments = {};
    
    // Collect unique batch IDs to optimize N+1 query
    const batchIds = new Set();
    
    // Process enrollment data
    enrollmentSnapshot.docs.forEach(doc => {
      const enrollmentData = doc.data();
      enrollments.push({
        id: doc.id,
        ...enrollmentData
      });
      
      // Group by date
      const enrollmentDate = new Date(enrollmentData.enrolledAt).toISOString().split('T')[0];
      dailyEnrollments[enrollmentDate] = (dailyEnrollments[enrollmentDate] || 0) + 1;
      
      // Group by batch
      batchEnrollments[enrollmentData.batchId] = (batchEnrollments[enrollmentData.batchId] || 0) + 1;
      
      // Collect batch IDs for batch fetching
      if (enrollmentData.batchId) {
        batchIds.add(enrollmentData.batchId);
      }
    });
    
    // Batch fetch all batch data to get course IDs (optimize N+1 query)
    if (batchIds.size > 0) {
      try {
        const batchPromises = Array.from(batchIds).map(batchId => 
          firestore.collection('batches').doc(batchId).get()
        );
        const batchDocs = await Promise.all(batchPromises);
        
        batchDocs.forEach(batchDoc => {
          if (batchDoc.exists) {
            const batchData = batchDoc.data();
            const courseId = batchData.courseId;
            if (courseId) {
              const batchEnrollmentCount = batchEnrollments[batchDoc.id] || 0;
              courseEnrollments[courseId] = (courseEnrollments[courseId] || 0) + batchEnrollmentCount;
            }
          }
        });
      } catch (error) {
        console.warn('Error batch fetching batch data:', error);
      }
    }
    
    // Calculate growth rate
    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setTime(previousPeriodStart.getTime() - (Date.now() - startDate.getTime()));
    
    const previousEnrollmentSnapshot = await firestore.collection('enrollments')
      .where('enrolledAt', '>=', previousPeriodStart.toISOString())
      .where('enrolledAt', '<', startDate.toISOString())
      .get();
    
    const previousEnrollmentCount = previousEnrollmentSnapshot.size;
    const currentEnrollmentCount = enrollments.length;
    const growthRate = previousEnrollmentCount > 0 
      ? ((currentEnrollmentCount - previousEnrollmentCount) / previousEnrollmentCount) * 100 
      : 0;
    
    const responseData = {
      success: true,
      data: {
        totalEnrollments: currentEnrollmentCount,
        growthRate: Math.round(growthRate * 100) / 100,
        dailyEnrollments,
        topBatches: Object.entries(batchEnrollments)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([batchId, count]) => ({ batchId, enrollments: count })),
        topCourses: Object.entries(courseEnrollments)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .map(([courseId, count]) => ({ courseId, enrollments: count })),
        timeframe,
        dateRange: {
          start: startDate.toISOString(),
          end: new Date().toISOString()
        }
      }
    };
    
    // Cache the response for 10 minutes (analytics data can be slightly stale)
    CacheManager.set(cacheKey, responseData, CacheTTL.LONG);
    console.log('💾 Cached enrollment analytics data');
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error getting enrollment analytics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get enrollment analytics'
    });
  }
});

/**
 * Get progress tracking analytics endpoint
 * GET /api/admin/analytics/progress
 * Admin-only endpoint to get student progress statistics
 */
router.get('/analytics/progress', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { batchId, courseId, studentId } = req.query;
    
    // Create cache key based on query parameters
    const cacheKey = `analytics:progress:${JSON.stringify({ batchId, courseId, studentId })}`;
    
    // Try to get from cache first
    const cachedProgress = CacheManager.get(cacheKey);
    if (cachedProgress) {
      console.log('🚀 Returning cached progress analytics data');
      return res.status(200).json({
        ...cachedProgress,
        cached: true
      });
    }
    
    // Build base query for enrollments
    let enrollmentQuery = firestore.collection('enrollments');
    
    if (batchId) {
      enrollmentQuery = enrollmentQuery.where('batchId', '==', batchId);
    }
    if (studentId) {
      enrollmentQuery = enrollmentQuery.where('studentId', '==', studentId);
    }
    
    const enrollmentSnapshot = await enrollmentQuery.get();
    const progressData = {
      totalStudents: 0,
      activeStudents: 0,
      completedStudents: 0,
      averageProgress: 0,
      progressDistribution: {
        '0-25': 0,
        '26-50': 0,
        '51-75': 0,
        '76-100': 0
      },
      batchProgress: {},
      recentActivity: []
    };
    
    let totalProgress = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    for (const doc of enrollmentSnapshot.docs) {
      const enrollmentData = doc.data();
      progressData.totalStudents++;
      
      // Calculate progress (mock calculation - in real app, this would be based on completed lessons/assignments)
      const progress = enrollmentData.progress || 0;
      totalProgress += progress;
      
      // Check if student is active (has activity in last 30 days)
      const lastActivity = enrollmentData.lastActivityAt ? new Date(enrollmentData.lastActivityAt) : new Date(enrollmentData.enrolledAt);
      if (lastActivity >= thirtyDaysAgo) {
        progressData.activeStudents++;
      }
      
      // Check if completed
      if (progress >= 100) {
        progressData.completedStudents++;
      }
      
      // Progress distribution
      if (progress <= 25) {
        progressData.progressDistribution['0-25']++;
      } else if (progress <= 50) {
        progressData.progressDistribution['26-50']++;
      } else if (progress <= 75) {
        progressData.progressDistribution['51-75']++;
      } else {
        progressData.progressDistribution['76-100']++;
      }
      
      // Batch progress
      if (enrollmentData.batchId) {
        if (!progressData.batchProgress[enrollmentData.batchId]) {
          progressData.batchProgress[enrollmentData.batchId] = {
            totalStudents: 0,
            averageProgress: 0,
            completedStudents: 0
          };
        }
        progressData.batchProgress[enrollmentData.batchId].totalStudents++;
        progressData.batchProgress[enrollmentData.batchId].averageProgress += progress;
        if (progress >= 100) {
          progressData.batchProgress[enrollmentData.batchId].completedStudents++;
        }
      }
      
      // Recent activity
      if (lastActivity >= thirtyDaysAgo) {
        progressData.recentActivity.push({
          studentId: enrollmentData.studentId,
          batchId: enrollmentData.batchId,
          progress: progress,
          lastActivity: lastActivity.toISOString()
        });
      }
    }
    
    // Calculate averages
    progressData.averageProgress = progressData.totalStudents > 0 
      ? Math.round((totalProgress / progressData.totalStudents) * 100) / 100 
      : 0;
    
    // Calculate batch averages
    Object.keys(progressData.batchProgress).forEach(batchId => {
      const batchData = progressData.batchProgress[batchId];
      batchData.averageProgress = batchData.totalStudents > 0 
        ? Math.round((batchData.averageProgress / batchData.totalStudents) * 100) / 100 
        : 0;
    });
    
    // Sort recent activity by date
    progressData.recentActivity.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    progressData.recentActivity = progressData.recentActivity.slice(0, 20); // Limit to 20 recent activities
    
    const responseData = {
      success: true,
      data: progressData
    };
    
    // Cache the response for 10 minutes (progress data can be slightly stale)
    CacheManager.set(cacheKey, responseData, CacheTTL.LONG);
    console.log('💾 Cached progress analytics data');
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error getting progress analytics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get progress analytics'
    });
  }
});

/**
 * Get revenue analytics endpoint
 * GET /api/admin/analytics/revenue
 * Admin-only endpoint to get detailed revenue statistics
 */
router.get('/analytics/revenue', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { timeframe = '30d', courseId, batchId } = req.query;
    
    // Create cache key based on query parameters
    const cacheKey = `analytics:revenue:${JSON.stringify({ timeframe, courseId, batchId })}`;
    
    // Try to get from cache first
    const cachedRevenue = CacheManager.get(cacheKey);
    if (cachedRevenue) {
      console.log('🚀 Returning cached revenue analytics data');
      return res.status(200).json({
        ...cachedRevenue,
        cached: true
      });
    }
    
    // Calculate date range
    let startDate = new Date();
    switch (timeframe) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Build query for enrollments with payment data
    let enrollmentQuery = firestore.collection('enrollments')
      .where('enrolledAt', '>=', startDate.toISOString())
      .where('paymentStatus', '==', 'completed')
      .orderBy('enrolledAt', 'desc');
    
    if (batchId) {
      enrollmentQuery = enrollmentQuery.where('batchId', '==', batchId);
    }
    
    const enrollmentSnapshot = await enrollmentQuery.get();
    
    const revenueData = {
      totalRevenue: 0,
      totalTransactions: 0,
      averageOrderValue: 0,
      dailyRevenue: {},
      monthlyRevenue: {},
      courseRevenue: {},
      batchRevenue: {},
      paymentMethods: {},
      topPerformingCourses: [],
      recentTransactions: []
    };
    
    for (const doc of enrollmentSnapshot.docs) {
      const enrollmentData = doc.data();
      const amount = enrollmentData.amount || 0;
      const enrollmentDate = new Date(enrollmentData.enrolledAt);
      
      revenueData.totalRevenue += amount;
      revenueData.totalTransactions++;
      
      // Daily revenue
      const dateKey = enrollmentDate.toISOString().split('T')[0];
      revenueData.dailyRevenue[dateKey] = (revenueData.dailyRevenue[dateKey] || 0) + amount;
      
      // Monthly revenue
      const monthKey = `${enrollmentDate.getFullYear()}-${String(enrollmentDate.getMonth() + 1).padStart(2, '0')}`;
      revenueData.monthlyRevenue[monthKey] = (revenueData.monthlyRevenue[monthKey] || 0) + amount;
      
      // Batch revenue
      if (enrollmentData.batchId) {
        revenueData.batchRevenue[enrollmentData.batchId] = (revenueData.batchRevenue[enrollmentData.batchId] || 0) + amount;
      }
      
      // Payment methods
      const paymentMethod = enrollmentData.paymentMethod || 'unknown';
      revenueData.paymentMethods[paymentMethod] = (revenueData.paymentMethods[paymentMethod] || 0) + amount;
      
      // Recent transactions
      revenueData.recentTransactions.push({
        id: doc.id,
        studentId: enrollmentData.studentId,
        batchId: enrollmentData.batchId,
        amount: amount,
        paymentMethod: paymentMethod,
        date: enrollmentData.enrolledAt
      });
    }
    
    // Calculate average order value
    revenueData.averageOrderValue = revenueData.totalTransactions > 0 
      ? Math.round((revenueData.totalRevenue / revenueData.totalTransactions) * 100) / 100 
      : 0;
    
    // Batch fetch course revenue data (optimize N+1 query)
    const batchIds = Object.keys(revenueData.batchRevenue);
    if (batchIds.length > 0) {
      try {
        const batchPromises = batchIds.map(batchId => 
          firestore.collection('batches').doc(batchId).get()
        );
        const batchDocs = await Promise.all(batchPromises);
        
        batchDocs.forEach(batchDoc => {
          if (batchDoc.exists) {
            const batchData = batchDoc.data();
            const courseId = batchData.courseId;
            if (courseId) {
              const revenue = revenueData.batchRevenue[batchDoc.id] || 0;
              revenueData.courseRevenue[courseId] = (revenueData.courseRevenue[courseId] || 0) + revenue;
            }
          }
        });
      } catch (error) {
        console.warn('Error batch fetching batch data for revenue:', error);
      }
    }
    
    // Sort and limit recent transactions
    revenueData.recentTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    revenueData.recentTransactions = revenueData.recentTransactions.slice(0, 20);
    
    // Top performing courses
    revenueData.topPerformingCourses = Object.entries(revenueData.courseRevenue)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([courseId, revenue]) => ({ courseId, revenue }));
    
    const responseData = {
      success: true,
      data: revenueData
    };
    
    // Cache the response for 10 minutes (revenue data can be slightly stale)
    CacheManager.set(cacheKey, responseData, CacheTTL.LONG);
    console.log('💾 Cached revenue analytics data');
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error getting revenue analytics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get revenue analytics'
    });
  }
});

/**
 * Get course performance analytics endpoint
 * GET /api/admin/analytics/courses
 * Admin-only endpoint to get detailed course performance statistics
 */
router.get('/analytics/courses', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId, limit = 20 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    // Create cache key based on query parameters
    const cacheKey = `analytics:courses:${JSON.stringify({ courseId, limit: maxLimit })}`;
    
    // Try to get from cache first
    const cachedCourses = CacheManager.get(cacheKey);
    if (cachedCourses) {
      console.log('🚀 Returning cached course analytics data');
      return res.status(200).json({
        ...cachedCourses,
        cached: true
      });
    }
    
    // Build query for courses
    let courseQuery = firestore.collection('courses')
      .where('isActive', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(maxLimit);
    
    if (courseId) {
      courseQuery = firestore.collection('courses').doc(courseId);
      const courseDoc = await courseQuery.get();
      if (!courseDoc.exists) {
        return res.status(404).json({
          error: 'Course Not Found',
          message: 'Course with the provided ID does not exist'
        });
      }
    }
    
    const courseSnapshot = courseId ? null : await courseQuery.get();
    const courses = courseId ? [{ id: courseId, ...courseDoc.data() }] : 
      courseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const courseAnalytics = [];
    
    // Batch fetch all batches for all courses to optimize N+1 queries
    const courseIds = courses.map(course => course.id);
    const batchPromises = courseIds.map(courseId => 
      firestore.collection('batches').where('courseId', '==', courseId).get()
    );
    const batchSnapshots = await Promise.all(batchPromises);
    
    // Create a map of courseId to batches
    const courseBatchesMap = {};
    batchSnapshots.forEach((snapshot, index) => {
      const courseId = courseIds[index];
      courseBatchesMap[courseId] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    });
    
    // Collect all batch IDs for enrollment queries
    const allBatchIds = Object.values(courseBatchesMap).flat().map(batch => batch.id);
    
    // Batch fetch all enrollments for all batches
    const enrollmentPromises = allBatchIds.map(batchId => 
      firestore.collection('enrollments').where('batchId', '==', batchId).get()
    );
    const enrollmentSnapshots = await Promise.all(enrollmentPromises);
    
    // Create a map of batchId to enrollments
    const batchEnrollmentsMap = {};
    enrollmentSnapshots.forEach((snapshot, index) => {
      const batchId = allBatchIds[index];
      batchEnrollmentsMap[batchId] = snapshot.docs.map(doc => doc.data());
    });
    
    for (const course of courses) {
      const batches = courseBatchesMap[course.id] || [];
      const totalBatches = batches.length;
      const activeBatches = batches.filter(batch => batch.status === 'active').length;
      
      // Calculate enrollments for all batches of this course
      let totalEnrollments = 0;
      let totalRevenue = 0;
      let completedEnrollments = 0;
      
      for (const batch of batches) {
        const enrollments = batchEnrollmentsMap[batch.id] || [];
        
        enrollments.forEach(enrollmentData => {
          totalEnrollments++;
          if (enrollmentData.paymentStatus === 'completed') {
            totalRevenue += enrollmentData.amount || 0;
          }
          if (enrollmentData.progress >= 100) {
            completedEnrollments++;
          }
        });
      }
      
      // Calculate metrics
      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;
      const averageRevenuePerStudent = totalEnrollments > 0 ? totalRevenue / totalEnrollments : 0;
      
      courseAnalytics.push({
        courseId: course.id,
        title: course.title,
        category: course.category,
        createdAt: course.createdAt,
        isActive: course.isActive,
        metrics: {
          totalBatches,
          activeBatches,
          totalEnrollments,
          completedEnrollments,
          completionRate: Math.round(completionRate * 100) / 100,
          totalRevenue,
          averageRevenuePerStudent: Math.round(averageRevenuePerStudent * 100) / 100
        },
        batches: batches.map(batch => ({
          id: batch.id,
          name: batch.name,
          status: batch.status,
          startDate: batch.startDate,
          endDate: batch.endDate
        }))
      });
    }
    
    // Sort by total revenue if multiple courses
    if (!courseId) {
      courseAnalytics.sort((a, b) => b.metrics.totalRevenue - a.metrics.totalRevenue);
    }
    
    const responseData = {
      success: true,
      data: {
        courses: courseAnalytics,
        summary: {
          totalCourses: courseAnalytics.length,
          totalEnrollments: courseAnalytics.reduce((sum, course) => sum + course.metrics.totalEnrollments, 0),
          totalRevenue: courseAnalytics.reduce((sum, course) => sum + course.metrics.totalRevenue, 0),
          averageCompletionRate: courseAnalytics.length > 0 
            ? courseAnalytics.reduce((sum, course) => sum + course.metrics.completionRate, 0) / courseAnalytics.length 
            : 0
        }
      }
    };
    
    // Cache the response for 10 minutes (course analytics can be slightly stale)
    CacheManager.set(cacheKey, responseData, CacheTTL.LONG);
    console.log('💾 Cached course analytics data');
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error getting course analytics:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get course analytics'
    });
  }
});

// ===== BATCH MANAGEMENT ROUTES =====

/**
 * Get course details endpoint
 * GET /api/admin/courses/:courseId
 * Admin-only endpoint to get specific course details
 */
router.get('/courses/:courseId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    console.log(`🎯 Get course details endpoint hit for courseId: ${courseId}`);

    if (!courseId) {
      console.log('❌ Course ID missing');
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Course ID is required'
      });
    }

    console.log(`📚 Fetching course document for ID: ${courseId}`);
    const courseDoc = await firestore.collection('courses').doc(courseId).get();

    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Course not found'
      });
    }

    const courseData = {
      id: courseDoc.id,
      ...courseDoc.data()
    };

    res.status(200).json({
      success: true,
      data: courseData
    });

  } catch (error) {
    console.error('Error getting course:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get course details'
    });
  }
});

/**
 * List batches for a course endpoint
 * GET /api/admin/courses/:courseId/batches
 * Admin-only endpoint to list all batches for a specific course
 */
router.get('/courses/:courseId/batches', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { limit = 20, offset = 0, status } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset) || 0;
    console.log(`🎯 Get batches endpoint hit for courseId: ${courseId}, query:`, { limit, offset, status });
    console.log('🔒 User:', req.user);
    console.log('📋 Headers:', req.headers.authorization ? 'Auth header present' : 'No auth header');

    if (!courseId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Course ID is required'
      });
    }

    // Verify course exists
    const courseDoc = await firestore.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Course not found'
      });
    }

    let query = firestore.collection('courses').doc(courseId).collection('batches');

    // Filter by status if provided
    if (status) {
      query = query.where('status', '==', status);
    }

    // Order by creation date (newest first)
    query = query.orderBy('createdAt', 'desc');

    // Apply pagination
    if (offsetNum > 0) {
      query = query.offset(offsetNum);
    }
    query = query.limit(maxLimit);

    const snapshot = await query.get();
    const batches = [];

    console.log(`🔍 Query returned ${snapshot.size} documents`);
    snapshot.forEach(doc => {
      const batchData = {
        id: doc.id,
        ...doc.data()
      };
      console.log(`📄 Batch ${doc.id}:`, JSON.stringify(batchData, null, 2));
      batches.push(batchData);
    });

    // Get total count for pagination (without orderBy to get all documents)
    let totalQuery = firestore.collection('courses').doc(courseId).collection('batches');
    if (status) {
      totalQuery = totalQuery.where('status', '==', status);
    }
    const totalSnapshot = await totalQuery.get();
    const totalBatches = totalSnapshot.size;

    console.log(`📦 Returning ${batches.length} batches out of ${totalBatches} total`);
    
    res.status(200).json({
      success: true,
      data: {
        batches: batches
      },
      pagination: {
        total: totalBatches,
        limit: maxLimit,
        offset: offsetNum,
        hasMore: offsetNum + maxLimit < totalBatches
      }
    });

  } catch (error) {
    console.error('Error listing batches:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list batches'
    });
  }
});

/**
 * Create batch endpoint
 * POST /api/admin/courses/:courseId/batches
 * Admin-only endpoint to create new batch for a course
 */
router.post('/courses/:courseId/batches', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, name, description, startDate, endDate, maxStudents, price, thumbnailUrl } = req.body;
    
    // Use title if provided, fallback to name for backward compatibility
    const batchTitle = title || name;

    // Validate required fields
    if (!batchTitle || !description || !startDate || !endDate || !maxStudents) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title, description, startDate, endDate, and maxStudents are required fields'
      });
    }
    
    // Validate price if provided
    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Price must be a valid number greater than or equal to 0'
        });
      }
    }

    // Validate thumbnail URL if provided
    if (thumbnailUrl) {
      try {
        new URL(thumbnailUrl);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'thumbnailUrl must be a valid URL'
        });
      }
    }

    // Validate course exists
    const courseDoc = await firestore.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Course not found'
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();

    if (start >= end) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'End date must be after start date'
      });
    }

    // Validate maxStudents
    const maxStudentsNum = parseInt(maxStudents);
    if (isNaN(maxStudentsNum) || maxStudentsNum < 1) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Maximum students must be at least 1'
      });
    }

    // Determine batch status based on dates
    let status = 'upcoming';
    if (start <= now && end >= now) {
      status = 'ongoing';
    } else if (end < now) {
      status = 'completed';
    }

    // Create batch document
    const batchData = {
      title: batchTitle.trim(),
      name: batchTitle.trim(), // Keep for backward compatibility
      description: description.trim(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      maxStudents: maxStudentsNum,
      enrolledStudents: 0,
      status: status,
      price: price ? parseFloat(price) : 0,
      thumbnailUrl: thumbnailUrl ? thumbnailUrl.trim() : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.uid
    };

    console.log('🎯 Creating batch with data:', JSON.stringify(batchData, null, 2));
    console.log('🎯 Course ID:', courseId);
    console.log('🎯 Firestore path:', `courses/${courseId}/batches`);

    const batchRef = await firestore.collection('courses').doc(courseId).collection('batches').add(batchData);
    console.log('✅ Batch created successfully with ID:', batchRef.id);

    const responseData = {
      success: true,
      message: 'Batch created successfully',
      data: {
        id: batchRef.id,
        ...batchData
      }
    };

    console.log('📤 Sending response:', JSON.stringify(responseData, null, 2));
    res.status(201).json(responseData);

  } catch (error) {
    console.error('Error creating batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create batch'
    });
  }
});

/**
 * Update batch endpoint
 * PUT /api/admin/courses/:courseId/batches/:batchId
 * Admin-only endpoint to update existing batch
 */
router.put('/courses/:courseId/batches/:batchId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId, batchId } = req.params;
    const { title, name, description, startDate, endDate, maxStudents, price, thumbnailUrl } = req.body;
    
    // Use title if provided, fallback to name for backward compatibility
    const batchTitle = title || name;

    // Validate required fields
    if (!batchTitle || !description || !startDate || !endDate || !maxStudents) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Title, description, startDate, endDate, and maxStudents are required fields'
      });
    }
    
    // Validate price if provided
    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Price must be a valid number greater than or equal to 0'
        });
      }
    }

    // Validate thumbnail URL if provided
    if (thumbnailUrl) {
      try {
        new URL(thumbnailUrl);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'thumbnailUrl must be a valid URL'
        });
      }
    }

    // Validate course exists
    const courseDoc = await firestore.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Course not found'
      });
    }

    // Validate batch exists
    const batchRef = firestore.collection('courses').doc(courseId).collection('batches').doc(batchId);
    const batchDoc = await batchRef.get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Batch not found'
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();

    if (start >= end) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'End date must be after start date'
      });
    }

    // Validate maxStudents
    const maxStudentsNum = parseInt(maxStudents);
    if (isNaN(maxStudentsNum) || maxStudentsNum < 1) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Maximum students must be at least 1'
      });
    }

    const currentData = batchDoc.data();
    
    // Check if new maxStudents is less than current enrolled students
    if (maxStudentsNum < (currentData.enrolledStudents || 0)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Maximum students cannot be less than currently enrolled students (${currentData.enrolledStudents})`
      });
    }

    // Determine batch status based on dates
    let status = 'upcoming';
    if (start <= now && end >= now) {
      status = 'ongoing';
    } else if (end < now) {
      status = 'completed';
    }

    // Update batch document
    const updateData = {
      title: batchTitle.trim(),
      name: batchTitle.trim(), // Keep for backward compatibility
      description: description.trim(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      maxStudents: maxStudentsNum,
      status: status,
      price: price !== undefined ? parseFloat(price) : (currentData.price || 0),
      thumbnailUrl: thumbnailUrl ? thumbnailUrl.trim() : '',
      updatedAt: new Date().toISOString()
    };

    await batchRef.update(updateData);

    // Get updated batch data
    const updatedBatch = await batchRef.get();
    const updatedBatchData = {
      id: updatedBatch.id,
      ...updatedBatch.data()
    };

    res.status(200).json({
      success: true,
      message: 'Batch updated successfully',
      data: updatedBatchData
    });

  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update batch'
    });
  }
});

/**
 * Delete batch endpoint
 * DELETE /api/admin/courses/:courseId/batches/:batchId
 * Admin-only endpoint to delete a batch
 */
router.delete('/courses/:courseId/batches/:batchId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { courseId, batchId } = req.params;

    // Validate course exists
    const courseDoc = await firestore.collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Course not found'
      });
    }

    // Validate batch exists
    const batchRef = firestore.collection('courses').doc(courseId).collection('batches').doc(batchId);
    const batchDoc = await batchRef.get();
    if (!batchDoc.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Batch not found'
      });
    }

    const batchData = batchDoc.data();
    
    // Check if batch has enrolled students
    if (batchData.enrolledStudents && batchData.enrolledStudents > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Cannot delete batch with enrolled students. Current enrollments: ${batchData.enrolledStudents}`
      });
    }

    // Delete the batch
    await batchRef.delete();

    res.status(200).json({
      success: true,
      message: 'Batch deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete batch'
    });
  }
});

// ============================================================================
// PLATFORM SETTINGS ENDPOINTS
// ============================================================================

const { mergeWithDefaults, getDefaultSettings } = require('../config/defaults');

/**
 * Get platform settings
 * GET /api/admin/settings
 * Returns merged settings with defaults as fallback
 */
router.get('/settings', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const cacheKey = CacheKeys.ADMIN_SETTINGS;
    
    // Try to get from cache first
    const cachedSettings = CacheManager.get(cacheKey);
    if (cachedSettings) {
      console.log('🚀 Returning cached settings data');
      return res.status(200).json({
        ...cachedSettings,
        cached: true
      });
    }
    
    let dbSettings = {};
    
    try {
      // Try to fetch settings from Firestore
      const settingsDoc = await firestore.collection('platformSettings').doc('main_config').get();
      
      if (settingsDoc.exists) {
        dbSettings = settingsDoc.data();
      }
    } catch (dbError) {
      // Log the database error but don't fail the request
      console.warn('Warning: Could not fetch settings from database:', dbError.message);
      // dbSettings remains empty object, will use defaults
    }
    
    // Always merge with defaults to ensure complete settings object
    const completeSettings = mergeWithDefaults(dbSettings);
    
    const responseData = {
      success: true,
      data: completeSettings,
      message: 'Settings retrieved successfully'
    };
    
    // Cache settings for 30 minutes (settings change infrequently)
    CacheManager.set(cacheKey, responseData, CacheTTL.EXTRA_LONG);
    console.log('💾 Cached settings data');
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Error in settings endpoint:', error);
    
    // Even if there's an error, return defaults to prevent frontend crashes
    const defaultSettings = getDefaultSettings();
    
    res.status(200).json({
      success: true,
      data: defaultSettings,
      message: 'Settings retrieved (using defaults due to error)',
      warning: 'Database settings could not be loaded'
    });
  }
});

/**
 * Update platform settings
 * PUT /api/admin/settings
 * Updates specific settings fields without overwriting entire document
 */
router.put('/settings', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const settingsUpdate = req.body;
    
    // Validate that we have some data to update
    if (!settingsUpdate || Object.keys(settingsUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No settings data provided for update'
        }
      });
    }
    
    // Add timestamp for the update
    const updateData = {
      ...settingsUpdate,
      updatedAt: new Date().toISOString()
    };
    
    // Update the settings document (create if doesn't exist)
    const settingsRef = firestore.collection('platformSettings').doc('main_config');
    
    // Use merge: true to only update provided fields
    await settingsRef.set(updateData, { merge: true });
    
    // Fetch the updated settings to return complete object
    const updatedDoc = await settingsRef.get();
    const dbSettings = updatedDoc.exists ? updatedDoc.data() : {};
    
    // Merge with defaults for complete response
    const completeSettings = mergeWithDefaults(dbSettings);
    
    // Invalidate settings cache
    CacheManager.del(CacheKeys.ADMIN_SETTINGS);
    console.log('🗑️ Invalidated settings cache after update');
    
    res.status(200).json({
      success: true,
      data: completeSettings,
      message: 'Settings updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating settings:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update settings',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }
});

/**
 * Reset platform settings to defaults
 * POST /api/admin/settings/reset
 * Resets all settings to default values
 */
router.post('/settings/reset', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const defaultSettings = getDefaultSettings();
    
    // Reset the settings document to defaults
    const settingsRef = firestore.collection('platformSettings').doc('main_config');
    await settingsRef.set(defaultSettings);
    
    // Invalidate settings cache
    CacheManager.del(CacheKeys.ADMIN_SETTINGS);
    console.log('🗑️ Invalidated settings cache after reset');
    
    res.status(200).json({
      success: true,
      data: defaultSettings,
      message: 'Settings reset to defaults successfully'
    });
    
  } catch (error) {
    console.error('Error resetting settings:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to reset settings'
      }
    });
  }
});

/**
 * Get comprehensive user profile endpoint
 * GET /api/admin/users/:uid/profile
 * Admin-only endpoint to get detailed user profile with role-specific data
 */
router.get('/users/:uid/profile', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    console.log(`🔍 [PROFILE] Fetching profile for user: ${uid}`);

    // Fetch basic user profile from users collection
    const userDoc = await firestore.collection('users').doc(uid).get();
    console.log(`🔍 [PROFILE] User document exists: ${userDoc.exists}`);
    if (!userDoc.exists) {
      console.log(`❌ [PROFILE] User not found in Firestore: ${uid}`);
      return res.status(404).json({
        error: 'User Not Found',
        message: 'The specified user does not exist'
      });
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // Base profile data
    const profileData = {
      uid: uid,
      ...userData,
      createdAt: userData.createdAt,
      lastSignIn: userData.lastSignIn || null
    };

    // Role-specific data aggregation
    if (userRole === 'student') {
      // For students: get enrollments, transactions, and progress
      const [enrollmentsSnapshot, transactionsSnapshot, progressSnapshot] = await Promise.all([
        firestore.collection('enrollments').where('studentId', '==', uid).get(),
        firestore.collection('transactions').where('userId', '==', uid).get(),
        firestore.collection('progress').where('studentId', '==', uid).get()
      ]);

      // Process enrollments and get course details
      const enrollments = [];
      const courseIds = new Set();
      
      enrollmentsSnapshot.forEach(doc => {
        const enrollment = { id: doc.id, ...doc.data() };
        enrollments.push(enrollment);
        if (enrollment.courseId) courseIds.add(enrollment.courseId);
        if (enrollment.batchId) courseIds.add(enrollment.batchId);
      });

      // Get course/batch details
      const courseDetails = {};
      if (courseIds.size > 0) {
        const coursePromises = Array.from(courseIds).map(async (id) => {
          const [courseDoc, batchDoc] = await Promise.all([
            firestore.collection('courses').doc(id).get(),
            firestore.collection('batches').doc(id).get()
          ]);
          
          if (courseDoc.exists) {
            courseDetails[id] = { type: 'course', ...courseDoc.data() };
          } else if (batchDoc.exists) {
            courseDetails[id] = { type: 'batch', ...batchDoc.data() };
          }
        });
        await Promise.all(coursePromises);
      }

      // Process transactions
      const transactions = [];
      let totalAmountPaid = 0;
      
      transactionsSnapshot.forEach(doc => {
        const transaction = { id: doc.id, ...doc.data() };
        transactions.push(transaction);
        if (transaction.status === 'completed' && transaction.amount) {
          totalAmountPaid += transaction.amount;
        }
      });

      // Process progress data
      const progressData = [];
      let totalLessonsCompleted = 0;
      
      progressSnapshot.forEach(doc => {
        const progress = { id: doc.id, ...doc.data() };
        progressData.push(progress);
        if (progress.completed) {
          totalLessonsCompleted++;
        }
      });

      // Add student-specific data to profile
      profileData.studentData = {
        enrollments: enrollments.map(enrollment => ({
          ...enrollment,
          courseDetails: courseDetails[enrollment.courseId] || courseDetails[enrollment.batchId] || null
        })),
        transactions: transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        totalAmountPaid,
        progress: {
          totalLessonsCompleted,
          progressData: progressData.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        },
        stats: {
          totalEnrollments: enrollments.length,
          totalTransactions: transactions.length,
          totalAmountPaid,
          totalLessonsCompleted
        }
      };

    } else if (userRole === 'teacher') {
      // For teachers: get assigned subjects and lesson statistics
      const subjectsSnapshot = await firestore.collection('subjects')
        .where('teacherId', '==', uid)
        .get();

      const assignedSubjects = [];
      const subjectIds = [];
      
      subjectsSnapshot.forEach(doc => {
        const subject = { id: doc.id, ...doc.data() };
        assignedSubjects.push(subject);
        subjectIds.push(doc.id);
      });

      // Get lesson statistics for each subject
      const subjectStats = {};
      if (subjectIds.length > 0) {
        const lessonPromises = subjectIds.map(async (subjectId) => {
          const lessonsSnapshot = await firestore.collection('lessons')
            .where('subjectId', '==', subjectId)
            .get();
          
          let totalLessons = 0;
          let completedLessons = 0;
          
          lessonsSnapshot.forEach(lessonDoc => {
            totalLessons++;
            const lesson = lessonDoc.data();
            if (lesson.status === 'completed' || lesson.isCompleted) {
              completedLessons++;
            }
          });
          
          subjectStats[subjectId] = {
            totalLessons,
            completedLessons,
            completionRate: totalLessons > 0 ? (completedLessons / totalLessons * 100).toFixed(1) : 0
          };
        });
        
        await Promise.all(lessonPromises);
      }

      // Get batches where this teacher is assigned
      const batchesSnapshot = await firestore.collection('batches')
        .where('teachers', 'array-contains-any', [{ teacherId: uid }, uid])
        .get();
      
      const assignedBatches = [];
      batchesSnapshot.forEach(doc => {
        assignedBatches.push({ id: doc.id, ...doc.data() });
      });

      // Add teacher-specific data to profile
      profileData.teacherData = {
        assignedSubjects: assignedSubjects.map(subject => ({
          ...subject,
          stats: subjectStats[subject.id] || { totalLessons: 0, completedLessons: 0, completionRate: 0 }
        })),
        assignedBatches,
        stats: {
          totalSubjects: assignedSubjects.length,
          totalBatches: assignedBatches.length,
          totalLessons: Object.values(subjectStats).reduce((sum, stat) => sum + stat.totalLessons, 0),
          totalCompletedLessons: Object.values(subjectStats).reduce((sum, stat) => sum + stat.completedLessons, 0)
        }
      };
    }

    console.log(`✅ [PROFILE] Successfully fetched profile for user: ${uid}`);
    res.status(200).json({
      success: true,
      data: profileData,
      message: 'User profile retrieved successfully'
    });

  } catch (error) {
    console.error('❌ [PROFILE] Error fetching user profile:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch user profile'
    });
  }
});

// Chat Management Endpoints

/**
 * Get chat statistics
 * GET /api/admin/chat/stats
 */
router.get('/chat/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    // Get total chat rooms
    const roomsSnapshot = await db.collection('chatRooms').get();
    const totalRooms = roomsSnapshot.size;
    
    // Count active rooms (rooms with recent activity)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeRoomsSnapshot = await db.collection('chatRooms')
      .where('lastActivity', '>=', oneDayAgo)
      .get();
    const activeRooms = activeRoomsSnapshot.size;
    
    // Count total messages across all rooms
    let totalMessages = 0;
    let reportedMessages = 0;
    
    for (const roomDoc of roomsSnapshot.docs) {
      const messagesSnapshot = await db.collection('chatRooms')
        .doc(roomDoc.id)
        .collection('messages')
        .get();
      totalMessages += messagesSnapshot.size;
      
      // Count reported messages
      const reportedSnapshot = await db.collection('chatRooms')
        .doc(roomDoc.id)
        .collection('messages')
        .where('reported', '==', true)
        .get();
      reportedMessages += reportedSnapshot.size;
    }
    
    // Count banned users
    const bannedUsersSnapshot = await db.collection('users')
      .where('status', '==', 'banned')
      .get();
    const bannedUsers = bannedUsersSnapshot.size;
    
    // Count moderation actions (placeholder - implement based on your moderation system)
    const moderationActions = 0;
    
    res.json({
      success: true,
      data: {
        totalRooms,
        activeRooms,
        totalMessages,
        reportedMessages,
        bannedUsers,
        moderationActions
      },
      message: 'Chat statistics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching chat stats:', error);
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
 * Get chat rooms for admin management
 * GET /api/admin/chat/rooms
 */
router.get('/chat/rooms', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    const roomsSnapshot = await db.collection('chatRooms')
      .orderBy('createdAt', 'desc')
      .get();
    
    const rooms = [];
    
    for (const doc of roomsSnapshot.docs) {
      const roomData = doc.data();
      
      // Get participant count
      const participantCount = roomData.participants ? roomData.participants.length : 0;
      
      // Get message count
      const messagesSnapshot = await db.collection('chatRooms')
        .doc(doc.id)
        .collection('messages')
        .get();
      const messageCount = messagesSnapshot.size;
      
      // Get reported messages count
      const reportedSnapshot = await db.collection('chatRooms')
        .doc(doc.id)
        .collection('messages')
        .where('reported', '==', true)
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
        isActive: roomData.isActive !== false,
        moderators: roomData.moderators || [],
        createdBy: roomData.createdBy || { id: '', name: 'Unknown', role: 'unknown' },
        createdAt: roomData.createdAt,
        settings: roomData.settings || {
          allowFileSharing: true,
          allowVoiceMessages: true,
          maxParticipants: 100,
          isModerated: false
        },
        reportedMessages,
        bannedUsers: 0 // Placeholder
      });
    }
    
    res.json({
      success: true,
      data: rooms,
      message: 'Chat rooms retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CHAT_ROOMS_ERROR',
        message: 'Failed to fetch chat rooms'
      }
    });
  }
});

// Forum Management Endpoints

/**
 * Get forum statistics
 * GET /api/admin/forum/stats
 */
router.get('/forum/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    // Get total topics
    const topicsSnapshot = await db.collection('forumTopics').get();
    const totalTopics = topicsSnapshot.size;
    
    // Count total replies
    let totalReplies = 0;
    let reportedContent = 0;
    let pinnedTopics = 0;
    let lockedTopics = 0;
    
    for (const topicDoc of topicsSnapshot.docs) {
      const topicData = topicDoc.data();
      
      // Count replies for this topic
      const repliesSnapshot = await db.collection('forumTopics')
        .doc(topicDoc.id)
        .collection('replies')
        .get();
      totalReplies += repliesSnapshot.size;
      
      // Count reported content
      if (topicData.reported) reportedContent++;
      
      // Count pinned topics
      if (topicData.pinned) pinnedTopics++;
      
      // Count locked topics
      if (topicData.locked) lockedTopics++;
      
      // Check for reported replies
      const reportedRepliesSnapshot = await db.collection('forumTopics')
        .doc(topicDoc.id)
        .collection('replies')
        .where('reported', '==', true)
        .get();
      reportedContent += reportedRepliesSnapshot.size;
    }
    
    // Count active users (users who posted in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTopicsSnapshot = await db.collection('forumTopics')
      .where('createdAt', '>=', thirtyDaysAgo)
      .get();
    
    const activeUserIds = new Set();
    recentTopicsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.authorId) activeUserIds.add(data.authorId);
    });
    
    const activeUsers = activeUserIds.size;
    
    res.json({
      success: true,
      data: {
        totalTopics,
        totalReplies,
        activeUsers,
        reportedContent,
        pinnedTopics,
        lockedTopics
      },
      message: 'Forum statistics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching forum stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORUM_STATS_ERROR',
        message: 'Failed to fetch forum statistics'
      }
    });
  }
});

/**
 * Get forum topics for admin management
 * GET /api/admin/forum/topics
 */
router.get('/forum/topics', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    const topicsSnapshot = await db.collection('forumTopics')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    
    const topics = [];
    
    for (const doc of topicsSnapshot.docs) {
      const topicData = doc.data();
      
      // Get reply count
      const repliesSnapshot = await db.collection('forumTopics')
        .doc(doc.id)
        .collection('replies')
        .get();
      const replyCount = repliesSnapshot.size;
      
      // Get author info
      let authorName = 'Unknown User';
      if (topicData.authorId) {
        try {
          const authorDoc = await db.collection('users').doc(topicData.authorId).get();
          if (authorDoc.exists) {
            const authorData = authorDoc.data();
            authorName = authorData.displayName || authorData.name || authorData.email || 'Unknown User';
          }
        } catch (err) {
          console.log('Could not fetch author info:', err.message);
        }
      }
      
      topics.push({
        id: doc.id,
        title: topicData.title || 'Untitled Topic',
        content: topicData.content || '',
        author: {
          id: topicData.authorId || '',
          name: authorName,
          role: topicData.authorRole || 'student'
        },
        batchId: topicData.batchId || '',
        subjectId: topicData.subjectId || '',
        category: topicData.category || 'general',
        tags: topicData.tags || [],
        replyCount,
        viewCount: topicData.viewCount || 0,
        likes: topicData.likes || 0,
        pinned: topicData.pinned || false,
        locked: topicData.locked || false,
        reported: topicData.reported || false,
        createdAt: topicData.createdAt,
        lastActivity: topicData.lastActivity || topicData.createdAt
      });
    }
    
    res.json({
      success: true,
      data: topics,
      message: 'Forum topics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching forum topics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORUM_TOPICS_ERROR',
        message: 'Failed to fetch forum topics'
      }
    });
  }
});

// Reports Management Endpoints

/**
 * Get reports statistics
 * GET /api/admin/reports/stats
 */
router.get('/reports/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    // Get total reports generated (from audit logs or reports collection)
    const reportsSnapshot = await db.collection('reportLogs').get();
    const totalReports = reportsSnapshot.size;
    
    // Count monthly reports (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthlyReportsSnapshot = await db.collection('reportLogs')
      .where('createdAt', '>=', thirtyDaysAgo)
      .get();
    const monthlyReports = monthlyReportsSnapshot.size;
    
    // Count popular formats
    const popularFormats = {
      pdf: 0,
      excel: 0,
      csv: 0
    };
    
    reportsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.format && popularFormats.hasOwnProperty(data.format)) {
        popularFormats[data.format]++;
      }
    });
    
    // Get recent reports (last 10)
    const recentReportsSnapshot = await db.collection('reportLogs')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    const recentReports = [];
    recentReportsSnapshot.forEach(doc => {
      const data = doc.data();
      recentReports.push({
        id: doc.id,
        title: data.title || `${data.type} Report`,
        type: data.type || 'general',
        format: data.format || 'pdf',
        createdAt: data.createdAt,
        downloadCount: data.downloadCount || 0,
        generatedBy: data.generatedBy || { name: 'Unknown', role: 'unknown' }
      });
    });
    
    res.json({
      success: true,
      data: {
        totalReports,
        monthlyReports,
        popularFormats,
        recentReports
      },
      message: 'Reports statistics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching reports stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REPORTS_STATS_ERROR',
        message: 'Failed to fetch reports statistics'
      }
    });
  }
});

/**
 * Get available report types
 * GET /api/admin/reports/types
 */
router.get('/reports/types', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const reportTypes = [
      {
        id: 'student_performance',
        name: 'Student Performance Report',
        description: 'Detailed analysis of student progress and performance',
        category: 'academic',
        formats: ['pdf', 'excel'],
        parameters: ['studentId', 'batchId', 'timeRange']
      },
      {
        id: 'batch_analytics',
        name: 'Batch Analytics Report',
        description: 'Comprehensive batch performance and engagement metrics',
        category: 'academic',
        formats: ['pdf', 'excel'],
        parameters: ['batchId', 'timeRange']
      },
      {
        id: 'platform_analytics',
        name: 'Platform Analytics Report',
        description: 'Overall platform usage and performance statistics',
        category: 'administrative',
        formats: ['pdf', 'excel'],
        parameters: ['timeRange']
      },
      {
        id: 'assignment_report',
        name: 'Assignment Report',
        description: 'Assignment submission and grading analysis',
        category: 'academic',
        formats: ['pdf', 'excel'],
        parameters: ['assignmentId']
      },
      {
        id: 'financial_report',
        name: 'Financial Report',
        description: 'Revenue and payment analytics',
        category: 'financial',
        formats: ['pdf', 'excel'],
        parameters: ['timeRange', 'courseId']
      },
      {
        id: 'user_activity',
        name: 'User Activity Report',
        description: 'User engagement and activity patterns',
        category: 'administrative',
        formats: ['pdf', 'excel'],
        parameters: ['timeRange', 'userRole']
      }
    ];
    
    res.json({
      success: true,
      data: reportTypes,
      message: 'Report types retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching report types:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REPORT_TYPES_ERROR',
        message: 'Failed to fetch report types'
      }
    });
  }
});

// Assignment Management Endpoints

/**
 * Get assignments statistics
 * GET /api/admin/assignments/stats
 */
router.get('/assignments/stats', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    
    // Get total assignments
    const assignmentsSnapshot = await db.collection('assignments').get();
    const totalAssignments = assignmentsSnapshot.size;
    
    // Count assignments by status
    let activeAssignments = 0;
    let completedAssignments = 0;
    let overdueAssignments = 0;
    let draftAssignments = 0;
    
    const now = new Date();
    
    assignmentsSnapshot.forEach(doc => {
      const data = doc.data();
      const dueDate = data.dueDate ? new Date(data.dueDate) : null;
      
      if (data.status === 'draft') {
        draftAssignments++;
      } else if (data.status === 'published') {
        if (dueDate && dueDate < now) {
          overdueAssignments++;
        } else {
          activeAssignments++;
        }
      } else if (data.status === 'completed') {
        completedAssignments++;
      }
    });
    
    // Get total submissions
    let totalSubmissions = 0;
    let gradedSubmissions = 0;
    let pendingSubmissions = 0;
    
    for (const assignmentDoc of assignmentsSnapshot.docs) {
      const submissionsSnapshot = await db.collection('assignments')
        .doc(assignmentDoc.id)
        .collection('submissions')
        .get();
      
      totalSubmissions += submissionsSnapshot.size;
      
      submissionsSnapshot.forEach(subDoc => {
        const subData = subDoc.data();
        if (subData.grade !== undefined && subData.grade !== null) {
          gradedSubmissions++;
        } else {
          pendingSubmissions++;
        }
      });
    }
    
    // Calculate average completion rate
    const averageCompletionRate = totalAssignments > 0 
      ? Math.round((completedAssignments / totalAssignments) * 100) 
      : 0;
    
    res.json({
      success: true,
      data: {
        totalAssignments,
        activeAssignments,
        completedAssignments,
        overdueAssignments,
        draftAssignments,
        totalSubmissions,
        gradedSubmissions,
        pendingSubmissions,
        averageCompletionRate
      },
      message: 'Assignment statistics retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching assignment stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ASSIGNMENT_STATS_ERROR',
        message: 'Failed to fetch assignment statistics'
      }
    });
  }
});

/**
 * Get assignments list for admin management
 * GET /api/admin/assignments
 */
router.get('/assignments', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const db = firestore;
    const { limit = 20, offset = 0, status, batchId, subjectId } = req.query;
    
    let query = db.collection('assignments');
    
    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (batchId) {
      query = query.where('batchId', '==', batchId);
    }
    if (subjectId) {
      query = query.where('subjectId', '==', subjectId);
    }
    
    // Apply pagination and ordering
    const assignmentsSnapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const assignments = [];
    
    for (const doc of assignmentsSnapshot.docs) {
      const data = doc.data();
      
      // Get submission count
      const submissionsSnapshot = await db.collection('assignments')
        .doc(doc.id)
        .collection('submissions')
        .get();
      const submissionCount = submissionsSnapshot.size;
      
      // Get graded submissions count
      const gradedSubmissions = submissionsSnapshot.docs.filter(subDoc => {
        const subData = subDoc.data();
        return subData.grade !== undefined && subData.grade !== null;
      }).length;
      
      // Get teacher info
      let teacherName = 'Unknown Teacher';
      if (data.teacherId) {
        try {
          const teacherDoc = await db.collection('users').doc(data.teacherId).get();
          if (teacherDoc.exists) {
            const teacherData = teacherDoc.data();
            teacherName = teacherData.displayName || teacherData.name || teacherData.email || 'Unknown Teacher';
          }
        } catch (err) {
          console.log('Could not fetch teacher info:', err.message);
        }
      }
      
      assignments.push({
        id: doc.id,
        title: data.title || 'Untitled Assignment',
        description: data.description || '',
        type: data.type || 'homework',
        status: data.status || 'draft',
        batchId: data.batchId || '',
        subjectId: data.subjectId || '',
        teacherId: data.teacherId || '',
        teacherName,
        dueDate: data.dueDate,
        maxMarks: data.maxMarks || 100,
        submissionCount,
        gradedSubmissions,
        pendingGrading: submissionCount - gradedSubmissions,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      });
    }
    
    res.json({
      success: true,
      data: assignments,
      message: 'Assignments retrieved successfully'
    });
    
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ASSIGNMENTS_ERROR',
        message: 'Failed to fetch assignments'
      }
    });
  }
});

module.exports = router;