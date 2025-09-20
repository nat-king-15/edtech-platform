const express = require('express');
const { admin, firestore, auth, FieldValue } = require('../config/firebase');
const jwt = require('jsonwebtoken');
const tokenService = require('../services/tokenService');
const { authMiddleware } = require('../middleware/authMiddleware');
const router = express.Router();

// Initialize Firestore
const db = firestore;

// Function to get JWT secret with error handling
function getJWTSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT secret not configured');
  return s;
}

// Helper function to generate JWT token
const generateToken = (user) => {
  try {
    return jwt.sign(
      {
        uid: user.uid,
        email: user.email,
        role: user.role,
        displayName: user.displayName
      },
      getJWTSecret(),
      { expiresIn: '7d' }
    );
  } catch (error) {
    if (error.message === 'JWT secret not configured') {
      throw new Error('Token generation failed');
    }
    throw error;
  }
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName, role = 'student' } = req.body;

    // Validate input
    if (!email || !password || !displayName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email, password, and display name are required'
        }
      });
    }

    // Validate role
    if (!['student', 'teacher', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'Role must be student, teacher, or admin'
        }
      });
    }

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    // Create user document in Firestore
    const userData = {
      uid: userRecord.uid,
      email,
      displayName,
      role,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      isActive: true,
      profile: {
        avatar: null,
        bio: '',
        phone: '',
        dateOfBirth: null,
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'India'
        }
      },
      preferences: {
        notifications: {
          email: true,
          push: true,
          sms: false
        },
        language: 'en',
        timezone: 'Asia/Kolkata'
      }
    };

    // Add role-specific fields
    if (role === 'student') {
      userData.studentData = {
        enrolledCourses: [],
        completedCourses: [],
        totalStudyHours: 0,
        certificates: [],
        progress: {}
      };
    } else if (role === 'teacher') {
      userData.teacherData = {
        courses: [],
        subjects: [],
        experience: '',
        qualifications: [],
        rating: 0,
        totalStudents: 0,
        bio: ''
      };
    } else if (role === 'admin') {
      userData.adminData = {
        permissions: ['all'],
        lastLogin: null
      };
    }

    await db.collection('users').doc(userRecord.uid).set(userData);

    // Generate JWT token
    let token;
    try {
      token = generateToken({
        uid: userRecord.uid,
        email,
        role,
        displayName
      });
    } catch (error) {
      if (error.message === 'Token generation failed') {
        return res.status(500).json({
          success: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Internal server error'
          }
        });
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      data: {
        user: {
          uid: userRecord.uid,
          email,
          displayName,
          role
        },
        token
      },
      message: 'User registered successfully'
    });

  } catch (error) {
    console.error('Registration error');
    
    let errorMessage = 'Registration failed';
    let errorCode = 'REGISTRATION_ERROR';
    
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'Email already exists';
      errorCode = 'EMAIL_EXISTS';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email format';
      errorCode = 'INVALID_EMAIL';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak';
      errorCode = 'WEAK_PASSWORD';
    }

    res.status(400).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage
      }
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required'
        }
      });
    }

    // For demo purposes, we'll use Firebase Admin to verify user
    // In production, you should use Firebase Auth SDK on client side
    const userRecord = await admin.auth().getUserByEmail(email);
    
    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User data not found'
        }
      });
    }

    const userData = userDoc.data();

    // Check if user is active
    if (!userData.isActive) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Account has been disabled'
        }
      });
    }

    // Generate JWT token
    let token;
    try {
      token = generateToken({
        uid: userRecord.uid,
        email: userRecord.email,
        role: userData.role,
        displayName: userRecord.displayName
      });
    } catch (error) {
      if (error.message === 'Token generation failed') {
        return res.status(500).json({
          success: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Internal server error'
          }
        });
      }
      throw error;
    }

    // Update last login
    await db.collection('users').doc(userRecord.uid).update({
      lastLogin: FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      data: {
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          role: userData.role
        },
        token
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error');
    
    let errorMessage = 'Login failed';
    let errorCode = 'LOGIN_ERROR';
    
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'User not found';
      errorCode = 'USER_NOT_FOUND';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email format';
      errorCode = 'INVALID_EMAIL';
    }

    res.status(400).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage
      }
    });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    // Use req.user from authMiddleware
    const uid = req.user.uid;
    
    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const userData = userDoc.data();
    
    // Remove sensitive data
    delete userData.preferences;
    
    res.json({
      success: true,
      data: {
        user: userData
      },
      message: 'Profile retrieved successfully'
    });

  } catch (error) {
    console.error('Profile endpoint error');
    
    // Do not leak internal error details
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to retrieve profile'
      }
    });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    // Use req.user from authMiddleware
    const uid = req.user.uid;
    
    const { displayName, profile } = req.body;
    
    const updateData = {
      updatedAt: FieldValue.serverTimestamp()
    };
    
    if (displayName) {
      updateData.displayName = displayName;
      // Also update in Firebase Auth
      await admin.auth().updateUser(uid, { displayName });
    }
    
    if (profile) {
      updateData.profile = profile;
    }
    
    await db.collection('users').doc(uid).update(updateData);
    
    res.json({
      success: true,
      data: {
        message: 'Profile updated successfully'
      }
    });

  } catch (error) {
    console.error('Profile update error');
    
    // Do not leak internal error details
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update profile'
      }
    });
  }
});

// Logout (invalidate token - for now just return success)
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;