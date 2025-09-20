/**
 * Email Metrics Service using Prometheus
 * Provides comprehensive monitoring for email delivery operations
 */
const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'edtech_email_',
});

/**
 * Email delivery counter
 * Tracks total number of email attempts by status and type
 */
const emailDeliveryCounter = new client.Counter({
  name: 'edtech_email_delivery_total',
  help: 'Total number of email delivery attempts',
  labelNames: ['status', 'type', 'template', 'provider'],
  registers: [register]
});

/**
 * Email delivery duration histogram
 * Tracks time taken to send emails
 */
const emailDeliveryDuration = new client.Histogram({
  name: 'edtech_email_delivery_duration_seconds',
  help: 'Duration of email delivery attempts in seconds',
  labelNames: ['status', 'type', 'template', 'provider'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60], // seconds
  registers: [register]
});

/**
 * Email retry counter
 * Tracks retry attempts for failed emails
 */
const emailRetryCounter = new client.Counter({
  name: 'edtech_email_retry_total',
  help: 'Total number of email retry attempts',
  labelNames: ['attempt', 'error_type', 'template'],
  registers: [register]
});

/**
 * Email queue size gauge
 * Tracks current size of email queue
 */
const emailQueueSize = new client.Gauge({
  name: 'edtech_email_queue_size',
  help: 'Current size of email queue',
  labelNames: ['priority'],
  registers: [register]
});

/**
 * Template rendering counter
 * Tracks template rendering success/failure
 */
const templateRenderCounter = new client.Counter({
  name: 'edtech_email_template_render_total',
  help: 'Total number of template rendering attempts',
  labelNames: ['template', 'status'],
  registers: [register]
});

/**
 * Template rendering duration
 * Tracks time taken to render templates
 */
const templateRenderDuration = new client.Histogram({
  name: 'edtech_email_template_render_duration_seconds',
  help: 'Duration of template rendering in seconds',
  labelNames: ['template'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1], // seconds
  registers: [register]
});

/**
 * SMTP connection counter
 * Tracks SMTP connection attempts
 */
const smtpConnectionCounter = new client.Counter({
  name: 'edtech_email_smtp_connection_total',
  help: 'Total number of SMTP connection attempts',
  labelNames: ['status', 'provider'],
  registers: [register]
});

/**
 * Bulk email operation metrics
 * Tracks bulk email operations
 */
const bulkEmailCounter = new client.Counter({
  name: 'edtech_email_bulk_operation_total',
  help: 'Total number of bulk email operations',
  labelNames: ['status'],
  registers: [register]
});

const bulkEmailDuration = new client.Histogram({
  name: 'edtech_email_bulk_operation_duration_seconds',
  help: 'Duration of bulk email operations in seconds',
  labelNames: ['batch_size_range'],
  buckets: [1, 5, 10, 30, 60, 300, 600], // seconds
  registers: [register]
});

/**
 * Email error counter by type
 * Tracks different types of email errors
 */
const emailErrorCounter = new client.Counter({
  name: 'edtech_email_error_total',
  help: 'Total number of email errors by type',
  labelNames: ['error_type', 'error_code', 'template'],
  registers: [register]
});

/**
 * Email Service Metrics Class
 * Provides methods to record various email-related metrics
 */
class EmailMetrics {
  constructor() {
    this.register = register;
  }

  /**
   * Record email delivery attempt
   */
  recordEmailDelivery(status, type, template = 'unknown', provider = 'smtp', duration = 0) {
    emailDeliveryCounter.inc({
      status,
      type,
      template,
      provider
    });

    if (duration > 0) {
      emailDeliveryDuration.observe({
        status,
        type,
        template,
        provider
      }, duration / 1000); // Convert to seconds
    }
  }

  /**
   * Record successful email delivery
   */
  recordEmailSuccess(type, template = 'unknown', provider = 'smtp', duration = 0) {
    this.recordEmailDelivery('success', type, template, provider, duration);
  }

  /**
   * Record failed email delivery
   */
  recordEmailFailure(type, template = 'unknown', provider = 'smtp', duration = 0, error = null) {
    this.recordEmailDelivery('failure', type, template, provider, duration);
    
    if (error) {
      this.recordEmailError(error, template);
    }
  }

  /**
   * Record email retry attempt
   */
  recordEmailRetry(attempt, errorType, template = 'unknown') {
    emailRetryCounter.inc({
      attempt: attempt.toString(),
      error_type: errorType,
      template
    });
  }

  /**
   * Record email error
   */
  recordEmailError(error, template = 'unknown') {
    const errorType = this.categorizeError(error);
    const errorCode = error.code || error.responseCode || 'unknown';
    
    emailErrorCounter.inc({
      error_type: errorType,
      error_code: errorCode.toString(),
      template
    });
  }

  /**
   * Update email queue size
   */
  updateQueueSize(size, priority = 'normal') {
    emailQueueSize.set({ priority }, size);
  }

  /**
   * Record template rendering
   */
  recordTemplateRender(template, status, duration = 0) {
    templateRenderCounter.inc({
      template,
      status
    });

    if (duration > 0) {
      templateRenderDuration.observe({
        template
      }, duration / 1000); // Convert to seconds
    }
  }

