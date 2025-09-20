const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../config/firebase');
const { logAuditEvent, AUDIT_EVENTS, RISK_LEVELS } = require('./auditLogger');

/**
 * DRM Protection Middleware
 * Implements content protection, access control, and anti-piracy measures
 */

const DRM_CONFIG = {
  // Token expiration times
  VIDEO_TOKEN_EXPIRY: 2 * 60 * 60, // 2 hours
  DOWNLOAD_TOKEN_EXPIRY: 5 * 60, // 5 minutes
  
  // Security settings
  MAX_CONCURRENT_SESSIONS: 3,
  MAX_DAILY_VIEWS: 50,
  WATERMARK_ENABLED: true,
  
  // Encryption settings
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  KEY_ROTATION_INTERVAL: 24 * 60 * 60 * 1000 // 24 hours
};

/**
 * Generate secure video access token
 */
const generateVideoToken = async (req, userId, videoId, batchId, additionalClaims = {}) => {
  try {
    // Check user enrollment
    const enrollment = await db.collection('enrollments')
      .where('userId', '==', userId)
      .where('batchId', '==', batchId)
      .where('status', '==', 'active')
      .get();
    
    if (enrollment.empty) {
      throw new Error('User not enrolled in this batch');
    }
    
    // Check concurrent sessions
    const activeSessions = await getActiveVideoSessions(userId);
    if (activeSessions.length >= DRM_CONFIG.MAX_CONCURRENT_SESSIONS) {
      throw new Error('Maximum concurrent sessions exceeded');
    }
    
    // Check daily view limit
    const dailyViews = await getDailyViewCount(userId);
    if (dailyViews >= DRM_CONFIG.MAX_DAILY_VIEWS) {
      throw new Error('Daily view limit exceeded');
    }
    
    // Generate deterministic device fingerprint with issued hour for consistency
    const issuedHour = Math.floor(Date.now() / (1000 * 60 * 60));
    const deviceFingerprint = generateDeviceFingerprint(req, issuedHour);
    
    const tokenPayload = {
      userId,
      videoId,
      batchId,
      sessionId: crypto.randomUUID(),
      deviceFingerprint,
      issuedHour, // Store the hour used for fingerprint generation
      watermarkData: {
        userId,
        timestamp: Date.now(),
        position: 'bottom-right'
      },
      ...additionalClaims
    };
    
    const token = jwt.sign(
      tokenPayload,
      process.env.DRM_SECRET || 'drm-secret-key',
      { 
        expiresIn: DRM_CONFIG.VIDEO_TOKEN_EXPIRY,
        issuer: 'edtech-platform',
        audience: 'video-player'
      }
    );
    
    // Store session info
    await db.collection('video_sessions').add({
      userId,
      videoId,
      batchId,
      sessionId: tokenPayload.sessionId,
      token,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + DRM_CONFIG.VIDEO_TOKEN_EXPIRY * 1000),
      active: true,
      deviceFingerprint: tokenPayload.deviceFingerprint,
      issuedHour: tokenPayload.issuedHour
    });
    
    return {
      token,
      expiresIn: DRM_CONFIG.VIDEO_TOKEN_EXPIRY,
      sessionId: tokenPayload.sessionId,
      watermarkEnabled: DRM_CONFIG.WATERMARK_ENABLED
    };
  } catch (error) {
    console.error('Failed to generate video token:', error);
    throw error;
  }
};

/**
 * Verify video access token
 */
const verifyVideoToken = async (req, res, next) => {
  try {
    const token = req.headers['x-video-token'] || req.query.token;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_VIDEO_TOKEN',
          message: 'Video access token is required'
        }
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(
      token,
      process.env.DRM_SECRET || 'drm-secret-key',
      {
        issuer: 'edtech-platform',
        audience: 'video-player'
      }
    );
    
    // Check if session is still active
    const sessionDoc = await db.collection('video_sessions')
      .where('sessionId', '==', decoded.sessionId)
      .where('active', '==', true)
      .get();
    
    if (sessionDoc.empty) {
      await logAuditEvent(AUDIT_EVENTS.UNAUTHORIZED_ACCESS, req, {
        reason: 'Invalid or expired video session',
        videoId: decoded.videoId,
        riskLevel: RISK_LEVELS.HIGH
      });
      
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_VIDEO_SESSION',
          message: 'Video session is invalid or expired'
        }
      });
    }
    
    // Verify device fingerprint using the same issuedHour from token
    const currentFingerprint = generateDeviceFingerprint(req, decoded.issuedHour);
    if (decoded.deviceFingerprint !== currentFingerprint) {
      await logAuditEvent(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY, req, {
        reason: 'Device fingerprint mismatch',
        videoId: decoded.videoId,
        riskLevel: RISK_LEVELS.CRITICAL
      });
      
      return res.status(403).json({
        success: false,
        error: {
          code: 'DEVICE_MISMATCH',
          message: 'Device verification failed'
        }
      });
    }
    
    // Update last access time
    const sessionId = sessionDoc.docs[0].id;
    await db.collection('video_sessions').doc(sessionId).update({
      lastAccessAt: new Date()
    });
    
    // Add decoded token data to request
    req.videoAccess = decoded;
    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      await logAuditEvent(AUDIT_EVENTS.UNAUTHORIZED_ACCESS, req, {
        reason: 'Invalid or expired video token',
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_VIDEO_TOKEN',
          message: 'Video access token is invalid or expired'
        }
      });
    }
    
    console.error('Video token verification error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'TOKEN_VERIFICATION_ERROR',
        message: 'Failed to verify video access'
      }
    });
  }
};

