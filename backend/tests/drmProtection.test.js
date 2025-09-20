const { generateVideoToken, verifyVideoToken, generateDeviceFingerprint } = require('../middleware/drmProtection');
const jwt = require('jsonwebtoken');

// Mock Firebase
jest.mock('../config/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn(() => Promise.resolve({ empty: false, docs: [{ data: () => ({ status: 'active' }) }] }))
          })),
          get: jest.fn(() => Promise.resolve({ empty: false, docs: [{ data: () => ({ status: 'active' }) }] }))
        })),
        get: jest.fn(() => Promise.resolve({ empty: false, docs: [{ data: () => ({ status: 'active' }) }] }))
      })),
      add: jest.fn(() => Promise.resolve({ id: 'mock-session-id' })),
      doc: jest.fn(() => ({
        update: jest.fn(() => Promise.resolve())
      }))
    }))
  }
}));

// Mock audit logger
jest.mock('../middleware/auditLogger', () => ({
  logAuditEvent: jest.fn(() => Promise.resolve()),
  AUDIT_EVENTS: {
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
    SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY'
  },
  RISK_LEVELS: {
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    MEDIUM: 'MEDIUM'
  }
}));

describe('DRM Protection - Unified Fingerprinting', () => {
  let mockReq;
  
  beforeEach(() => {
    mockReq = {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept-language': 'en-US,en;q=0.9'
      },
      ip: '192.168.1.100'
    };
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('generateDeviceFingerprint', () => {
    test('should generate consistent fingerprint with same inputs and issuedHour', () => {
      const issuedHour = 12345;
      const fingerprint1 = generateDeviceFingerprint(mockReq, issuedHour);
      const fingerprint2 = generateDeviceFingerprint(mockReq, issuedHour);
      
      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toHaveLength(64); // SHA256 hex length
    });

    test('should generate different fingerprints for different devices', () => {
      const issuedHour = 12345;
      const mockReq2 = {
        ...mockReq,
        headers: {
          ...mockReq.headers,
          'user-agent': 'Different User Agent'
        }
      };
      
      const fingerprint1 = generateDeviceFingerprint(mockReq, issuedHour);
      const fingerprint2 = generateDeviceFingerprint(mockReq2, issuedHour);
      
      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test('should generate different fingerprints for different IPs', () => {
      const issuedHour = 12345;
      const mockReq2 = {
        ...mockReq,
        ip: '192.168.1.101'
      };
      
      const fingerprint1 = generateDeviceFingerprint(mockReq, issuedHour);
      const fingerprint2 = generateDeviceFingerprint(mockReq2, issuedHour);
      
      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test('should use current hour when issuedHour is not provided', () => {
      const fingerprint1 = generateDeviceFingerprint(mockReq);
      const fingerprint2 = generateDeviceFingerprint(mockReq);
      
      // Should be same within the same hour
      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('generateVideoToken', () => {
    test('should generate token with deviceFingerprint and issuedHour', async () => {
      const userId = 'user123';
      const videoId = 'video456';
      const batchId = 'batch789';
      
      const result = await generateVideoToken(mockReq, userId, videoId, batchId);
      
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('expiresIn');
      
      // Decode token to verify payload
      const decoded = jwt.decode(result.token);
      expect(decoded).toHaveProperty('deviceFingerprint');
      expect(decoded).toHaveProperty('issuedHour');
      expect(decoded.userId).toBe(userId);
      expect(decoded.videoId).toBe(videoId);
      expect(decoded.batchId).toBe(batchId);
    });

    test('should store deviceFingerprint and issuedHour in session', async () => {
      const userId = 'user123';
      const videoId = 'video456';
      const batchId = 'batch789';
      
      const { db } = require('../config/firebase');
      const mockAdd = jest.fn(() => Promise.resolve({ id: 'session-id' }));
      const mockWhere = jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn(() => Promise.resolve({ empty: false, docs: [{ data: () => ({ status: 'active' }) }] }))
          }))
        }))
      }));
      
      db.collection.mockReturnValue({
        where: mockWhere,
        add: mockAdd
      });
      
      await generateVideoToken(mockReq, userId, videoId, batchId);
      
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceFingerprint: expect.any(String),
          issuedHour: expect.any(Number)
        })
      );
    });
  });

  describe('verifyVideoToken middleware', () => {
    let validToken;
    let tokenPayload;
    let mockRes;
    let mockNext;
    
    beforeEach(async () => {
      // Generate a valid token for testing
      const result = await generateVideoToken(mockReq, 'user123', 'video456', 'batch789');
      validToken = result.token;
      tokenPayload = jwt.decode(validToken);
      
      // Mock response object
      mockRes = {
        status: jest.fn(() => mockRes),
        json: jest.fn(() => mockRes)
      };
      
      // Mock next function
      mockNext = jest.fn();
    });

    test('should verify token successfully with same device fingerprint', async () => {
      // Mock session query
      const { db } = require('../config/firebase');
      const mockUpdate = jest.fn(() => Promise.resolve());
      db.collection.mockReturnValue({
        where: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({
            empty: false,
            docs: [{
              data: () => ({
                deviceFingerprint: tokenPayload.deviceFingerprint,
                issuedHour: tokenPayload.issuedHour
              }),
              id: 'session-doc-id'
            }]
          }))
        })),
        doc: jest.fn(() => ({
          update: mockUpdate
        }))
      });
      
      // Set token in request headers
      mockReq.headers['x-video-token'] = validToken;
      
      await verifyVideoToken(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.videoAccess).toBeDefined();
      expect(mockReq.videoAccess.userId).toBe('user123');
      expect(mockUpdate).toHaveBeenCalledWith({ lastAccessAt: expect.any(Date) });
    });

    test('should reject token with different device fingerprint', async () => {
      // Mock session query
      const { db } = require('../config/firebase');
      const mockUpdate = jest.fn(() => Promise.resolve());
      db.collection.mockReturnValue({
        where: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({
            empty: false,
            docs: [{
              data: () => ({
                deviceFingerprint: tokenPayload.deviceFingerprint,
                issuedHour: tokenPayload.issuedHour
              }),
              id: 'session-doc-id'
            }]
          }))
        })),
        doc: jest.fn(() => ({
          update: mockUpdate
        }))
      });
      
      // Change device fingerprint by modifying request
      const differentReq = {
        ...mockReq,
        ip: '192.168.1.200',
        headers: {
          ...mockReq.headers,
          'x-video-token': validToken
        }
      };
      
      await verifyVideoToken(differentReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'DEVICE_MISMATCH'
          })
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should reject token when session is inactive', async () => {
      // Mock inactive session
      const { db } = require('../config/firebase');
      db.collection.mockReturnValue({
        where: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ empty: true }))
        }))
      });
      
      mockReq.headers['x-video-token'] = validToken;
      
      await verifyVideoToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INVALID_VIDEO_SESSION'
          })
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should handle missing token', async () => {
      // Don't set token in request
      await verifyVideoToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'MISSING_VIDEO_TOKEN'
          })
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should handle malformed tokens', async () => {
      const malformedToken = 'invalid.token.here';
      mockReq.headers['x-video-token'] = malformedToken;
      
      await verifyVideoToken(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INVALID_VIDEO_TOKEN'
          })
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Token consistency across time', () => {
    test('should maintain same fingerprint during token lifetime', async () => {
      const userId = 'user123';
      const videoId = 'video456';
      const batchId = 'batch789';
      
      // Generate token
      const result = await generateVideoToken(mockReq, userId, videoId, batchId);
      const decoded = jwt.decode(result.token);
      
      // Generate fingerprint with same issuedHour
      const fingerprint1 = generateDeviceFingerprint(mockReq, decoded.issuedHour);
      const fingerprint2 = generateDeviceFingerprint(mockReq, decoded.issuedHour);
      
      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toBe(decoded.deviceFingerprint);
    });

    test('should reject tokens from different devices even with same issuedHour', async () => {
      const userId = 'user123';
      const videoId = 'video456';
      const batchId = 'batch789';
      
      // Generate token with first device
      const result = await generateVideoToken(mockReq, userId, videoId, batchId);
      const decoded = jwt.decode(result.token);
      
      // Try to verify with different device
      const differentReq = {
        ...mockReq,
        headers: {
          ...mockReq.headers,
          'user-agent': 'Different Browser'
        }
      };
      
      const differentFingerprint = generateDeviceFingerprint(differentReq, decoded.issuedHour);
      expect(differentFingerprint).not.toBe(decoded.deviceFingerprint);
    });
  });
});