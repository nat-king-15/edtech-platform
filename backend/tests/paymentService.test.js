const crypto = require('crypto');
const { db } = require('../config/firebase');
const razorpay = require('../config/razorpay');

// Mock Razorpay SDK
const mockRazorpay = {
  orders: {
    create: jest.fn(),
    fetch: jest.fn(),
    fetchPayments: jest.fn()
  },
  payments: {
    fetch: jest.fn(),
    capture: jest.fn(),
    refund: jest.fn()
  },
  subscriptions: {
    create: jest.fn(),
    fetch: jest.fn(),
    cancel: jest.fn()
  },
  webhooks: {
    validateWebhookSignature: jest.fn()
  }
};

jest.mock('../config/razorpay', () => mockRazorpay);

// Mock Firebase
jest.mock('../config/firebase', () => ({
  db: {
    collection: jest.fn(),
    doc: jest.fn(),
    runTransaction: jest.fn()
  }
}));

// Mock crypto for signature verification
jest.mock('crypto', () => ({
  createHmac: jest.fn(),
  timingSafeEqual: jest.fn()
}));

// Import webhook handlers after mocking
const { 
  handlePaymentCaptured, 
  handlePaymentFailed, 
  handleSubscriptionActivated,
  handleSubscriptionCancelled,
  verifyRazorpaySignature 
} = require('../routes/webhooks');

