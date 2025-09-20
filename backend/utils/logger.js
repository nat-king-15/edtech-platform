/**
 * Structured Logger Service using Winston
 * Provides centralized logging with different levels, formats, and transports
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom log format for structured logging
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, operation, ...meta }) => {
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: service || 'email-service',
      operation: operation || 'unknown',
      message,
      ...meta
    };

    // Remove undefined values
    Object.keys(logEntry).forEach(key => {
      if (logEntry[key] === undefined) {
        delete logEntry[key];
      }
    });

    return JSON.stringify(logEntry);
  })
);

/**
 * Console format for development
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, service, operation, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const serviceStr = service ? `[${service}]` : '';
    const operationStr = operation ? `[${operation}]` : '';
    return `${timestamp} ${level}${serviceStr}${operationStr}: ${message}${metaStr}`;
  })
);

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'email-service',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),

    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    }),

    // Email-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'email.log'),
      level: 'info',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 7,
      tailable: true
    })
  ],
  
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log')
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log')
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
}

/**
 * Email Service Logger
 * Specialized logger for email operations with structured metadata
 */
class EmailLogger {
  constructor(service = 'email-service') {
    this.service = service;
    this.logger = logger;
  }

  /**
   * Log email sending attempt
   */
  logEmailAttempt(operation, metadata = {}) {
    this.logger.info('Email sending attempt', {
      service: this.service,
      operation,
      ...metadata
    });
  }

  /**
   * Log successful email delivery
   */
  logEmailSuccess(operation, metadata = {}) {
    this.logger.info('Email sent successfully', {
      service: this.service,
      operation,
      status: 'success',
      ...metadata
    });
  }

  /**
   * Log email sending failure
   */
  logEmailError(operation, error, metadata = {}) {
    this.logger.error('Email sending failed', {
      service: this.service,
      operation,
      status: 'error',
      error: {
        message: error.message,
        code: error.code,
        responseCode: error.responseCode,
        command: error.command,
        stack: error.stack
      },
      ...metadata
    });
  }

  /**
   * Log retry attempt
   */
  logRetryAttempt(operation, attempt, error, metadata = {}) {
    this.logger.warn('Email retry attempt', {
      service: this.service,
      operation,
      status: 'retry',
      attempt,
      error: {
        message: error.message,
        code: error.code,
        responseCode: error.responseCode
      },
      ...metadata
    });
  }

  /**
   * Log template rendering
   */
  logTemplateRender(templateName, metadata = {}) {
    this.logger.debug('Template rendered', {
      service: this.service,
      operation: 'template-render',
      templateName,
      ...metadata
    });
  }

  /**
   * Log template error
   */
  logTemplateError(templateName, error, metadata = {}) {
    this.logger.error('Template rendering failed', {
      service: this.service,
      operation: 'template-render',
      templateName,
      error: {
        message: error.message,
        stack: error.stack
      },
      ...metadata
    });
  }

  /**
   * Log SMTP connection events
   */
  logConnection(event, metadata = {}) {
    this.logger.info('SMTP connection event', {
      service: this.service,
      operation: 'smtp-connection',
      event,
      ...metadata
    });
  }

  /**
   * Log bulk email operations
   */
  logBulkOperation(operation, stats, metadata = {}) {
    this.logger.info('Bulk email operation', {
      service: this.service,
      operation,
      stats: {
        total: stats.total || 0,
        successful: stats.successful || 0,
        failed: stats.failed || 0,
        duration: stats.duration || 0
      },
      ...metadata
    });
  }

  /**
   * Log performance metrics
   */
  logPerformance(operation, duration, metadata = {}) {
    this.logger.info('Performance metric', {
      service: this.service,
      operation,
      performance: {
        duration,
        timestamp: Date.now()
      },
      ...metadata
    });
  }

  /**
   * Log configuration events
   */
  logConfig(event, config, metadata = {}) {
    // Remove sensitive information from config
    const sanitizedConfig = { ...config };
    delete sanitizedConfig.password;
    delete sanitizedConfig.pass;
    delete sanitizedConfig.auth;

    this.logger.info('Configuration event', {
      service: this.service,
      operation: 'configuration',
      event,
      config: sanitizedConfig,
      ...metadata
    });
  }

  /**
   * Log security events
   */
  logSecurity(event, metadata = {}) {
    this.logger.warn('Security event', {
      service: this.service,
      operation: 'security',
      event,
      ...metadata
    });
  }

  /**
   * Create child logger with additional context
   */
  child(additionalMeta = {}) {
    const childLogger = new EmailLogger(this.service);
    const originalLogger = childLogger.logger;
    
    // Override the logger to include additional metadata
    childLogger.logger = {
      ...originalLogger,
      info: (message, meta = {}) => originalLogger.info(message, { ...additionalMeta, ...meta }),
      error: (message, meta = {}) => originalLogger.error(message, { ...additionalMeta, ...meta }),
      warn: (message, meta = {}) => originalLogger.warn(message, { ...additionalMeta, ...meta }),
      debug: (message, meta = {}) => originalLogger.debug(message, { ...additionalMeta, ...meta })
    };
    
    return childLogger;
  }

  /**
   * Get logger statistics
   */
  getStats() {
    return {
      level: this.logger.level,
      transports: this.logger.transports.length,
      service: this.service
    };
  }
}

/**
 * Utility functions for common logging patterns
 */
const LogUtils = {
  /**
   * Create a timing decorator for functions
   */
  timeFunction: (fn, logger, operation) => {
    return async function(...args) {
      const startTime = Date.now();
      try {
        const result = await fn.apply(this, args);
        const duration = Date.now() - startTime;
        logger.logPerformance(operation, duration);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logPerformance(operation, duration, { error: true });
        throw error;
      }
    };
  },

  /**
   * Sanitize email addresses for logging
   */
  sanitizeEmail: (email) => {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!domain) return email;
    return `${local.substring(0, 2)}***@${domain}`;
  },

  /**
   * Sanitize sensitive data from objects
   */
  sanitizeObject: (obj, sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth']) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sanitized = { ...obj };
    sensitiveKeys.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '***REDACTED***';
      }
    });
    
    return sanitized;
  }
};

// Export the logger instances and utilities
module.exports = {
  logger,
  EmailLogger,
  LogUtils
};