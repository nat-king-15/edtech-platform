const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

// Mock firebase-admin before any imports
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn()
      }))
    }))
  })),
  auth: jest.fn(),
  storage: jest.fn(),
  database: jest.fn()
}));

// Mock the config/firebase module
jest.mock('../config/firebase', () => ({
  admin: {
    apps: [],
    initializeApp: jest.fn(),
    firestore: jest.fn(() => ({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn(),
          set: jest.fn()
        }))
      }))
    }))
  },
  firestore: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn()
      }))
    }))
  },
  FieldValue: {
    serverTimestamp: jest.fn()
  }
}));

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn()
}));

jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { uid: 'test-student-id' };
    next();
  },
  requireRole: () => (req, res, next) => next()
}));

// Mock Razorpay
const mockRazorpay = {
  payments: {
    fetch: jest.fn()
  }
};

jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => mockRazorpay);
});

describe('Payment Verification Route', () => {
  let app;
  let studentRoutes;

  beforeAll(() => {
    // Create express app
    app = express();
    app.use(express.json());
    
    // Import routes after mocks are set up
    studentRoutes = require('../routes/student');
    app.use('/api/student', studentRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/student/payment/verify', () => {
    const validPaymentData = {
      razorpay_order_id: 'order_test123',
      razorpay_payment_id: 'pay_test123',
      razorpay_signature: 'valid_signature',
      batchId: 'batch123'
    };

    it('should prevent order reference regression', async () => {
      // This test specifically catches the order.amount reference bug
      // by ensuring no undefined 'order' variable is used
      
      // Mock crypto signature verification
      jest.spyOn(crypto, 'createHmac').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('valid_signature')
      });

      // Mock Razorpay payment fetch
      mockRazorpay.payments.fetch.mockResolvedValue({
        id: 'pay_test123',
        amount: 50000, // 500 INR in paise
        currency: 'INR',
        status: 'captured'
      });

      const response = await request(app)
        .post('/api/student/payment/verify')
        .send(validPaymentData);

      // The test should not crash due to undefined 'order' variable
      // If the bug exists, this would throw "Cannot read properties of undefined"
      expect(response.status).not.toBe(500);
      
      // Verify that Razorpay payment fetch was called
      expect(mockRazorpay.payments.fetch).toHaveBeenCalledWith('pay_test123');
    }, 15000);

    it('should handle missing required fields', async () => {
      const incompleteData = {
        razorpay_order_id: 'order_test123'
        // Missing other required fields
      };

      const response = await request(app)
        .post('/api/student/payment/verify')
        .send(incompleteData);

      expect(response.status).toBe(400);
    });

    it('should handle invalid signature', async () => {
      // Mock crypto signature verification to return invalid signature
      jest.spyOn(crypto, 'createHmac').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('invalid_signature')
      });

      const response = await request(app)
        .post('/api/student/payment/verify')
        .send(validPaymentData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid signature');
    });

    it('should handle Razorpay API errors', async () => {
      // Mock crypto signature verification
      jest.spyOn(crypto, 'createHmac').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('valid_signature')
      });

      // Mock Razorpay API error
      mockRazorpay.payments.fetch.mockRejectedValue(new Error('Payment not found'));

      const response = await request(app)
        .post('/api/student/payment/verify')
        .send(validPaymentData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Payment verification failed');
    });
  });
});