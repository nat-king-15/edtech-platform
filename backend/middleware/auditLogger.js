const { db } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

/**
 * Audit Logger Middleware
 * Tracks all important user actions and system events
 */

/**
 * Audit event types
 */
const AUDIT_EVENTS = {
  // Authentication events
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_REGISTER: 'USER_REGISTER',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  FAILED_LOGIN: 'FAILED_LOGIN',
  
  // User management
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  
  // Course and content management
  COURSE_CREATED: 'COURSE_CREATED',
  COURSE_UPDATED: 'COURSE_UPDATED',
  COURSE_DELETED: 'COURSE_DELETED',
  BATCH_CREATED: 'BATCH_CREATED',
  BATCH_UPDATED: 'BATCH_UPDATED',
  BATCH_DELETED: 'BATCH_DELETED',
  
  // Enrollment events
  STUDENT_ENROLLED: 'STUDENT_ENROLLED',
  STUDENT_UNENROLLED: 'STUDENT_UNENROLLED',
  
  // Payment events
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUND: 'PAYMENT_REFUND',
  
  // Content access
  VIDEO_ACCESSED: 'VIDEO_ACCESSED',
  ASSIGNMENT_SUBMITTED: 'ASSIGNMENT_SUBMITTED',
  QUIZ_ATTEMPTED: 'QUIZ_ATTEMPTED',
  
  // Security events
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  DATA_EXPORT: 'DATA_EXPORT',
  BULK_OPERATION: 'BULK_OPERATION',
  
  // System events
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  API_ERROR: 'API_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR'
};

/**
 * Risk levels for audit events
 */
const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * Create audit log entry
 */
async function createAuditLog({
  eventType,
  userId = null,
  userRole = null,
  resourceType = null,
  resourceId = null,
  action,
  details = {},
  ipAddress,
  userAgent,
  riskLevel = RISK_LEVELS.LOW,
  success = true,
  errorMessage = null
}) {
  try {
    const auditEntry = {
      id: uuidv4(),
      eventType,
      userId,
      userRole,
      resourceType,
      resourceId,
      action,
      details,
      ipAddress,
      userAgent,
      riskLevel,
      success,
      errorMessage,
      timestamp: new Date(),
      createdAt: new Date()
    };

    await db.collection('audit_logs').add(auditEntry);
    
    // If high risk, also log to security collection
    if (riskLevel === RISK_LEVELS.HIGH || riskLevel === RISK_LEVELS.CRITICAL) {
      await db.collection('security_alerts').add({
        ...auditEntry,
        alertType: 'HIGH_RISK_ACTIVITY',
        reviewed: false,
        reviewedBy: null,
        reviewedAt: null
      });
    }
    
    console.log(`Audit log created: ${eventType} by user ${userId}`);
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw error to avoid breaking the main request
  }
}

/**
 * Audit middleware for automatic logging
 */
const auditMiddleware = (eventType, options = {}) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the audit event
      const auditData = {
        eventType,
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
        resourceType: options.resourceType || null,
        resourceId: req.params?.id || req.params?.resourceId || null,
        action: `${req.method} ${req.originalUrl}`,
        details: {
          requestBody: options.logRequestBody ? req.body : {},
          requestParams: req.params,
          requestQuery: req.query,
          responseStatus: res.statusCode,
          ...options.additionalDetails
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        riskLevel: options.riskLevel || RISK_LEVELS.LOW,
        success: res.statusCode < 400,
        errorMessage: res.statusCode >= 400 ? data : null
      };
      
      createAuditLog(auditData);
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Helper function to log specific events
 */
const logAuditEvent = async (eventType, req, additionalData = {}) => {
  await createAuditLog({
    eventType,
    userId: req.user?.id || null,
    userRole: req.user?.role || null,
    action: `${req.method} ${req.originalUrl}`,
    details: {
      requestBody: req.body,
      requestParams: req.params,
      requestQuery: req.query,
      ...additionalData
    },
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    riskLevel: additionalData.riskLevel || RISK_LEVELS.LOW,
    success: true
  });
};

/**
 * Get audit logs with filtering
 */
const getAuditLogs = async (filters = {}) => {
  try {
    let query = db.collection('audit_logs');
    
    // Apply filters
    if (filters.userId) {
      query = query.where('userId', '==', filters.userId);
    }
    
    if (filters.eventType) {
      query = query.where('eventType', '==', filters.eventType);
    }
    
    if (filters.riskLevel) {
      query = query.where('riskLevel', '==', filters.riskLevel);
    }
    
    if (filters.startDate) {
      query = query.where('timestamp', '>=', new Date(filters.startDate));
    }
    
    if (filters.endDate) {
      query = query.where('timestamp', '<=', new Date(filters.endDate));
    }
    
    // Order by timestamp descending
    query = query.orderBy('timestamp', 'desc');
    
    // Apply limit
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    const snapshot = await query.get();
    const logs = [];
    
    snapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return logs;
  } catch (error) {
    console.error('Failed to get audit logs:', error);
    throw error;
  }
};

/**
 * Get security alerts
 */
const getSecurityAlerts = async (filters = {}) => {
  try {
    let query = db.collection('security_alerts');
    
    if (filters.reviewed !== undefined) {
      query = query.where('reviewed', '==', filters.reviewed);
    }
    
    if (filters.riskLevel) {
      query = query.where('riskLevel', '==', filters.riskLevel);
    }
    
    query = query.orderBy('timestamp', 'desc');
    
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    const snapshot = await query.get();
    const alerts = [];
    
    snapshot.forEach(doc => {
      alerts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return alerts;
  } catch (error) {
    console.error('Failed to get security alerts:', error);
    throw error;
  }
};

module.exports = {
  AUDIT_EVENTS,
  RISK_LEVELS,
  createAuditLog,
  auditMiddleware,
  logAuditEvent,
  getAuditLogs,
  getSecurityAlerts
};