# EdTech Platform - Error Handling Validation

## Overview
This document provides comprehensive error handling validation procedures for the EdTech platform, covering frontend, backend, database, third-party integrations, and system-wide error management.

## Frontend Error Handling

### JavaScript Error Handling
- [ ] Global error boundary implementation
- [ ] Try-catch blocks in async operations
- [ ] Promise rejection handling
- [ ] Event listener error handling
- [ ] Component lifecycle error handling
- [ ] State management error handling
- [ ] Form validation error display
- [ ] Network request error handling
- [ ] File upload error handling
- [ ] WebSocket error handling

### React Error Boundaries
```javascript
// Error boundary implementation
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error);
    console.error('Error info:', errorInfo);
    
    // Log to error reporting service
    errorReporter.logError({
      error: error.toString(),
      componentStack: errorInfo.componentStack,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### Network Error Handling
- [ ] HTTP status code handling
  - [ ] 400 Bad Request
  - [ ] 401 Unauthorized
  - [ ] 403 Forbidden
  - [ ] 404 Not Found
  - [ ] 429 Too Many Requests
  - [ ] 500 Internal Server Error
  - [ ] 502 Bad Gateway
  - [ ] 503 Service Unavailable
- [ ] Timeout handling (30 seconds default)
- [ ] Retry logic implementation
- [ ] Circuit breaker pattern
- [ ] Offline mode detection
- [ ] Network status monitoring

### Form Validation Errors
```javascript
// Form validation error handling
const handleFormSubmit = async (formData) => {
  try {
    setLoading(true);
    setErrors({});
    
    // Client-side validation
    const validationErrors = validateForm(formData);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    // Server submission
    const response = await fetch('/api/submit-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      if (response.status === 422) {
        // Validation errors from server
        setErrors(errorData.errors);
      } else {
        throw new Error(errorData.message || 'Submission failed');
      }
      return;
    }
    
    // Success handling
    showSuccess('Form submitted successfully');
    resetForm();
    
  } catch (error) {
    console.error('Form submission error:', error);
    showError('Failed to submit form. Please try again.');
  } finally {
    setLoading(false);
  }
};
```

## Backend Error Handling

### Express.js Error Middleware
```javascript
// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  // Log error details
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  });

  // Determine error type and status code
  let statusCode = 500;
  let message = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';

  if (err instanceof ValidationError) {
    statusCode = 400;
    message = 'Validation error';
    errorCode = 'VALIDATION_ERROR';
  } else if (err instanceof AuthenticationError) {
    statusCode = 401;
    message = 'Authentication failed';
    errorCode = 'AUTHENTICATION_ERROR';
  } else if (err instanceof AuthorizationError) {
    statusCode = 403;
    message = 'Access denied';
    errorCode = 'AUTHORIZATION_ERROR';
  } else if (err instanceof NotFoundError) {
    statusCode = 404;
    message = 'Resource not found';
    errorCode = 'NOT_FOUND_ERROR';
  } else if (err instanceof RateLimitError) {
    statusCode = 429;
    message = 'Too many requests';
    errorCode = 'RATE_LIMIT_ERROR';
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: process.env.NODE_ENV === 'production' ? message : err.message,
      details: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      timestamp: new Date().toISOString(),
      requestId: req.id
    }
  });
};
```

### Custom Error Classes
```javascript
// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, fields) {
    super(message, 400, 'VALIDATION_ERROR');
    this.fields = fields;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
  }
}

class RateLimitError extends AppError {
  constructor(retryAfter) {
    super('Too many requests', 429, 'RATE_LIMIT_ERROR');
    this.retryAfter = retryAfter;
  }
}

