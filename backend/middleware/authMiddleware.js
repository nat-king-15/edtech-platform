const { auth } = require('../config/firebase');

/**
 * Authentication middleware for Firebase token validation
 * Expects Authorization header with Bearer token format
 * Attaches user object with uid and role to request
 */
const authMiddleware = async (req, res, next) => {
  try {
    console.log('🔐 Auth Middleware - Request URL:', req.method, req.originalUrl);
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    console.log('🔐 Auth Header present:', !!authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Auth failed: Missing or invalid Authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authorization header with Bearer token is required'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('🔐 Token extracted, length:', idToken?.length || 0);
    
    if (!idToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token format'
      });
    }

    // Try to verify as JWT token first, then as Firebase ID token
    let decodedToken;
    let isJWT = false;
    
    try {
      // First try to decode as JWT token
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
      decodedToken = jwt.verify(idToken, JWT_SECRET);
      isJWT = true;
      console.log('🔐 JWT token verified successfully');
    } catch (jwtError) {
      console.log('🔐 Not a JWT token, trying Firebase ID token...');
      try {
        // If JWT verification fails, try Firebase ID token
        decodedToken = await auth.verifyIdToken(idToken);
        console.log('🔐 Firebase ID token verified successfully');
      } catch (firebaseError) {
        console.log('❌ Token verification failed:', firebaseError.message);
        // Don't throw here, let the outer catch handle it
        throw firebaseError;
      }
    }
    
    let userRole = 'student';
    
    if (isJWT) {
      // For JWT tokens, role is directly in the token
      userRole = decodedToken.role || 'student';
    } else {
      // For Firebase ID tokens, get role from custom claims
      const userRecord = await auth.getUser(decodedToken.uid);
      const customClaims = userRecord.customClaims || {};
      userRole = customClaims.role || 'student';
    }
    
    // Attach user information to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userRole,
      emailVerified: decodedToken.email_verified || true, // JWT tokens don't have this field
      customClaims: isJWT ? {} : (userRecord?.customClaims || {})
    };

    console.log('🔐 User object attached to request:', { uid: req.user.uid, role: req.user.role });
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    // Handle specific Firebase auth errors
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'Token Expired',
        message: 'The provided token has expired'
      });
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        error: 'Token Revoked',
        message: 'The provided token has been revoked'
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        error: 'Invalid Token',
        message: 'The provided token is invalid'
      });
    }

    return res.status(401).json({
      error: 'Authentication Failed',
      message: 'Failed to authenticate user'
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    console.log('🔒 RequireRole middleware - checking role access');
    console.log('🔒 User object:', req.user ? { uid: req.user.uid, role: req.user.role } : 'No user');
    console.log('🔒 Required roles:', allowedRoles);
    
    if (!req.user) {
      console.log('❌ RequireRole failed: No user object');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    
    console.log('🔒 User role:', userRole, 'Required roles:', roles);
    
    if (!roles.includes(userRole)) {
      console.log('❌ RequireRole failed: Insufficient permissions');
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Required role(s): ${roles.join(', ')}`
      });
    }

    console.log('✅ RequireRole passed: User has required permissions');
    next();
  };
};

/**
 * Admin-only middleware
 */
const requireAdmin = requireRole('admin');

/**
 * Teacher or Admin middleware
 */
const requireTeacherOrAdmin = requireRole(['teacher', 'admin']);

module.exports = {
  authMiddleware,
  requireRole,
  requireAdmin,
  requireTeacherOrAdmin
};