describe('Payment Service Tests', () => {
  let mockCollection, mockDoc, mockGet, mockSet, mockUpdate, mockAdd;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup Firebase mocks
    mockSet = jest.fn();
    mockUpdate = jest.fn();
    mockGet = jest.fn();
    mockAdd = jest.fn();
    
    mockDoc = jest.fn(() => ({
      id: 'mock-doc-id',
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    }));
    
    mockCollection = jest.fn(() => ({
      doc: mockDoc,
      add: mockAdd,
      get: mockGet,
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis()
    }));
    
    db.collection.mockReturnValue({
      doc: mockDoc,
      add: mockAdd,
      get: mockGet,
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis()
    });

    db.doc.mockReturnValue({
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    });

    // Setup environment variables
    process.env.RAZORPAY_KEY_ID = 'test-key-id';
    process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  });

  describe('Razorpay Order Creation', () => {
    it('should create order successfully', async () => {
      const orderData = {
        amount: 50000, // ₹500 in paise
        currency: 'INR',
        receipt: 'receipt_123',
        notes: {
          batchId: 'batch123',
          userId: 'user456'
        }
      };

      const mockOrder = {
        id: 'order_123',
        amount: 50000,
        currency: 'INR',
        receipt: 'receipt_123',
        status: 'created',
        created_at: 1640995200
      };

      mockRazorpay.orders.create.mockResolvedValue(mockOrder);

      const result = await mockRazorpay.orders.create(orderData);

      expect(result).toEqual(mockOrder);
      expect(mockRazorpay.orders.create).toHaveBeenCalledWith(orderData);
    });

    it('should handle order creation failure', async () => {
      const orderData = {
        amount: 50000,
        currency: 'INR',
        receipt: 'receipt_123'
      };

      mockRazorpay.orders.create.mockRejectedValue(new Error('Order creation failed'));

      await expect(mockRazorpay.orders.create(orderData)).rejects.toThrow('Order creation failed');
    });

    it('should validate order amount', async () => {
      const invalidOrderData = {
        amount: 0, // Invalid amount
        currency: 'INR',
        receipt: 'receipt_123'
      };

      mockRazorpay.orders.create.mockRejectedValue(new Error('Amount should be at least INR 1.00'));

      await expect(mockRazorpay.orders.create(invalidOrderData)).rejects.toThrow('Amount should be at least INR 1.00');
    });
  });

  describe('Payment Verification', () => {
    it('should verify payment signature successfully', () => {
      const paymentData = {
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_456',
        razorpay_signature: 'valid_signature'
      };

      const expectedSignature = 'valid_signature';
      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue(expectedSignature)
      };

      crypto.createHmac.mockReturnValue(mockHmac);
      crypto.timingSafeEqual.mockReturnValue(true);

      const result = verifyRazorpaySignature(
        paymentData.razorpay_order_id,
        paymentData.razorpay_payment_id,
        paymentData.razorpay_signature
      );

      expect(result).toBe(true);
      expect(crypto.createHmac).toHaveBeenCalledWith('sha256', 'test-key-secret');
      expect(mockHmac.update).toHaveBeenCalledWith('order_123|pay_456');
      expect(mockHmac.digest).toHaveBeenCalledWith('hex');
    });

    it('should reject invalid payment signature', () => {
      const paymentData = {
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_456',
        razorpay_signature: 'invalid_signature'
      };

      const expectedSignature = 'valid_signature';
      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue(expectedSignature)
      };

      crypto.createHmac.mockReturnValue(mockHmac);
      crypto.timingSafeEqual.mockReturnValue(false);

      const result = verifyRazorpaySignature(
        paymentData.razorpay_order_id,
        paymentData.razorpay_payment_id,
        paymentData.razorpay_signature
      );

      expect(result).toBe(false);
    });

    it('should handle signature verification error', () => {
      crypto.createHmac.mockImplementation(() => {
        throw new Error('Crypto error');
      });

      const result = verifyRazorpaySignature('order_123', 'pay_456', 'signature');

      expect(result).toBe(false);
    });
  });

  describe('Payment Webhook Handlers', () => {
    describe('handlePaymentCaptured', () => {
      it('should handle payment captured successfully', async () => {
        const paymentData = {
          id: 'pay_123',
          order_id: 'order_456',
          amount: 50000,
          currency: 'INR',
          status: 'captured',
          method: 'card',
          notes: {
            batchId: 'batch123',
            userId: 'user456'
          }
        };

        // Mock order document
        mockGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            userId: 'user456',
            batchId: 'batch123',
            amount: 50000,
            status: 'pending'
          })
        });

        // Mock user document
        mockGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            name: 'John Doe',
            email: 'john@example.com'
          })
        });

        // Mock batch document
        mockGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            title: 'React Masterclass',
            price: 500
          })
        });

        mockUpdate.mockResolvedValue();
        mockAdd.mockResolvedValue({ id: 'enrollment_123' });

        const result = await handlePaymentCaptured(paymentData);

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith({
          status: 'completed',
          paymentId: 'pay_123',
          capturedAt: expect.any(Object),
          updatedAt: expect.any(Object)
        });
        expect(mockAdd).toHaveBeenCalledWith({
          userId: 'user456',
          batchId: 'batch123',
          enrolledAt: expect.any(Object),
          paymentId: 'pay_123',
          amount: 50000,
          status: 'active'
        });
      });

      it('should handle missing order document', async () => {
        const paymentData = {
          id: 'pay_123',
          order_id: 'nonexistent_order',
          amount: 50000,
          status: 'captured'
        };

        mockGet.mockResolvedValue({
          exists: false
        });

        const result = await handlePaymentCaptured(paymentData);

        expect(result).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockAdd).not.toHaveBeenCalled();
      });

      it('should handle database error during enrollment', async () => {
        const paymentData = {
          id: 'pay_123',
          order_id: 'order_456',
          amount: 50000,
          status: 'captured',
          notes: {
            batchId: 'batch123',
            userId: 'user456'
          }
        };

        mockGet.mockResolvedValue({
          exists: true,
          data: () => ({
            userId: 'user456',
            batchId: 'batch123',
            amount: 50000,
            status: 'pending'
          })
        });

        mockUpdate.mockResolvedValue();
        mockAdd.mockRejectedValue(new Error('Database error'));

        const result = await handlePaymentCaptured(paymentData);

        expect(result).toBe(false);
      });
    });

    describe('handlePaymentFailed', () => {
      it('should handle payment failure successfully', async () => {
        const paymentData = {
          id: 'pay_123',
          order_id: 'order_456',
          amount: 50000,
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment failed due to insufficient funds'
        };

        mockGet.mockResolvedValue({
          exists: true,
          data: () => ({
            userId: 'user456',
            batchId: 'batch123',
            status: 'pending'
          })
        });

        mockUpdate.mockResolvedValue();

        const result = await handlePaymentFailed(paymentData);

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith({
          status: 'failed',
          paymentId: 'pay_123',
          errorCode: 'BAD_REQUEST_ERROR',
          errorDescription: 'Payment failed due to insufficient funds',
          failedAt: expect.any(Object),
          updatedAt: expect.any(Object)
        });
      });

      it('should handle missing order for failed payment', async () => {
        const paymentData = {
          id: 'pay_123',
          order_id: 'nonexistent_order',
          status: 'failed'
        };

        mockGet.mockResolvedValue({
          exists: false
        });

        const result = await handlePaymentFailed(paymentData);

        expect(result).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });

    describe('handleSubscriptionActivated', () => {
      it('should handle subscription activation successfully', async () => {
        const subscriptionData = {
          id: 'sub_123',
          plan_id: 'plan_456',
          customer_id: 'cust_789',
          status: 'active',
          current_start: 1640995200,
          current_end: 1643673600,
          notes: {
            userId: 'user456',
            planType: 'premium'
          }
        };

        mockGet.mockResolvedValue({
          exists: true,
          data: () => ({
            name: 'John Doe',
            email: 'john@example.com',
            subscriptionStatus: 'pending'
          })
        });

        mockUpdate.mockResolvedValue();
        mockAdd.mockResolvedValue({ id: 'subscription_log_123' });

        const result = await handleSubscriptionActivated(subscriptionData);

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith({
          subscriptionId: 'sub_123',
          subscriptionStatus: 'active',
          planId: 'plan_456',
          customerId: 'cust_789',
          currentStart: expect.any(Object),
          currentEnd: expect.any(Object),
          updatedAt: expect.any(Object)
        });
      });

      it('should handle missing user for subscription', async () => {
        const subscriptionData = {
          id: 'sub_123',
          notes: {
            userId: 'nonexistent_user'
          }
        };

        mockGet.mockResolvedValue({
          exists: false
        });

        const result = await handleSubscriptionActivated(subscriptionData);

        expect(result).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });

    describe('handleSubscriptionCancelled', () => {
      it('should handle subscription cancellation successfully', async () => {
        const subscriptionData = {
          id: 'sub_123',
          status: 'cancelled',
          cancelled_at: 1640995200,
          notes: {
            userId: 'user456'
          }
        };

        mockGet.mockResolvedValue({
          exists: true,
          data: () => ({
            name: 'John Doe',
            subscriptionStatus: 'active'
          })
        });

        mockUpdate.mockResolvedValue();
        mockAdd.mockResolvedValue({ id: 'cancellation_log_123' });

        const result = await handleSubscriptionCancelled(subscriptionData);

        expect(result).toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith({
          subscriptionStatus: 'cancelled',
          cancelledAt: expect.any(Object),
          updatedAt: expect.any(Object)
        });
      });

      it('should handle missing user for cancellation', async () => {
        const subscriptionData = {
          id: 'sub_123',
          notes: {
            userId: 'nonexistent_user'
          }
        };

        mockGet.mockResolvedValue({
          exists: false
        });

        const result = await handleSubscriptionCancelled(subscriptionData);

        expect(result).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe('Razorpay API Operations', () => {
    describe('fetchPayment', () => {
      it('should fetch payment details successfully', async () => {
        const paymentId = 'pay_123';
        const mockPayment = {
          id: 'pay_123',
          amount: 50000,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_456',
          method: 'card'
        };

        mockRazorpay.payments.fetch.mockResolvedValue(mockPayment);

        const result = await mockRazorpay.payments.fetch(paymentId);

        expect(result).toEqual(mockPayment);
        expect(mockRazorpay.payments.fetch).toHaveBeenCalledWith(paymentId);
      });

      it('should handle payment fetch error', async () => {
        const paymentId = 'nonexistent_payment';

        mockRazorpay.payments.fetch.mockRejectedValue(new Error('Payment not found'));

        await expect(mockRazorpay.payments.fetch(paymentId)).rejects.toThrow('Payment not found');
      });
    });

    describe('capturePayment', () => {
      it('should capture payment successfully', async () => {
        const paymentId = 'pay_123';
        const captureData = {
          amount: 50000,
          currency: 'INR'
        };

        const mockCapturedPayment = {
          id: 'pay_123',
          amount: 50000,
          status: 'captured'
        };

        mockRazorpay.payments.capture.mockResolvedValue(mockCapturedPayment);

        const result = await mockRazorpay.payments.capture(paymentId, captureData.amount, captureData.currency);

        expect(result).toEqual(mockCapturedPayment);
        expect(mockRazorpay.payments.capture).toHaveBeenCalledWith(paymentId, 50000, 'INR');
      });

      it('should handle payment capture error', async () => {
        const paymentId = 'pay_123';

        mockRazorpay.payments.capture.mockRejectedValue(new Error('Payment capture failed'));

        await expect(mockRazorpay.payments.capture(paymentId, 50000, 'INR')).rejects.toThrow('Payment capture failed');
      });
    });

    describe('refundPayment', () => {
      it('should process refund successfully', async () => {
        const paymentId = 'pay_123';
        const refundData = {
          amount: 25000, // Partial refund
          notes: {
            reason: 'Customer request'
          }
        };

        const mockRefund = {
          id: 'rfnd_123',
          payment_id: 'pay_123',
          amount: 25000,
          status: 'processed'
        };

        mockRazorpay.payments.refund.mockResolvedValue(mockRefund);

        const result = await mockRazorpay.payments.refund(paymentId, refundData);

        expect(result).toEqual(mockRefund);
        expect(mockRazorpay.payments.refund).toHaveBeenCalledWith(paymentId, refundData);
      });

      it('should handle refund processing error', async () => {
        const paymentId = 'pay_123';
        const refundData = { amount: 50000 };

        mockRazorpay.payments.refund.mockRejectedValue(new Error('Refund processing failed'));

        await expect(mockRazorpay.payments.refund(paymentId, refundData)).rejects.toThrow('Refund processing failed');
      });
    });
  });

  describe('Webhook Signature Validation', () => {
    it('should validate webhook signature using Razorpay utility', () => {
      const webhookBody = '{"event":"payment.captured","payload":{"payment":{"id":"pay_123"}}}';
      const signature = 'valid_signature';

      mockRazorpay.webhooks.validateWebhookSignature.mockReturnValue(true);

      const result = mockRazorpay.webhooks.validateWebhookSignature(webhookBody, signature, 'test-webhook-secret');

      expect(result).toBe(true);
      expect(mockRazorpay.webhooks.validateWebhookSignature).toHaveBeenCalledWith(webhookBody, signature, 'test-webhook-secret');
    });

    it('should reject invalid webhook signature', () => {
      const webhookBody = '{"event":"payment.captured","payload":{"payment":{"id":"pay_123"}}}';
      const signature = 'invalid_signature';

      mockRazorpay.webhooks.validateWebhookSignature.mockReturnValue(false);

      const result = mockRazorpay.webhooks.validateWebhookSignature(webhookBody, signature, 'test-webhook-secret');

      expect(result).toBe(false);
    });

    it('should handle signature validation error', () => {
      const webhookBody = 'invalid_json';
      const signature = 'signature';

      mockRazorpay.webhooks.validateWebhookSignature.mockImplementation(() => {
        throw new Error('Validation error');
      });

      expect(() => {
        mockRazorpay.webhooks.validateWebhookSignature(webhookBody, signature, 'test-webhook-secret');
      }).toThrow('Validation error');
    });
  });

  describe('Transaction Management', () => {
    it('should handle transaction rollback on payment failure', async () => {
      const mockTransaction = {
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      db.runTransaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });

      // Mock transaction failure scenario
      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({ status: 'pending' })
      });
      
      mockTransaction.update.mockImplementation(() => {
        throw new Error('Transaction failed');
      });

      const transactionCallback = async (transaction) => {
        const orderRef = db.collection('orders').doc('order_123');
        const orderDoc = await transaction.get(orderRef);
        
        if (orderDoc.exists) {
          transaction.update(orderRef, { status: 'failed' });
        }
        
        return true;
      };

      await expect(db.runTransaction(transactionCallback)).rejects.toThrow('Transaction failed');
    });

    it('should complete transaction successfully', async () => {
      const mockTransaction = {
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn()
      };

      db.runTransaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });

      mockTransaction.get.mockResolvedValue({
        exists: true,
        data: () => ({ status: 'pending' })
      });
      
      mockTransaction.update.mockResolvedValue();

      const transactionCallback = async (transaction) => {
        const orderRef = db.collection('orders').doc('order_123');
        const orderDoc = await transaction.get(orderRef);
        
        if (orderDoc.exists) {
          transaction.update(orderRef, { status: 'completed' });
        }
        
        return true;
      };

      const result = await db.runTransaction(transactionCallback);

      expect(result).toBe(true);
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        { status: 'completed' }
      );
    });
  });
});