  /**
   * Record SMTP connection attempt
   */
  recordSmtpConnection(status, provider = 'smtp') {
    smtpConnectionCounter.inc({
      status,
      provider
    });
  }

  /**
   * Record bulk email operation
   */
  recordBulkOperation(status, batchSize = 0, duration = 0) {
    bulkEmailCounter.inc({ status });

    if (duration > 0) {
      const batchSizeRange = this.getBatchSizeRange(batchSize);
      bulkEmailDuration.observe({
        batch_size_range: batchSizeRange
      }, duration / 1000); // Convert to seconds
    }
  }

  /**
   * Get batch size range for metrics
   */
  getBatchSizeRange(size) {
    if (size <= 10) return '1-10';
    if (size <= 50) return '11-50';
    if (size <= 100) return '51-100';
    if (size <= 500) return '101-500';
    if (size <= 1000) return '501-1000';
    return '1000+';
  }

  /**
   * Categorize error types for metrics
   */
  categorizeError(error) {
    if (!error) return 'unknown';

    const message = error.message ? error.message.toLowerCase() : '';
    const code = error.code || '';

    // Network errors
    if (code.includes('ECONNRESET') || code.includes('ENOTFOUND') || 
        code.includes('ECONNREFUSED') || code.includes('ETIMEDOUT')) {
      return 'network';
    }

    // Authentication errors
    if (message.includes('authentication') || message.includes('login') || 
        message.includes('credential') || code.includes('535')) {
      return 'authentication';
    }

    // Rate limiting
    if (message.includes('rate limit') || message.includes('too many') || 
        code.includes('421') || code.includes('450')) {
      return 'rate_limit';
    }

    // Invalid recipient
    if (message.includes('recipient') || message.includes('address') || 
        code.includes('550') || code.includes('551')) {
      return 'invalid_recipient';
    }

    // Server errors
    if (message.includes('server') || code.includes('5')) {
      return 'server_error';
    }

    // Template errors
    if (message.includes('template') || message.includes('render')) {
      return 'template';
    }

    // Configuration errors
    if (message.includes('config') || message.includes('setting')) {
      return 'configuration';
    }

    return 'other';
  }

  /**
   * Create a timing function wrapper
   */
  timeFunction(fn, metricRecorder) {
    return async function(...args) {
      const startTime = Date.now();
      try {
        const result = await fn.apply(this, args);
        const duration = Date.now() - startTime;
        metricRecorder('success', duration);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        metricRecorder('failure', duration, error);
        throw error;
      }
    };
  }

  /**
   * Get metrics for Prometheus scraping
   */
  async getMetrics() {
    return await this.register.metrics();
  }

  /**
   * Get metrics in JSON format
   */
  async getMetricsJSON() {
    const metrics = await this.register.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics() {
    this.register.resetMetrics();
  }

  /**
   * Get current metric values
   */
  getCurrentValues() {
    return {
      emailDeliveryTotal: emailDeliveryCounter._hashMap,
      emailRetryTotal: emailRetryCounter._hashMap,
      templateRenderTotal: templateRenderCounter._hashMap,
      smtpConnectionTotal: smtpConnectionCounter._hashMap,
      bulkEmailTotal: bulkEmailCounter._hashMap,
      emailErrorTotal: emailErrorCounter._hashMap,
      queueSize: emailQueueSize.hashMap
    };
  }

  /**
   * Create summary statistics
   */
  async getSummaryStats() {
    const metrics = await this.getMetricsJSON();
    const summary = {
      totalEmails: 0,
      successfulEmails: 0,
      failedEmails: 0,
      totalRetries: 0,
      totalErrors: 0,
      averageDeliveryTime: 0,
      templateStats: {},
      errorStats: {}
    };

    metrics.forEach(metric => {
      switch (metric.name) {
        case 'edtech_email_delivery_total':
          metric.values.forEach(value => {
            summary.totalEmails += value.value;
            if (value.labels.status === 'success') {
              summary.successfulEmails += value.value;
            } else if (value.labels.status === 'failure') {
              summary.failedEmails += value.value;
            }
          });
          break;
        
        case 'edtech_email_retry_total':
          metric.values.forEach(value => {
            summary.totalRetries += value.value;
          });
          break;
        
        case 'edtech_email_error_total':
          metric.values.forEach(value => {
            summary.totalErrors += value.value;
            const errorType = value.labels.error_type;
            summary.errorStats[errorType] = (summary.errorStats[errorType] || 0) + value.value;
          });
          break;
        
        case 'edtech_email_template_render_total':
          metric.values.forEach(value => {
            const template = value.labels.template;
            if (!summary.templateStats[template]) {
              summary.templateStats[template] = { total: 0, success: 0, failure: 0 };
            }
            summary.templateStats[template].total += value.value;
            summary.templateStats[template][value.labels.status] += value.value;
          });
          break;
      }
    });

    // Calculate success rate
    summary.successRate = summary.totalEmails > 0 
      ? (summary.successfulEmails / summary.totalEmails * 100).toFixed(2) + '%'
      : '0%';

    return summary;
  }
}

// Create singleton instance
const emailMetrics = new EmailMetrics();

module.exports = {
  EmailMetrics,
  emailMetrics,
  register
};