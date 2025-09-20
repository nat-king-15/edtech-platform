const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const { firestore } = require('../config/firebase');
const admin = require('firebase-admin');

class UtilityService {
  constructor() {
    this.db = firestore;
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:5000';
    this.jwtSecret = process.env.JWT_SECRET;
    this.configDir = path.join(__dirname, '../config');
    this.dataDir = path.join(__dirname, '../data');
  }

  /**
   * Make authenticated API requests
   * Similar to pw-extractor's API request functionality
   */
  async makeApiRequest(endpoint, options = {}) {
    try {
      const config = {
        method: options.method || 'GET',
        url: `${this.apiBaseUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EdTech-Platform/1.0',
          ...options.headers
        },
        timeout: options.timeout || 30000
      };

      // Add authentication token if provided
      if (options.token) {
        config.headers['Authorization'] = `Bearer ${options.token}`;
      }

      // Add request body for POST/PUT requests
      if (options.data && ['POST', 'PUT', 'PATCH'].includes(config.method.toUpperCase())) {
        config.data = options.data;
      }

      // Add query parameters
      if (options.params) {
        config.params = options.params;
      }

      const response = await axios(config);
      
      return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers
      };
    } catch (error) {
      console.error('API Request Error:', error.message);
      
      if (error.response) {
        return {
          success: false,
          error_message: error.response.data?.message || error.message,
          error_status: error.response.status,
          error_data: error.response.data
        };
      }
      
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Generate secure tokens
   * Similar to pw-extractor's token generation
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate JWT token with custom payload
   */
  generateJwtToken(payload, expiresIn = '24h') {
    try {
      const token = jwt.sign(payload, this.jwtSecret, { expiresIn });
      return {
        success: true,
        token: token,
        expiresIn: expiresIn
      };
    } catch (error) {
      console.error('JWT Generation Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Verify JWT token
   */
  verifyJwtToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      return {
        success: true,
        payload: decoded
      };
    } catch (error) {
      console.error('JWT Verification Error:', error);
      return {
        success: false,
        error_message: error.message,
        expired: error.name === 'TokenExpiredError'
      };
    }
  }

  /**
   * Hash password with salt
   */
  hashPassword(password, salt = null) {
    try {
      if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
      }
      
      const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
      
      return {
        success: true,
        hash: hash,
        salt: salt
      };
    } catch (error) {
      console.error('Password Hashing Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Verify password against hash
   */
  verifyPassword(password, hash, salt) {
    try {
      const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
      return {
        success: true,
        isValid: hash === verifyHash
      };
    } catch (error) {
      console.error('Password Verification Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Encrypt sensitive data
   */
  encryptData(data, key = null) {
    try {
      if (!key) {
        key = process.env.ENCRYPTION_KEY || this.generateSecureToken(32);
      }
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-cbc', key);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        success: true,
        encrypted: encrypted,
        iv: iv.toString('hex'),
        key: key
      };
    } catch (error) {
      console.error('Data Encryption Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Decrypt sensitive data
   */
  decryptData(encryptedData, key, iv = null) {
    try {
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return {
        success: true,
        data: JSON.parse(decrypted)
      };
    } catch (error) {
      console.error('Data Decryption Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Save configuration to file
   * Similar to pw-extractor's config management
   */
  async saveConfig(configName, configData) {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      
      const configPath = path.join(this.configDir, `${configName}.json`);
      await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');
      
      return {
        success: true,
        message: 'Configuration saved successfully',
        path: configPath
      };
    } catch (error) {
      console.error('Config Save Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Load configuration from file
   */
  async loadConfig(configName) {
    try {
      const configPath = path.join(this.configDir, `${configName}.json`);
      const configData = await fs.readFile(configPath, 'utf8');
      
      return {
        success: true,
        config: JSON.parse(configData)
      };
    } catch (error) {
      console.error('Config Load Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Save data to file with timestamp
   */
  async saveDataToFile(fileName, data, includeTimestamp = true) {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      
      const dataToSave = includeTimestamp ? {
        timestamp: admin.firestore.Timestamp.fromDate(new Date()),
        data: data
      } : data;
      
      const filePath = path.join(this.dataDir, fileName);
      await fs.writeFile(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
      
      return {
        success: true,
        message: 'Data saved successfully',
        path: filePath
      };
    } catch (error) {
      console.error('Data Save Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Load data from file
   */
  async loadDataFromFile(fileName) {
    try {
      const filePath = path.join(this.dataDir, fileName);
      const fileData = await fs.readFile(filePath, 'utf8');
      
      return {
        success: true,
        data: JSON.parse(fileData)
      };
    } catch (error) {
      console.error('Data Load Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Format date and time
   */
  formatDateTime(date, format = 'full') {
    try {
      const dateObj = new Date(date);
      
      switch (format) {
        case 'date':
          return dateObj.toLocaleDateString('en-IN');
        case 'time':
          return dateObj.toLocaleTimeString('en-IN');
        case 'datetime':
          return dateObj.toLocaleString('en-IN');
        case 'iso':
          return dateObj.toISOString();
        case 'timestamp':
          return dateObj.getTime();
        default:
          return dateObj.toLocaleString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
      }
    } catch (error) {
      console.error('Date Format Error:', error);
      return date;
    }
  }

  /**
   * Calculate time difference
   */
  calculateTimeDifference(startDate, endDate = null) {
    try {
      const end = endDate ? new Date(endDate) : new Date();
      const start = new Date(startDate);
      const diffMs = end - start;
      
      const diffSeconds = Math.floor(diffMs / 1000);
      const diffMinutes = Math.floor(diffSeconds / 60);
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      return {
        success: true,
        difference: {
          milliseconds: diffMs,
          seconds: diffSeconds,
          minutes: diffMinutes,
          hours: diffHours,
          days: diffDays,
          formatted: this.formatDuration(diffMs)
        }
      };
    } catch (error) {
      console.error('Time Difference Calculation Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }

  /**
   * Format duration in human readable format
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  }

  /**
   * Generate OTP
   */
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    
    return otp;
  }

  /**
   * Validate email format
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return {
      isValid: emailRegex.test(email),
      email: email.toLowerCase().trim()
    };
  }

  /**
   * Validate phone number format (Indian)
   */
  validatePhoneNumber(phone) {
    const phoneRegex = /^[6-9]\d{9}$/;
    const cleanPhone = phone.replace(/\D/g, '');
    
    return {
      isValid: phoneRegex.test(cleanPhone),
      phone: cleanPhone,
      formatted: cleanPhone.length === 10 ? `+91${cleanPhone}` : cleanPhone
    };
  }

  /**
   * Sanitize string input
   */
  sanitizeString(input, maxLength = 1000) {
    if (typeof input !== 'string') {
      return '';
    }
    
    return input
      .trim()
      .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .substring(0, maxLength);
  }

  /**
   * Generate unique filename
   */
  generateUniqueFileName(originalName, prefix = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    
    return `${prefix}${baseName}_${timestamp}_${random}${extension}`;
  }

  /**
   * Check file type
   */
  checkFileType(filename, allowedTypes = []) {
    const extension = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.mp4': 'video/mp4',
      '.avi': 'video/avi',
      '.mov': 'video/quicktime'
    };
    
    const isAllowed = allowedTypes.length === 0 || allowedTypes.includes(extension);
    
    return {
      extension: extension,
      mimeType: mimeTypes[extension] || 'application/octet-stream',
      isAllowed: isAllowed
    };
  }

  /**
   * Convert bytes to human readable format
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Rate limiting utility
   */
  async checkRateLimit(userId, action, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    try {
      const key = `rate_limit_${userId}_${action}`;
      const now = Date.now();
      
      // Get existing rate limit data from Firestore
      const rateLimitDoc = await this.db.collection('rate_limits').doc(key).get();
      
      if (!rateLimitDoc.exists) {
        // First attempt
        await this.db.collection('rate_limits').doc(key).set({
          attempts: 1,
          firstAttempt: now,
          lastAttempt: now
        });
        
        return {
          allowed: true,
          remaining: maxAttempts - 1,
          resetTime: now + windowMs
        };
      }
      
      const data = rateLimitDoc.data();
      const timeSinceFirst = now - data.firstAttempt;
      
      if (timeSinceFirst > windowMs) {
        // Reset window
        await this.db.collection('rate_limits').doc(key).set({
          attempts: 1,
          firstAttempt: now,
          lastAttempt: now
        });
        
        return {
          allowed: true,
          remaining: maxAttempts - 1,
          resetTime: now + windowMs
        };
      }
      
      if (data.attempts >= maxAttempts) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: data.firstAttempt + windowMs,
          retryAfter: (data.firstAttempt + windowMs) - now
        };
      }
      
      // Increment attempts
      await this.db.collection('rate_limits').doc(key).update({
        attempts: data.attempts + 1,
        lastAttempt: now
      });
      
      return {
        allowed: true,
        remaining: maxAttempts - (data.attempts + 1),
        resetTime: data.firstAttempt + windowMs
      };
    } catch (error) {
      console.error('Rate Limit Check Error:', error);
      // Allow request if rate limiting fails
      return {
        allowed: true,
        remaining: maxAttempts - 1,
        resetTime: Date.now() + windowMs
      };
    }
  }

  /**
   * Clean up expired rate limit records
   */
  async cleanupRateLimits() {
    try {
      const now = Date.now();
      const windowMs = 15 * 60 * 1000; // 15 minutes
      const cutoffTime = now - windowMs;
      
      const expiredSnapshot = await this.db.collection('rate_limits')
        .where('firstAttempt', '<', cutoffTime)
        .get();
      
      const batch = this.db.batch();
      expiredSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      console.log(`Cleaned up ${expiredSnapshot.size} expired rate limit records`);
      
      return {
        success: true,
        deletedCount: expiredSnapshot.size
      };
    } catch (error) {
      console.error('Rate Limit Cleanup Error:', error);
      return {
        success: false,
        error_message: error.message
      };
    }
  }
}

module.exports = new UtilityService();