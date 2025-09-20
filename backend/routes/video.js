const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { 
  generateVideoToken, 
  verifyVideoToken, 
  recordVideoView, 
  terminateVideoSession,
  getActiveVideoSessions 
} = require('../middleware/drmProtection');
const { logAuditEvent, AUDIT_EVENTS, RISK_LEVELS } = require('../middleware/auditLogger');
const { db } = require('../config/firebase');

/**
 * Video Streaming Routes with DRM Protection
 * Implements secure video access, token-based authentication, and anti-piracy measures
 */

/**
 * Generate video access token
 * POST /api/video/token
 */
router.post('/token', authMiddleware, async (req, res) => {
  try {
    const { videoId, batchId } = req.body;
    const userId = req.user.uid;
    
    if (!videoId || !batchId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'videoId and batchId are required'
        }
      });
    }
    
    // Verify user has access to the batch
    let enrollment = await db.collection('enrollments')
      .where('studentId', '==', userId)
      .where('batchId', '==', batchId)
      .where('paymentStatus', '==', 'completed')
      .get();
    
    // Fallback check for legacy enrollments with status field
    if (enrollment.empty) {
      const legacyEnrollment = await db.collection('enrollments')
        .where('studentId', '==', userId)
        .where('batchId', '==', batchId)
        .where('status', '==', 'active')
        .get();
      
      if (!legacyEnrollment.empty) {
        // Update legacy enrollment to use paymentStatus
        const legacyDoc = legacyEnrollment.docs[0];
        await legacyDoc.ref.update({ paymentStatus: 'completed' });
        enrollment = legacyEnrollment;
      }
    }
    
    if (enrollment.empty) {
      await logAuditEvent(AUDIT_EVENTS.UNAUTHORIZED_ACCESS, req, {
        reason: 'User not enrolled in batch',
        videoId,
        batchId,
        riskLevel: RISK_LEVELS.MEDIUM
      });
      
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You are not enrolled in this batch'
        }
      });
    }
    
    // Generate secure video token
    const tokenData = await generateVideoToken(userId, videoId, batchId);
    
    await logAuditEvent(AUDIT_EVENTS.VIDEO_ACCESS, req, {
      videoId,
      batchId,
      sessionId: tokenData.sessionId,
      riskLevel: RISK_LEVELS.LOW
    });
    
    res.json({
      success: true,
      data: tokenData,
      message: 'Video access token generated successfully'
    });
    
  } catch (error) {
    console.error('Failed to generate video token:', error);
    
    await logAuditEvent(AUDIT_EVENTS.SYSTEM_ERROR, req, {
      error: error.message,
      action: 'generate_video_token',
      riskLevel: RISK_LEVELS.MEDIUM
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'TOKEN_GENERATION_FAILED',
        message: error.message || 'Failed to generate video access token'
      }
    });
  }
});

/**
 * Stream video content (protected)
 * GET /api/video/stream/:videoId
 */
router.get('/stream/:videoId', verifyVideoToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { userId, sessionId, batchId } = req.videoAccess;
    
    // Get video details from database
    const videoDoc = await db.collection('videos').doc(videoId).get();
    
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
    
    // Record video view
    await recordVideoView(userId, videoId, batchId, sessionId);
    
    await logAuditEvent(AUDIT_EVENTS.VIDEO_VIEW, req, {
      videoId,
      batchId,
      sessionId,
      videoTitle: videoData.title,
      riskLevel: RISK_LEVELS.LOW
    });
    
    // Return video streaming URL (in production, this would be a signed URL)
    res.json({
      success: true,
      data: {
        videoId,
        title: videoData.title,
        description: videoData.description,
        streamUrl: videoData.muxPlaybackId 
          ? `https://stream.mux.com/${videoData.muxPlaybackId}.m3u8`
          : videoData.streamUrl,
        duration: videoData.duration,
        watermark: req.videoAccess.watermarkData,
        sessionId
      },
      message: 'Video stream access granted'
    });
    
  } catch (error) {
    console.error('Video streaming error:', error);
    
    await logAuditEvent(AUDIT_EVENTS.SYSTEM_ERROR, req, {
      error: error.message,
      action: 'video_stream',
      videoId: req.params.videoId,
      riskLevel: RISK_LEVELS.MEDIUM
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'STREAMING_ERROR',
        message: 'Failed to access video stream'
      }
    });
  }
});

/**
 * Get video metadata (protected)
 * GET /api/video/metadata/:videoId
 */
router.get('/metadata/:videoId', verifyVideoToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { userId, batchId } = req.videoAccess;
    
    // Get video metadata
    const videoDoc = await db.collection('videos').doc(videoId).get();
    
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
    
    // Get user's progress for this video
    const progressDoc = await db.collection('video_progress')
      .where('userId', '==', userId)
      .where('videoId', '==', videoId)
      .get();
    
    let progress = null;
    if (!progressDoc.empty) {
      progress = progressDoc.docs[0].data();
    }
    
    res.json({
      success: true,
      data: {
        videoId,
        title: videoData.title,
        description: videoData.description,
        duration: videoData.duration,
        thumbnailUrl: videoData.thumbnailUrl,
        createdAt: videoData.createdAt,
        progress: progress ? {
          watchedDuration: progress.watchedDuration,
          totalDuration: progress.totalDuration,
          progressPercentage: progress.progressPercentage,
          completed: progress.completed,
          lastWatchedAt: progress.lastWatchedAt
        } : null
      },
      message: 'Video metadata retrieved successfully'
    });
    
  } catch (error) {
    console.error('Failed to get video metadata:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'METADATA_ERROR',
        message: 'Failed to retrieve video metadata'
      }
    });
  }
});

/**
 * Terminate video session
 * POST /api/video/terminate
 */
router.post('/terminate', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.uid;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'sessionId is required'
        }
      });
    }
    
    // Verify session belongs to user
    const sessionDoc = await db.collection('video_sessions')
      .where('sessionId', '==', sessionId)
      .where('userId', '==', userId)
      .get();
    
    if (sessionDoc.empty) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Video session not found'
        }
      });
    }
    
    // Terminate session
    await terminateVideoSession(sessionId);
    
    await logAuditEvent(AUDIT_EVENTS.VIDEO_SESSION_END, req, {
      sessionId,
      terminatedBy: 'user',
      riskLevel: RISK_LEVELS.LOW
    });
    
    res.json({
      success: true,
      message: 'Video session terminated successfully'
    });
    
  } catch (error) {
    console.error('Failed to terminate video session:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'TERMINATION_ERROR',
        message: 'Failed to terminate video session'
      }
    });
  }
});

/**
 * Get active video sessions
 * GET /api/video/sessions
 */
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const activeSessions = await getActiveVideoSessions(userId);
    
    res.json({
      success: true,
      data: {
        sessions: activeSessions.map(session => ({
          sessionId: session.sessionId,
          videoId: session.videoId,
          batchId: session.batchId,
          createdAt: session.createdAt,
          lastAccessAt: session.lastAccessAt,
          expiresAt: session.expiresAt
        })),
        count: activeSessions.length,
        maxAllowed: 3
      },
      message: 'Active video sessions retrieved successfully'
    });
    
  } catch (error) {
    console.error('Failed to get active sessions:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSIONS_ERROR',
        message: 'Failed to retrieve active sessions'
      }
    });
  }
});

module.exports = router;