class DatabaseError extends AppError {
  constructor(message) {
    super('Database operation failed', 500, 'DATABASE_ERROR');
    this.originalMessage = message;
  }
}
```

### Async Error Handling
```javascript
// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Usage in routes
router.post('/api/courses', asyncHandler(async (req, res) => {
  const { title, description, instructorId } = req.body;
  
  // Validate input
  if (!title || !description) {
    throw new ValidationError('Missing required fields', {
      title: !title ? 'Title is required' : undefined,
      description: !description ? 'Description is required' : undefined
    });
  }
  
  // Check if instructor exists
  const instructor = await User.findById(instructorId);
  if (!instructor) {
    throw new NotFoundError('Instructor');
  }
  
  // Create course
  const course = await Course.create({ title, description, instructorId });
  
  res.status(201).json({
    success: true,
    data: course
  });
}));
```

## Database Error Handling

### Firestore Error Handling
```javascript
// Firestore error handling
class FirestoreErrorHandler {
  static handleError(error, operation) {
    logger.error({
      message: 'Firestore operation failed',
      operation,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });

    switch (error.code) {
      case 'cancelled':
        throw new AppError('Operation cancelled', 499, 'CANCELLED');
      case 'invalid-argument':
        throw new ValidationError('Invalid argument provided');
      case 'deadline-exceeded':
        throw new AppError('Operation timed out', 408, 'TIMEOUT');
      case 'not-found':
        throw new NotFoundError();
      case 'already-exists':
        throw new AppError('Resource already exists', 409, 'CONFLICT');
      case 'permission-denied':
        throw new AuthorizationError();
      case 'resource-exhausted':
        throw new RateLimitError(60); // Retry after 60 seconds
      case 'unavailable':
        throw new AppError('Service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE');
      default:
        throw new DatabaseError(error.message);
    }
  }
}

// Usage in repository
async createUser(userData) {
  try {
    const docRef = await db.collection('users').add(userData);
    return { id: docRef.id, ...userData };
  } catch (error) {
    FirestoreErrorHandler.handleError(error, 'createUser');
  }
}
```

### Database Connection Error Handling
- [ ] Connection timeout handling
- [ ] Connection pool exhaustion
- [ ] Query timeout handling
- [ ] Deadlock detection and resolution
- [ ] Transaction rollback handling
- [ ] Database failover scenarios
- [ ] Backup and recovery procedures
- [ ] Data corruption detection
- [ ] Index optimization errors
- [ ] Storage space exhaustion

## Third-Party Service Error Handling

### Payment Gateway Error Handling
```javascript
// Payment gateway error handling
class PaymentErrorHandler {
  static handleRazorpayError(error) {
    logger.error({
      message: 'Razorpay payment failed',
      error: error.description,
      code: error.code,
      timestamp: new Date().toISOString()
    });

    const errorMap = {
      'BAD_REQUEST_ERROR': new ValidationError('Invalid payment details'),
      'GATEWAY_ERROR': new AppError('Payment gateway error', 502, 'GATEWAY_ERROR'),
      'SERVER_ERROR': new AppError('Payment service error', 503, 'SERVICE_UNAVAILABLE'),
      'INVALID_PAYMENT_ID': new ValidationError('Invalid payment ID'),
      'PAYMENT_FAILED': new AppError('Payment failed', 400, 'PAYMENT_FAILED'),
      'PAYMENT_CANCELLED': new AppError('Payment cancelled by user', 400, 'PAYMENT_CANCELLED')
    };

    throw errorMap[error.code] || new AppError('Payment processing failed', 500, 'PAYMENT_ERROR');
  }

  static handleStripeError(error) {
    // Similar implementation for Stripe
    logger.error({
      message: 'Stripe payment failed',
      error: error.message,
      code: error.code,
      type: error.type,
      timestamp: new Date().toISOString()
    });

    if (error.type === 'StripeCardError') {
      throw new AppError(error.message, 400, 'CARD_ERROR');
    } else if (error.type === 'StripeRateLimitError') {
      throw new RateLimitError(60);
    } else if (error.type === 'StripeConnectionError') {
      throw new AppError('Payment service unavailable', 503, 'SERVICE_UNAVAILABLE');
    } else {
      throw new AppError('Payment processing failed', 500, 'PAYMENT_ERROR');
    }
  }
}
```

### Email Service Error Handling
```javascript
// Email service error handling
class EmailErrorHandler {
  static handleSendGridError(error) {
    logger.error({
      message: 'SendGrid email failed',
      error: error.message,
      response: error.response?.body,
      timestamp: new Date().toISOString()
    });

    if (error.code === 401) {
      throw new AppError('Email service authentication failed', 500, 'EMAIL_AUTH_ERROR');
    } else if (error.code === 413) {
      throw new ValidationError('Email content too large');
    } else if (error.code === 429) {
      throw new RateLimitError(300); // Retry after 5 minutes
    } else {
      throw new AppError('Email sending failed', 500, 'EMAIL_ERROR');
    }
  }

