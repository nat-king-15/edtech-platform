const express = require('express');
const { firestore } = require('../config/firebase');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/courses - Get all courses
router.get('/', authMiddleware, async (req, res) => {
  try {
    const coursesSnapshot = await firestore.collection('courses').get();
    
    if (coursesSnapshot.empty) {
      return res.json({
        success: true,
        data: [],
        message: 'No courses found'
      });
    }

    const courses = [];
    coursesSnapshot.forEach(doc => {
      courses.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: courses,
      message: 'Courses fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_COURSES_ERROR',
        message: 'Failed to fetch courses',
        details: error.message
      }
    });
  }
});

// GET /api/courses/:courseId/batches - Get batches for a specific course
router.get('/:courseId/batches', authMiddleware, async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_COURSE_ID',
          message: 'Course ID is required'
        }
      });
    }

    // Query batches subcollection for the specified course
    const batchesSnapshot = await firestore.collection('courses')
      .doc(courseId)
      .collection('batches')
      .get();

    if (batchesSnapshot.empty) {
      return res.json({
        success: true,
        data: [],
        message: `No batches found for course ${courseId}`
      });
    }

    const batches = [];
    batchesSnapshot.forEach(doc => {
      batches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: batches,
      message: 'Batches fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching batches for course:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BATCHES_ERROR',
        message: 'Failed to fetch batches for course',
        details: error.message
      }
    });
  }
});

module.exports = router;