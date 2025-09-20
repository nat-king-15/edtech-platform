/**
 * Enhanced Email Service with Template Engine, Structured Logging, Retry Logic, and Metrics
 * Refactored to use centralized templates, exponential backoff, and comprehensive monitoring
 */
const nodemailer = require('nodemailer');
const templateEngine = require('./templateEngine');
const { EmailLogger } = require('./logger');
const { RetryHandlers } = require('./retryHandler');
const { emailMetrics } = require('./emailMetrics');

class EmailService {
  constructor() {
    this.transporter = null;
    this.templateEngine = templateEngine;
    this.logger = new EmailLogger('email-service');
    this.retryHandler = RetryHandlers.email;
    this.metrics = emailMetrics;
    this.isInitialized = false;
    this.config = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      pool: true,
      maxConnections: parseInt(process.env.SMTP_MAX_CONNECTIONS) || 5,
      maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES) || 100,
      rateDelta: parseInt(process.env.SMTP_RATE_DELTA) || 1000,
      rateLimit: parseInt(process.env.SMTP_RATE_LIMIT) || 5
    };

    this.initialize();
  }

  /**
   * Initialize the email service
   */
  async initialize() {
    try {
      this.logger.logConfig('initialization_start', this.config);
      
      // Initialize template engine
      await this.templateEngine.preloadTemplates();
      this.logger.logConfig('templates_loaded', { 
        templates: this.templateEngine.getAvailableTemplates() 
      });

      // Initialize SMTP transporter
      await this.initializeTransporter();
      
      // Test connection
      await this.testConnection();
      
      this.isInitialized = true;
      this.logger.logConfig('initialization_complete', { status: 'ready' });
      
    } catch (error) {
      this.logger.logEmailError('initialization', error);
      this.metrics.recordEmailError(error, 'initialization');
      throw error;
    }
  }

  /**
   * Initialize SMTP transporter with retry logic
   */
  async initializeTransporter() {
    const initTransporter = async () => {
      this.transporter = nodemailer.createTransport(this.config);
      
      // Set up event listeners
      this.transporter.on('idle', () => {
        this.logger.logConnection('idle');
        this.metrics.recordSmtpConnection('idle');
      });

      this.transporter.on('error', (error) => {
        this.logger.logEmailError('smtp_connection', error);
        this.metrics.recordSmtpConnection('error');
      });

      return this.transporter;
    };

    return await this.retryHandler.execute(
      initTransporter,
      this,
      [],
      {
        onRetry: (info) => {
          this.logger.logRetryAttempt('transporter_init', info.attempt, info.error);
          this.metrics.recordEmailRetry(info.attempt, 'transporter_init');
        },
        onError: (info) => {
          this.logger.logEmailError('transporter_init_final', info.error);
        }
      }
    );
  }

  /**
   * Test SMTP connection
   */
  async testConnection() {
    if (!this.transporter) {
      throw new Error('Transporter not initialized');
    }

    const testConnectionFn = async () => {
      const result = await this.transporter.verify();
      this.logger.logConnection('test_success', { verified: result });
      this.metrics.recordSmtpConnection('success');
      return result;
    };

    return await this.retryHandler.execute(
      testConnectionFn,
      this,
      [],
      {
        onRetry: (info) => {
          this.logger.logRetryAttempt('connection_test', info.attempt, info.error);
          this.metrics.recordEmailRetry(info.attempt, 'connection_test');
        }
      }
    );
  }

  /**
   * Send teacher assignment email using template
   */
  async sendTeacherAssignmentEmail(teacherEmail, assignmentData) {
    const startTime = Date.now();
    const operation = 'send_teacher_assignment';
    const template = 'teacher-assignment';

    try {
      this.logger.logEmailAttempt(operation, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(teacherEmail) : teacherEmail,
        template,
        assignmentId: assignmentData.assignmentId
      });

      // Render email template
      const templateData = {
        platformName: process.env.PLATFORM_NAME || 'EdTech Platform',
        teacherName: assignmentData.teacherName,
        assignmentTitle: assignmentData.title,
        courseName: assignmentData.courseName,
        batchName: assignmentData.batchName,
        dueDate: assignmentData.dueDate,
        priority: assignmentData.priority || 'medium',
        estimatedHours: assignmentData.estimatedHours,
        description: assignmentData.description,
        requirements: assignmentData.requirements || [],
        baseUrl: process.env.BASE_URL || 'http://localhost:3000',
        assignmentId: assignmentData.assignmentId,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        currentYear: new Date().getFullYear()
      };

      const { html, text } = await this.renderTemplate(template, templateData);

      // Prepare email options
      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'EdTech Platform'}" <${process.env.FROM_EMAIL || this.config.auth.user}>`,
        to: teacherEmail,
        subject: `New Assignment: ${assignmentData.title}`,
        html,
        text,
        headers: {
          'X-Priority': assignmentData.priority === 'high' ? '1' : '3',
          'X-Assignment-ID': assignmentData.assignmentId
        }
      };

      // Send email with retry logic
      const result = await this.sendEmailWithRetry(mailOptions, operation, template);
      
      const duration = Date.now() - startTime;
      this.logger.logEmailSuccess(operation, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(teacherEmail) : teacherEmail,
        template,
        duration,
        messageId: result.messageId
      });
      
      this.metrics.recordEmailSuccess('teacher_assignment', template, 'smtp', duration);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.logEmailError(operation, error, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(teacherEmail) : teacherEmail,
        template,
        duration
      });
      
      this.metrics.recordEmailFailure('teacher_assignment', template, 'smtp', duration, error);
      throw error;
    }
  }

  /**
   * Send general notification email
   */
  async sendNotificationEmail(recipientEmail, notificationData) {
    const startTime = Date.now();
    const operation = 'send_notification';
    const template = 'general-notification';

    try {
      this.logger.logEmailAttempt(operation, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(recipientEmail) : recipientEmail,
        template,
        type: notificationData.type
      });

      const templateData = {
        platformName: process.env.PLATFORM_NAME || 'EdTech Platform',
        subject: notificationData.subject,
        type: notificationData.type,
        recipientName: notificationData.recipientName,
        message: notificationData.message,
        details: notificationData.details || [],
        content: notificationData.content,
        actionUrl: notificationData.actionUrl,
        additionalInfo: notificationData.additionalInfo,
        unsubscribeUrl: notificationData.unsubscribeUrl,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        currentYear: new Date().getFullYear()
      };

      const { html, text } = await this.renderTemplate(template, templateData);

      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'EdTech Platform'}" <${process.env.FROM_EMAIL || this.config.auth.user}>`,
        to: recipientEmail,
        subject: notificationData.subject,
        html,
        text,
        headers: {
          'X-Notification-Type': notificationData.type
        }
      };

      const result = await this.sendEmailWithRetry(mailOptions, operation, template);
      
      const duration = Date.now() - startTime;
      this.logger.logEmailSuccess(operation, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(recipientEmail) : recipientEmail,
        template,
        duration,
        messageId: result.messageId
      });
      
      this.metrics.recordEmailSuccess('notification', template, 'smtp', duration);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.logEmailError(operation, error, {
        recipient: this.logger.constructor.sanitizeEmail ? 
          this.logger.constructor.sanitizeEmail(recipientEmail) : recipientEmail,
        template,
        duration
      });
      
      this.metrics.recordEmailFailure('notification', template, 'smtp', duration, error);
      throw error;
    }
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(userEmail, userData) {
    const startTime = Date.now();
    const operation = 'send_welcome';
    const template = 'welcome';

    try {
      const templateData = {
        platformName: process.env.PLATFORM_NAME || 'EdTech Platform',
        userName: userData.name,
        userEmail: userEmail,
        userRole: userData.role,
        welcomeMessage: userData.welcomeMessage,
        onboardingSteps: userData.onboardingSteps || [],
        features: userData.features || [],
        baseUrl: process.env.BASE_URL || 'http://localhost:3000',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        currentYear: new Date().getFullYear()
      };

      const { html, text } = await this.renderTemplate(template, templateData);

      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'EdTech Platform'}" <${process.env.FROM_EMAIL || this.config.auth.user}>`,
        to: userEmail,
        subject: `Welcome to ${process.env.PLATFORM_NAME || 'EdTech Platform'}!`,
        html,
        text
      };

      const result = await this.sendEmailWithRetry(mailOptions, operation, template);
      
      const duration = Date.now() - startTime;
      this.metrics.recordEmailSuccess('welcome', template, 'smtp', duration);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordEmailFailure('welcome', template, 'smtp', duration, error);
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(userEmail, resetData) {
    const startTime = Date.now();
    const operation = 'send_password_reset';
    const template = 'password-reset';

    try {
      const templateData = {
        platformName: process.env.PLATFORM_NAME || 'EdTech Platform',
        userName: resetData.userName,
        resetToken: resetData.resetToken,
        resetUrl: resetData.resetUrl,
        expiryTime: resetData.expiryTime,
        requestInfo: resetData.requestInfo,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        currentYear: new Date().getFullYear()
      };

      const { html, text } = await this.renderTemplate(template, templateData);

      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'EdTech Platform'}" <${process.env.FROM_EMAIL || this.config.auth.user}>`,
        to: userEmail,
        subject: 'Password Reset Request',
        html,
        text,
        headers: {
          'X-Priority': '1' // High priority for security emails
        }
      };

      const result = await this.sendEmailWithRetry(mailOptions, operation, template);
      
      const duration = Date.now() - startTime;
      this.metrics.recordEmailSuccess('password_reset', template, 'smtp', duration);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordEmailFailure('password_reset', template, 'smtp', duration, error);
      throw error;
    }
  }

  /**
   * Send course enrollment confirmation email
   */
  async sendCourseEnrollmentEmail(studentEmail, enrollmentData) {
    const startTime = Date.now();
    const operation = 'send_course_enrollment';
    const template = 'course-enrollment';

    try {
      const templateData = {
        platformName: process.env.PLATFORM_NAME || 'EdTech Platform',
        studentName: enrollmentData.studentName,
        studentEmail: studentEmail,
        courseName: enrollmentData.courseName,
        courseDescription: enrollmentData.courseDescription,
        instructor: enrollmentData.instructor,
        duration: enrollmentData.duration,
        startDate: enrollmentData.startDate,
        level: enrollmentData.level,
        totalLessons: enrollmentData.totalLessons,
        language: enrollmentData.language,
        instructorInfo: enrollmentData.instructorInfo,
        paymentInfo: enrollmentData.paymentInfo,
        baseUrl: process.env.BASE_URL || 'http://localhost:3000',
        courseId: enrollmentData.courseId,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        currentYear: new Date().getFullYear()
      };

      const { html, text } = await this.renderTemplate(template, templateData);

      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'EdTech Platform'}" <${process.env.FROM_EMAIL || this.config.auth.user}>`,
        to: studentEmail,
        subject: `Course Enrollment Confirmed: ${enrollmentData.courseName}`,
        html,
        text,
        headers: {
          'X-Course-ID': enrollmentData.courseId
        }
      };

      const result = await this.sendEmailWithRetry(mailOptions, operation, template);
      
      const duration = Date.now() - startTime;
      this.metrics.recordEmailSuccess('course_enrollment', template, 'smtp', duration);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordEmailFailure('course_enrollment', template, 'smtp', duration, error);
      throw error;
    }
  }

  /**
   * Render email template
   */
  async renderTemplate(templateName, data) {
    const renderStart = Date.now();
    
    try {
      const html = await this.templateEngine.renderTemplate(templateName, data);
      const text = this.htmlToText(html);
      
      const duration = Date.now() - renderStart;
      this.logger.logTemplateRender(templateName, { duration });
      this.metrics.recordTemplateRender(templateName, 'success', duration);
      
      return { html, text };
      
    } catch (error) {
      const duration = Date.now() - renderStart;
      this.logger.logTemplateError(templateName, error, { duration });
      this.metrics.recordTemplateRender(templateName, 'failure', duration);
      throw error;
    }
  }

  /**
   * Send email with retry logic
   */
  async sendEmailWithRetry(mailOptions, operation, template) {
    const sendEmailFn = async () => {
      if (!this.transporter) {
        throw new Error('Email transporter not initialized');
      }
      return await this.transporter.sendMail(mailOptions);
    };

    return await this.retryHandler.execute(
      sendEmailFn,
      this,
      [],
      {
        onRetry: (info) => {
          this.logger.logRetryAttempt(operation, info.attempt, info.error, {
            template,
            recipient: mailOptions.to
          });
          this.metrics.recordEmailRetry(info.attempt, this.metrics.categorizeError(info.error), template);
        },
        onError: (info) => {
          this.logger.logEmailError(`${operation}_final`, info.error, {
            template,
            recipient: mailOptions.to,
            totalAttempts: info.totalAttempts
          });
        }
      }
    );
  }

  /**
   * Send bulk emails with batch processing
   */
  async sendBulkEmails(emailList, batchSize = 10) {
    const startTime = Date.now();
    const operation = 'send_bulk_emails';
    
    try {
      this.logger.logBulkOperation(operation, {
        total: emailList.length,
        batchSize
      });

      const results = {
        total: emailList.length,
        successful: 0,
        failed: 0,
        errors: []
      };

      // Process emails in batches
      for (let i = 0; i < emailList.length; i += batchSize) {
        const batch = emailList.slice(i, i + batchSize);
        this.metrics.updateQueueSize(emailList.length - i);

        const batchPromises = batch.map(async (emailData) => {
          try {
            let result;
            switch (emailData.type) {
              case 'teacher_assignment':
                result = await this.sendTeacherAssignmentEmail(emailData.to, emailData.data);
                break;
              case 'notification':
                result = await this.sendNotificationEmail(emailData.to, emailData.data);
                break;
              case 'welcome':
                result = await this.sendWelcomeEmail(emailData.to, emailData.data);
                break;
              case 'password_reset':
                result = await this.sendPasswordResetEmail(emailData.to, emailData.data);
                break;
              case 'course_enrollment':
                result = await this.sendCourseEnrollmentEmail(emailData.to, emailData.data);
                break;
              default:
                throw new Error(`Unknown email type: ${emailData.type}`);
            }
            results.successful++;
            return { success: true, result };
          } catch (error) {
            results.failed++;
            results.errors.push({
              email: emailData.to,
              type: emailData.type,
              error: error.message
            });
            return { success: false, error };
          }
        });

        await Promise.allSettled(batchPromises);

        // Add delay between batches to prevent overwhelming the SMTP server
        if (i + batchSize < emailList.length) {
          await this.delay(1000); // 1 second delay
        }
      }

      this.metrics.updateQueueSize(0);
      
      const duration = Date.now() - startTime;
      this.logger.logBulkOperation(operation, results, { duration });
      this.metrics.recordBulkOperation('completed', emailList.length, duration);

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.logEmailError(operation, error, { duration });
      this.metrics.recordBulkOperation('failed', emailList.length, duration);
      throw error;
    }
  }

  /**
   * Convert HTML to plain text
   */
  htmlToText(html) {
    if (!html) return '';
    
    return html
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Delay function for batch processing
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get service status
   */
  async getStatus() {
    try {
      const isConnected = this.transporter ? await this.transporter.verify() : false;
      const templateStats = this.templateEngine.getStats();
      const loggerStats = this.logger.getStats();
      const retryStats = this.retryHandler.getStats();
      const metricsStats = await this.metrics.getSummaryStats();

      return {
        initialized: this.isInitialized,
        connected: isConnected,
        templates: templateStats,
        logger: loggerStats,
        retry: retryStats,
        metrics: metricsStats,
        config: {
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          pool: this.config.pool,
          maxConnections: this.config.maxConnections
        }
      };
    } catch (error) {
      this.logger.logEmailError('status_check', error);
      return {
        initialized: this.isInitialized,
        connected: false,
        error: error.message
      };
    }
  }

  /**
   * Get metrics endpoint for Prometheus
   */
  async getMetrics() {
    return await this.metrics.getMetrics();
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      this.logger.logConfig('shutdown_start');
      
      if (this.transporter) {
        this.transporter.close();
        this.logger.logConnection('closed');
      }
      
      this.templateEngine.clearCache();
      this.logger.logConfig('shutdown_complete');
      
    } catch (error) {
      this.logger.logEmailError('shutdown', error);
      throw error;
    }
  }
}

// Create singleton instance
const emailService = new EmailService();

module.exports = {
  EmailService,
  emailService
};