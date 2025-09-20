const { auth } = require('../config/firebase');
const tokenService = require('../services/tokenService');

/**
 * Authentication middleware for Firebase token validation
 * Expects Authorization header with Bearer token format
 * Attaches user object with uid and role to request
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authorization header with Bearer token is required'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token format'
      });
    }

    // Try to verify as JWT token first, then as Firebase ID token
    let decodedToken;
    let isJWT = false;
    let userRecord = null;
    
    try {
      // First try to decode as JWT token using tokenService
      // Skip JWT verification if JWT_SECRET is not configured
      if (process.env.JWT_SECRET) {
        const verification = await tokenService.verifyToken(idToken);
        if (verification.success) {
          decodedToken = verification.data.payload;
          isJWT = true;
        } else {
          try {
            // If JWT verification fails, try Firebase ID token
            decodedToken = await auth.verifyIdToken(idToken);
          } catch (firebaseError) {
            // Don't throw here, let the outer catch handle it
            throw firebaseError;
          }
        }
      } else {
        // JWT_SECRET not configured, skip JWT verification and try Firebase
        try {
          decodedToken = await auth.verifyIdToken(idToken);
        } catch (firebaseError) {
          // Don't throw here, let the outer catch handle it
          throw firebaseError;
        }
      }
    } catch (error) {
      // If JWT verification fails, try Firebase ID token
      try {
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (firebaseError) {
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
      userRecord = await auth.getUser(decodedToken.uid);
      const customClaims = userRecord.customClaims || {};
      userRole = customClaims.role || 'student';
    }
    
    // Attach user information to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userRole,
      emailVerified: decodedToken.email_verified || true, // JWT tokens don't have this field
      customClaims: isJWT ? {} : ((userRecord && userRecord.customClaims) || {})
    };

    next();
  } catch (error) {
    console.error('Authentication error');
    
    // Return generic 401 message, do not log token values or stack traces
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed'
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied'
      });
    }

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