  static handleNodemailerError(error) {
    logger.error({
      message: 'Nodemailer email failed',
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });

    const errorMap = {
      'ECONNECTION': new AppError('Email server connection failed', 503, 'EMAIL_CONNECTION_ERROR'),
      'EAUTH': new AppError('Email authentication failed', 500, 'EMAIL_AUTH_ERROR'),
      'ESOCKET': new AppError('Email socket error', 503, 'EMAIL_SOCKET_ERROR'),
      'EMESSAGE': new ValidationError('Invalid email message format')
    };

    throw errorMap[error.code] || new AppError('Email sending failed', 500, 'EMAIL_ERROR');
  }
}
```

### File Storage Error Handling
```javascript
// File storage error handling
class StorageErrorHandler {
  static handleFirebaseStorageError(error) {
    logger.error({
      message: 'Firebase Storage operation failed',
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });

    switch (error.code) {
      case 'storage/unauthorized':
        throw new AuthorizationError();
      case 'storage/canceled':
        throw new AppError('Upload cancelled', 400, 'UPLOAD_CANCELLED');
      case 'storage/unknown':
        throw new AppError('Storage service error', 503, 'STORAGE_ERROR');
      case 'storage/object-not-found':
        throw new NotFoundError('File');
      case 'storage/quota-exceeded':
        throw new AppError('Storage quota exceeded', 413, 'QUOTA_EXCEEDED');
      case 'storage/unauthenticated':
        throw new AuthenticationError();
      default:
        throw new AppError('File operation failed', 500, 'FILE_ERROR');
    }
  }

