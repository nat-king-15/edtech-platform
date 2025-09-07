const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { firestore } = require('../config/firebase');
const notificationService = require('./notificationService');

class TokenService {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.OTP_EXPIRY_MINUTES = 10;
    this.TOKEN_EXPIRY_DAYS = 7;
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  /**
   * Generate OTP for phone number authentication
   * Similar to pw-extractor's send_otp function
   */
  async generateOTP(phone, countryCode = '+91') {
    try {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);
      const randomId = crypto.randomUUID();
      
      // Store OTP in Firestore
      await firestore.collection('otps').doc(randomId).set({
        phone: phone,
        countryCode: countryCode,
        otp: otp,
        expiresAt: expiresAt,
        verified: false,
        attempts: 0,
        createdAt: new Date()
      });

      // Send OTP via notification service (SMS/Email)
      await notificationService.sendOTP(phone, otp, countryCode);

      return {
        success: true,
        randomId: randomId,
        message: 'OTP sent successfully',
        expiresIn: this.OTP_EXPIRY_MINUTES * 60 * 1000
      };
    } catch (error) {
      console.error('Error generating OTP:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Verify OTP and generate access token
   * Similar to pw-extractor's get_token function
   */
  async verifyOTPAndGenerateToken(randomId, otp, userDetails = {}) {
    try {
      const otpDoc = await firestore.collection('otps').doc(randomId).get();
      
      if (!otpDoc.exists) {
        return {
          success: false,
          error_message: 'Invalid OTP request',
          error_status: 400
        };
      }

      const otpData = otpDoc.data();
      
      // Check if OTP is expired
      if (new Date() > otpData.expiresAt.toDate()) {
        return {
          success: false,
          error_message: 'OTP has expired',
          error_status: 400
        };
      }

      // Check if OTP is already verified
      if (otpData.verified) {
        return {
          success: false,
          error_message: 'OTP already used',
          error_status: 400
        };
      }

      // Check attempts limit
      if (otpData.attempts >= 3) {
        return {
          success: false,
          error_message: 'Too many attempts. Please request new OTP',
          error_status: 429
        };
      }

      // Verify OTP
      if (otpData.otp !== otp) {
        // Increment attempts
        await firestore.collection('otps').doc(randomId).update({
          attempts: otpData.attempts + 1
        });
        
        return {
          success: false,
          error_message: 'Invalid OTP',
          error_status: 400
        };
      }

      // Mark OTP as verified
      await firestore.collection('otps').doc(randomId).update({
        verified: true,
        verifiedAt: new Date()
      });

      // Generate access token
      const tokenPayload = {
        phone: otpData.phone,
        countryCode: otpData.countryCode,
        randomId: randomId,
        ...userDetails
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const expiresIn = this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

      return {
        success: true,
        access_token: accessToken,
        expires_in: Date.now() + expiresIn,
        token_type: 'Bearer'
      };
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(payload) {
    return jwt.sign(
      payload,
      this.JWT_SECRET,
      { expiresIn: `${this.TOKEN_EXPIRY_DAYS}d` }
    );
  }

  /**
   * Verify access token
   * Similar to pw-extractor's verify_token function
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      
      return {
        success: true,
        data: {
          isVerified: true,
          payload: decoded
        }
      };
    } catch (error) {
      let errorMessage = 'Token verification failed';
      let errorStatus = 401;

      if (error.name === 'TokenExpiredError') {
        errorMessage = 'Token has expired';
      } else if (error.name === 'JsonWebTokenError') {
        errorMessage = 'Invalid token';
      } else if (error.name === 'NotBeforeError') {
        errorMessage = 'Token not active yet';
      }

      return {
        success: false,
        error_message: errorMessage,
        error_status: errorStatus
      };
    }
  }

  /**
   * Get token expiry information
   * Similar to pw-extractor's get_token_expiry_info function
   */
  getTokenExpiryInfo(expiresIn) {
    const currentTimeMs = Date.now();
    const msRemaining = expiresIn - currentTimeMs;
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const isExpired = msRemaining <= 0;
    
    return {
      is_expired: isExpired,
      days_remaining: isExpired ? 0 : daysRemaining,
      ms_remaining: isExpired ? 0 : msRemaining
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(oldToken) {
    try {
      const verification = await this.verifyToken(oldToken);
      
      if (!verification.success) {
        return verification;
      }

      const payload = verification.data.payload;
      delete payload.iat;
      delete payload.exp;
      
      const newToken = this.generateAccessToken(payload);
      const expiresIn = Date.now() + (this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      return {
        success: true,
        access_token: newToken,
        expires_in: expiresIn,
        token_type: 'Bearer'
      };
    } catch (error) {
      return {
        success: false,
        error_message: error.message,
        error_status: 500
      };
    }
  }

  /**
   * Generate auth headers for API requests
   * Similar to pw-extractor's get_auth_headers function
   */
  getAuthHeaders(token, randomId = null) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    if (randomId) {
      headers['X-Random-ID'] = randomId;
    }

    return headers;
  }

  /**
   * Clean up expired OTPs (should be called periodically)
   */
  async cleanupExpiredOTPs() {
    try {
      const expiredOTPs = await firestore.collection('otps')
        .where('expiresAt', '<', new Date())
        .get();

      const batch = firestore.batch();
      expiredOTPs.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Cleaned up ${expiredOTPs.size} expired OTPs`);
    } catch (error) {
      console.error('Error cleaning up expired OTPs:', error);
    }
  }
}

module.exports = new TokenService();