/**
 * Generate device fingerprint for DRM protection
 * Now accepts req object and optional issuedHour for deterministic fingerprinting
 */
const generateDeviceFingerprint = (req, issuedHour = null) => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const acceptLanguage = req.headers['accept-language'] || 'unknown';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Use provided issuedHour for deterministic fingerprinting during token lifetime
  // If not provided, use current hour (for backward compatibility)
  const timeComponent = issuedHour !== null ? issuedHour : Math.floor(Date.now() / (1000 * 60 * 60));
  
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${userAgent}:${acceptLanguage}:${ip}:${timeComponent}`)
    .digest('hex');
  
  return fingerprint;
};

/**
 * Get active video sessions for a user
 */
const getActiveVideoSessions = async (userId) => {
  try {
    const snapshot = await db.collection('video_sessions')
      .where('userId', '==', userId)
      .where('active', '==', true)
      .where('expiresAt', '>', new Date())
      .get();
    
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Failed to get active sessions:', error);
    return [];
  }
};

/**
 * Get daily view count for a user
 */
const getDailyViewCount = async (userId) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('video_views')
      .where('userId', '==', userId)
      .where('viewedAt', '>=', today)
      .get();
    
    return snapshot.size;
  } catch (error) {
    console.error('Failed to get daily view count:', error);
    return 0;
  }
};

/**
 * Record video view
 */
const recordVideoView = async (userId, videoId, batchId, sessionId) => {
  try {
    await db.collection('video_views').add({
      userId,
      videoId,
      batchId,
      sessionId,
      viewedAt: new Date(),
      createdAt: new Date()
    });
  } catch (error) {
    console.error('Failed to record video view:', error);
  }
};

/**
 * Terminate video session
 */
const terminateVideoSession = async (sessionId) => {
  try {
    const sessionQuery = await db.collection('video_sessions')
      .where('sessionId', '==', sessionId)
      .get();
    
    if (!sessionQuery.empty) {
      const sessionDoc = sessionQuery.docs[0];
      await sessionDoc.ref.update({
        active: false,
        terminatedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Failed to terminate video session:', error);
  }
};

/**
 * Clean up expired sessions
 */
const cleanupExpiredSessions = async () => {
  try {
    const expiredSessions = await db.collection('video_sessions')
      .where('expiresAt', '<', new Date())
      .where('active', '==', true)
      .get();
    
    const batch = db.batch();
    expiredSessions.docs.forEach(doc => {
      batch.update(doc.ref, {
        active: false,
        terminatedAt: new Date()
      });
    });
    
    await batch.commit();
    console.log(`Cleaned up ${expiredSessions.size} expired video sessions`);
  } catch (error) {
    console.error('Failed to cleanup expired sessions:', error);
  }
};

/**
 * Anti-piracy detection middleware
 */
const antiPiracyDetection = async (req, res, next) => {
  try {
    const suspiciousPatterns = [
      // Multiple rapid requests
      { pattern: 'RAPID_REQUESTS', threshold: 10, window: 60000 }, // 10 requests in 1 minute
      // Unusual user agents
      { pattern: 'SUSPICIOUS_USER_AGENT', keywords: ['bot', 'crawler', 'scraper', 'downloader'] },
      // Multiple concurrent sessions from same IP
      { pattern: 'MULTIPLE_SESSIONS', threshold: 5 }
    ];
    
    // Check for suspicious patterns
    for (const pattern of suspiciousPatterns) {
      const detected = await detectSuspiciousPattern(req, pattern);
      if (detected) {
        await logAuditEvent(AUDIT_EVENTS.SUSPICIOUS_ACTIVITY, req, {
          pattern: pattern.pattern,
          details: detected,
          riskLevel: RISK_LEVELS.HIGH
        });
        
        // Block request if critical pattern detected
        if (pattern.pattern === 'MULTIPLE_SESSIONS') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'SUSPICIOUS_ACTIVITY_DETECTED',
              message: 'Suspicious activity detected. Access temporarily restricted.'
            }
          });
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('Anti-piracy detection error:', error);
    next(); // Don't block request on detection error
  }
};

/**
 * Detect suspicious patterns
 */
const detectSuspiciousPattern = async (req, pattern) => {
  // Implementation would depend on the specific pattern
  // This is a simplified version
  return false;
};

// Schedule cleanup of expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
  DRM_CONFIG,
  generateVideoToken,
  verifyVideoToken,
  generateDeviceFingerprint,
  recordVideoView,
  terminateVideoSession,
  antiPiracyDetection,
  getActiveVideoSessions,
  getDailyViewCount
};