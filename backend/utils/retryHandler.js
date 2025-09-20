/**
 * Retry Handler with Exponential Backoff
 * Handles transient errors with configurable retry strategies
 */
class RetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 30000; // 30 seconds
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter !== false; // Add randomness by default
    this.retryableErrors = options.retryableErrors || [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ESOCKET',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'SMTP_CONNECTION_TIMEOUT',
      'SMTP_GREETING_TIMEOUT',
      'SMTP_COMMAND_TIMEOUT',
      'SMTP_DATA_TIMEOUT'
    ];
    this.retryableStatusCodes = options.retryableStatusCodes || [
      421, // Service not available
      450, // Requested mail action not taken: mailbox unavailable
      451, // Requested action aborted: local error in processing
      452, // Requested action not taken: insufficient system storage
      454, // Temporary authentication failure
      503, // Bad sequence of commands
      554  // Transaction failed (temporary)
    ];
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error is retryable
   */
  isRetryableError(error) {
    if (!error) return false;

    // Check error codes
    if (error.code && this.retryableErrors.includes(error.code)) {
      return true;
    }

    // Check SMTP response codes
    if (error.responseCode && this.retryableStatusCodes.includes(error.responseCode)) {
      return true;
    }

    // Check error messages for common transient patterns
    const errorMessage = error.message ? error.message.toLowerCase() : '';
    const transientPatterns = [
      'timeout',
      'connection reset',
      'connection refused',
      'network unreachable',
      'host unreachable',
      'temporary failure',
      'service unavailable',
      'rate limit',
      'too many requests',
      'server busy',
      'try again later'
    ];

    return transientPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Calculate delay for next retry attempt
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    let delay = this.baseDelay * Math.pow(this.backoffFactor, attempt);
    
    // Cap the delay at maxDelay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (this.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }
    
    return Math.max(delay, 0);
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Function to execute
   * @param {Object} context - Context for the function (this binding)
   * @param {Array} args - Arguments to pass to the function
   * @param {Object} options - Override options for this specific retry
   * @returns {Promise} Promise that resolves with the function result
   */
  async execute(fn, context = null, args = [], options = {}) {
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.maxRetries;
    const onRetry = options.onRetry || (() => {});
    const onError = options.onError || (() => {});
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn.apply(context, args);
        
        // Success - return the result
        if (attempt > 0) {
          // Log successful retry
          onRetry({
            attempt,
            success: true,
            totalAttempts: attempt + 1,
            error: lastError
          });
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // If this is the last attempt or error is not retryable, throw
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          onError({
            error,
            attempt,
            totalAttempts: attempt + 1,
            isRetryable: this.isRetryableError(error),
            finalAttempt: true
          });
          throw error;
        }
        
        // Calculate delay and wait
        const delay = this.calculateDelay(attempt);
        
        // Notify about retry attempt
        onRetry({
          attempt: attempt + 1,
          error,
          delay,
          totalAttempts: attempt + 2,
          success: false
        });
        
        // Wait before retrying
        await this.sleep(delay);
      }
    }
    
    // This should never be reached, but just in case
    throw lastError;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after the delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a function
   * @param {Function} fn - Function to wrap
   * @param {Object} options - Retry options
   * @returns {Function} Wrapped function with retry logic
   */
  wrap(fn, options = {}) {
    return async (...args) => {
      return this.execute(fn, null, args, options);
    };
  }

  /**
   * Create a retry wrapper for a method (preserves 'this' context)
   * @param {Object} obj - Object containing the method
   * @param {string} methodName - Name of the method to wrap
   * @param {Object} options - Retry options
   * @returns {Function} Wrapped method with retry logic
   */
  wrapMethod(obj, methodName, options = {}) {
    const originalMethod = obj[methodName];
    if (typeof originalMethod !== 'function') {
      throw new Error(`Method ${methodName} is not a function`);
    }

    return async (...args) => {
      return this.execute(originalMethod, obj, args, options);
    };
  }

  /**
   * Get retry statistics for monitoring
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay,
      maxDelay: this.maxDelay,
      backoffFactor: this.backoffFactor,
      jitter: this.jitter,
      retryableErrors: this.retryableErrors.length,
      retryableStatusCodes: this.retryableStatusCodes.length
    };
  }
}

/**
 * Pre-configured retry handlers for common scenarios
 */
const RetryHandlers = {
  // Conservative retry for email sending
  email: new RetryHandler({
    maxRetries: 3,
    baseDelay: 2000,
    maxDelay: 30000,
    backoffFactor: 2
  }),

  // Aggressive retry for network requests
  network: new RetryHandler({
    maxRetries: 5,
    baseDelay: 500,
    maxDelay: 10000,
    backoffFactor: 1.5
  }),

  // Quick retry for database operations
  database: new RetryHandler({
    maxRetries: 2,
    baseDelay: 100,
    maxDelay: 1000,
    backoffFactor: 3
  }),

  // Custom retry for file operations
  file: new RetryHandler({
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 5000,
    backoffFactor: 2,
    retryableErrors: ['ENOENT', 'EACCES', 'EMFILE', 'ENFILE', 'EBUSY']
  })
};

module.exports = {
  RetryHandler,
  RetryHandlers
};