  static handleMuxError(error) {
    logger.error({
      message: 'Mux video processing failed',
      error: error.message,
      type: error.type,
      timestamp: new Date().toISOString()
    });

    if (error.type === 'invalid_parameters') {
      throw new ValidationError('Invalid video parameters');
    } else if (error.type === 'unauthorized') {
      throw new AuthenticationError();
    } else if (error.type === 'rate_limit_exceeded') {
      throw new RateLimitError(60);
    } else {
      throw new AppError('Video processing failed', 503, 'VIDEO_PROCESSING_ERROR');
    }
  }
}
```

## Validation Error Handling

### Input Validation Errors
```javascript
// Input validation error handling
const validateCourseInput = (req, res, next) => {
  const errors = {};
  
  // Title validation
  if (!req.body.title || req.body.title.trim().length === 0) {
    errors.title = 'Course title is required';
  } else if (req.body.title.length < 3) {
    errors.title = 'Course title must be at least 3 characters';
  } else if (req.body.title.length > 100) {
    errors.title = 'Course title cannot exceed 100 characters';
  }
  
  // Description validation
  if (!req.body.description || req.body.description.trim().length === 0) {
    errors.description = 'Course description is required';
  } else if (req.body.description.length < 10) {
    errors.description = 'Course description must be at least 10 characters';
  } else if (req.body.description.length > 2000) {
    errors.description = 'Course description cannot exceed 2000 characters';
  }
  
  // Price validation
  if (req.body.price !== undefined) {
    const price = parseFloat(req.body.price);
    if (isNaN(price) || price < 0) {
      errors.price = 'Price must be a positive number';
    } else if (price > 10000) {
      errors.price = 'Price cannot exceed $10,000';
    }
  }
  
  // Category validation
  const validCategories = ['programming', 'design', 'business', 'marketing'];
  if (req.body.category && !validCategories.includes(req.body.category)) {
    errors.category = 'Invalid category selected';
  }
  
  // If validation errors exist
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid course data', errors);
  }
  
  next();
};
```

### Business Logic Validation
```javascript
// Business logic validation
const validateEnrollment = async (req, res, next) => {
  const { courseId } = req.body;
  const userId = req.user.id;
  
  try {
    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      throw new NotFoundError('Course');
    }
    
    // Check if course is published
    if (course.status !== 'published') {
      throw new ValidationError('Cannot enroll in unpublished course', {
        course: 'This course is not available for enrollment'
      });
    }
    
    // Check if user is already enrolled
    const existingEnrollment = await Enrollment.findOne({ userId, courseId });
    if (existingEnrollment) {
      throw new ValidationError('Already enrolled in this course', {
        enrollment: 'You are already enrolled in this course'
      });
    }
    
    // Check course capacity
    const enrollmentCount = await Enrollment.countDocuments({ courseId });
    if (course.maxStudents && enrollmentCount >= course.maxStudents) {
      throw new ValidationError('Course is full', {
        capacity: 'This course has reached maximum capacity'
      });
    }
    
    // Check prerequisites
    if (course.prerequisites && course.prerequisites.length > 0) {
      const completedCourses = await Enrollment.find({
        userId,
        status: 'completed',
        courseId: { $in: course.prerequisites }
      });
      
      if (completedCourses.length < course.prerequisites.length) {
        throw new ValidationError('Prerequisites not met', {
          prerequisites: 'You must complete all prerequisites before enrolling'
        });
      }
    }
    
    next();
    
  } catch (error) {
    next(error);
  }
};
```

## Error Logging and Monitoring

### Structured Error Logging
```javascript
// Structured error logging
class ErrorLogger {
  static logError(error, context = {}) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: error.message,
      stack: error.stack,
      code: error.errorCode || 'UNKNOWN_ERROR',
      statusCode: error.statusCode || 500,
      context: {
        ...context,
        userAgent: context.userAgent || 'unknown',
        ip: context.ip || 'unknown',
        userId: context.userId || 'anonymous',
        requestId: context.requestId || 'unknown'
      },
      environment: process.env.NODE_ENV,
      service: 'edtech-platform',
      version: process.env.APP_VERSION
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error:', errorLog);
    }

    // Log to file
    logger.error(JSON.stringify(errorLog));

    // Send to external logging service
    if (process.env.LOG_SERVICE_URL) {
      this.sendToLogService(errorLog);
    }
  }

  static logWarning(message, context = {}) {
    const warningLog = {
      timestamp: new Date().toISOString(),
      level: 'warning',
      message,
      context,
      environment: process.env.NODE_ENV,
      service: 'edtech-platform'
    };

    logger.warn(JSON.stringify(warningLog));
  }

  static async sendToLogService(errorLog) {
    try {
      await fetch(process.env.LOG_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LOG_SERVICE_TOKEN}`
        },
        body: JSON.stringify(errorLog)
      });
    } catch (error) {
      console.error('Failed to send error to log service:', error);
    }
  }
}
```

### Error Monitoring Dashboard
```javascript
// Error monitoring and alerting
class ErrorMonitor {
  constructor() {
    this.errorCounts = new Map();
    this.alertThresholds = {
      critical: 10,  // 10 errors in 5 minutes
      high: 50,       // 50 errors in 5 minutes
      medium: 100     // 100 errors in 5 minutes
    };
  }

  recordError(error, severity = 'medium') {
    const now = Date.now();
    const key = `${error.code}_${Math.floor(now / 300000)}`; // 5-minute buckets
    
    if (!this.errorCounts.has(key)) {
      this.errorCounts.set(key, { count: 0, severity, firstSeen: now });
    }
    
    this.errorCounts.get(key).count++;
    
    // Check if alert threshold reached
    this.checkAlertThreshold(key, severity);
  }

  checkAlertThreshold(key, severity) {
    const errorData = this.errorCounts.get(key);
    const threshold = this.alertThresholds[severity];
    
    if (errorData.count >= threshold) {
      this.sendAlert({
        severity,
        errorCode: key.split('_')[0],
        count: errorData.count,
        timeWindow: '5 minutes',
        message: `Error threshold exceeded: ${errorData.count} ${severity} errors`
      });
    }
  }

  async sendAlert(alertData) {
    // Send to alerting service
    try {
      await fetch(process.env.ALERT_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ALERT_SERVICE_TOKEN}`
        },
        body: JSON.stringify(alertData)
      });
    } catch (error) {
      console.error('Failed to send alert:', error);
    }
  }

  // Clean up old error counts (older than 1 hour)
  cleanup() {
    const oneHourAgo = Date.now() - 3600000;
    for (const [key, data] of this.errorCounts.entries()) {
      if (data.firstSeen < oneHourAgo) {
        this.errorCounts.delete(key);
      }
    }
  }
}
```

## User-Friendly Error Messages

### Error Message Guidelines
- [ ] Clear and concise language
- [ ] Actionable next steps
- [ ] Avoid technical jargon
- [ ] Consistent tone and style
- [ ] Appropriate error categorization
- [ ] Localization support
- [ ] Accessibility compliance
- [ ] Brand voice consistency

### Error Message Templates
```javascript
// Error message templates
const errorMessages = {
  // Authentication errors
  LOGIN_FAILED: 'Invalid email or password. Please check your credentials and try again.',
  ACCOUNT_LOCKED: 'Your account has been temporarily locked due to multiple failed login attempts. Please try again in 15 minutes or reset your password.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again to continue.',
  
  // Authorization errors
  INSUFFICIENT_PERMISSIONS: 'You do not have permission to access this resource.',
  FEATURE_RESTRICTED: 'This feature is not available for your account type.',
  
  // Validation errors
  INVALID_EMAIL: 'Please enter a valid email address.',
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters long.',
  PASSWORD_TOO_WEAK: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
  FIELD_REQUIRED: 'This field is required.',
  
  // Not found errors
  COURSE_NOT_FOUND: 'The course you are looking for does not exist or may have been removed.',
  USER_NOT_FOUND: 'User not found. Please check the username or email address.',
  
  // Payment errors
  PAYMENT_FAILED: 'Payment processing failed. Please try again or use a different payment method.',
  PAYMENT_DECLINED: 'Your payment was declined. Please contact your bank for more information.',
  INSUFFICIENT_FUNDS: 'Insufficient funds. Please check your account balance or use a different payment method.',
  
  // System errors
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again in a few minutes.',
  MAINTENANCE_MODE: 'The system is currently under maintenance. Please try again later.',
  UNEXPECTED_ERROR: 'An unexpected error occurred. Our team has been notified and is working to resolve the issue.'
};

// Error message formatter
const formatErrorMessage = (errorCode, context = {}) => {
  const template = errorMessages[errorCode] || errorMessages.UNEXPECTED_ERROR;
  
  // Replace placeholders with context
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] || match;
  });
};
```

## Error Recovery Mechanisms

### Automatic Retry Logic
```javascript
// Exponential backoff retry
class RetryManager {
  static async withRetry(operation, options = {}) {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 30000,
      backoffFactor = 2,
      retryableErrors = []
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        if (attempt === maxRetries || !this.isRetryableError(error, retryableErrors)) {
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          initialDelay * Math.pow(backoffFactor, attempt),
          maxDelay
        );
        
        logger.warn(`Retry attempt ${attempt + 1} after ${delay}ms delay`, {
          error: error.message,
          attempt: attempt + 1,
          maxRetries
        });
        
        await this.delay(delay);
      }
    }
    
    throw lastError;
  }

  static isRetryableError(error, retryableErrors) {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    // HTTP errors
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    if (error.statusCode && retryableStatusCodes.includes(error.statusCode)) {
      return true;
    }
    
    // Custom retryable errors
    return retryableErrors.includes(error.errorCode);
  }

  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const result = await RetryManager.withRetry(
  () => fetchUserData(userId),
  {
    maxRetries: 3,
    initialDelay: 1000,
    retryableErrors: ['DATABASE_ERROR', 'SERVICE_UNAVAILABLE']
  }
);
```

### Circuit Breaker Pattern
```javascript
// Circuit breaker implementation
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new AppError('Circuit breaker is open', 503, 'CIRCUIT_BREAKER_OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      
      logger.error('Circuit breaker opened due to multiple failures', {
        failureCount: this.failureCount,
        nextAttempt: new Date(this.nextAttempt).toISOString()
      });
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttempt
    };
  }
}
```

## Testing Error Scenarios

### Error Handling Test Cases
```javascript
// Error handling test cases
describe('Error Handling', () => {
  describe('Validation Errors', () => {
    it('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/courses')
        .send({ description: 'Test course' })
        .expect(400);
      
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toHaveProperty('title');
    });

    it('should handle invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123'
        })
        .expect(400);
      
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authentication Errors', () => {
    it('should handle invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        })
        .expect(401);
      
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should handle expired token', async () => {
      const expiredToken = jwt.sign({ userId: '123' }, process.env.JWT_SECRET, { expiresIn: '-1h' });
      
      const response = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
      
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Database Errors', () => {
    it('should handle connection timeout', async () => {
      // Mock database connection timeout
      jest.spyOn(db, 'collection').mockImplementation(() => {
        throw new Error('Connection timeout');
      });

      const response = await request(app)
        .get('/api/courses')
        .expect(500);
      
      expect(response.body.error.code).toBe('DATABASE_ERROR');
    });

    it('should handle duplicate key errors', async () => {
      const userData = {
        email: 'existing@example.com',
        password: 'password123'
      };

      // Create user first
      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409);
      
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('Third-Party Service Errors', () => {
    it('should handle payment gateway errors', async () => {
      // Mock payment gateway failure
      jest.spyOn(paymentService, 'processPayment').mockRejectedValue(
        new Error('Payment declined')
      );

      const response = await request(app)
        .post('/api/payments/process')
        .send({
          amount: 1000,
          paymentMethod: 'card'
        })
        .expect(400);
      
      expect(response.body.error.code).toBe('PAYMENT_FAILED');
    });

    it('should handle email service errors', async () => {
      // Mock email service failure
      jest.spyOn(emailService, 'sendEmail').mockRejectedValue(
        new Error('Email service unavailable')
      );

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })
        .expect(503);
      
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });
});
```

## Error Handling Commands and Scripts

### Error Testing Commands
```bash
# Test error handling scenarios
npm run test:error-handling

# Test specific error types
npm run test:validation-errors
npm run test:authentication-errors
npm run test:database-errors
npm run test:network-errors

# Generate error report
npm run test:error-report

# Monitor error logs
npm run logs:errors

# Check error rates
npm run monitor:error-rates
```

### Error Simulation Scripts
```javascript
// Error simulation for testing
class ErrorSimulator {
  static simulateNetworkError() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const error = new Error('Network request failed');
        error.code = 'ECONNREFUSED';
        reject(error);
      }, 1000);
    });
  }

  static simulateTimeoutError() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const error = new Error('Request timeout');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, 30000);
    });
  }

  static simulateValidationError() {
    const error = new ValidationError('Validation failed', {
      email: 'Invalid email format',
      password: 'Password too short'
    });
    throw error;
  }

  static simulateDatabaseError() {
    const error = new Error('Database connection failed');
    error.code = 'ECONNREFUSED';
    throw new DatabaseError(error.message);
  }

  static simulateThirdPartyError() {
    const error = new Error('Payment processing failed');
    error.code = 'PAYMENT_FAILED';
    throw new AppError('Payment declined', 400, 'PAYMENT_FAILED');
  }
}

// Usage in tests
it('should handle network errors gracefully', async () => {
  try {
    await ErrorSimulator.simulateNetworkError();
  } catch (error) {
    expect(error.code).toBe('ECONNREFUSED');
    expect(error.message).toContain('Network request failed');
  }
});
```

## Notes
- Implement comprehensive error handling across all layers
- Test error scenarios regularly
- Monitor error rates and patterns
- Maintain user-friendly error messages
- Ensure proper error logging and tracking
- Implement appropriate recovery mechanisms
- Regular review and update of error handling procedures
- Document all error codes and their meanings