const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { mux, razorpay } = require('../routes/webhooks');
const muxService = require('../services/muxService');

// Mock muxService
jest.mock('../services/muxService', () => ({
  verifyWebhookSignature: jest.fn(),
  handleWebhook: jest.fn()
}));

// Mock Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ exists: true, data: () => ({}) })),
        set: jest.fn(() => Promise.resolve()),
        update: jest.fn(() => Promise.resolve()),
        delete: jest.fn(() => Promise.resolve()),
        ref: {
          update: jest.fn(() => Promise.resolve())
        }
      })),
      where: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ 
          empty: false, 
          docs: [{ ref: { update: jest.fn(() => Promise.resolve()) } }] 
        }))
      })),
      add: jest.fn(() => Promise.resolve({ id: 'mock-doc-id' }))
    }))
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => 'mock-timestamp')
  }
}));

describe('Mux Webhook Handler', () => {
  let app;

  beforeEach(() => {
    app = express();
    // Register the mux webhook route with raw parser (same as in server.js)
    app.post('/api/webhooks/mux', express.raw({ type: 'application/json' }), mux);
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Signature Verification', () => {
    const validEvent = {
      type: 'video.asset.ready',
      id: 'test-event-id',
      created_at: '2024-01-15T10:30:00Z',
      data: {
        id: 'test-asset-id',
        passthrough: 'test-schedule-id',
        playback_ids: [
          { id: 'test-playback-id', policy: 'public' }
        ]
      }
    };

    it('should successfully process webhook with valid signature', async () => {
      // Mock successful signature verification
      muxService.verifyWebhookSignature.mockReturnValue(true);
      muxService.handleWebhook.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature-hash')
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Webhook processed successfully'
      });

      // Verify signature verification was called with correct parameters
      expect(muxService.verifyWebhookSignature).toHaveBeenCalledWith(
        Buffer.from(JSON.stringify(validEvent)),
        'valid-signature-hash'
      );

      // Verify webhook handler was called with parsed event
      expect(muxService.handleWebhook).toHaveBeenCalledWith(validEvent);
    });

    it('should reject webhook with invalid signature', async () => {
      // Mock failed signature verification
      muxService.verifyWebhookSignature.mockReturnValue(false);

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'invalid-signature-hash')
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Invalid webhook signature'
      });

      // Verify signature verification was called
      expect(muxService.verifyWebhookSignature).toHaveBeenCalledWith(
        Buffer.from(JSON.stringify(validEvent)),
        'invalid-signature-hash'
      );

      // Verify webhook handler was NOT called
      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should reject webhook with missing signature header', async () => {
      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        // No mux-signature header
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Missing Mux signature header'
      });

      // Verify signature verification was NOT called
      expect(muxService.verifyWebhookSignature).not.toHaveBeenCalled();
      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should handle signature verification errors gracefully', async () => {
      // Mock signature verification throwing an error
      muxService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('Signature verification failed');
      });

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'error-causing-signature')
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to process webhook'
      });

      expect(muxService.verifyWebhookSignature).toHaveBeenCalled();
      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  describe('Event Processing', () => {
    beforeEach(() => {
      // Mock successful signature verification for all event processing tests
      muxService.verifyWebhookSignature.mockReturnValue(true);
    });

    it('should reject webhook with invalid event structure', async () => {
      const invalidEvent = { invalid: 'structure' };

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send(JSON.stringify(invalidEvent));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });

      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should reject webhook with missing event type', async () => {
      const eventWithoutType = {
        id: 'test-event-id',
        created_at: '2024-01-15T10:30:00Z',
        data: {}
      };

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send(JSON.stringify(eventWithoutType));

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });

      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });

    it('should handle webhook processing failure gracefully', async () => {
      muxService.handleWebhook.mockResolvedValue(false);

      const validEvent = {
        type: 'video.asset.ready',
        id: 'test-event-id',
        created_at: '2024-01-15T10:30:00Z',
        data: {}
      };

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: false,
        message: 'Webhook received but not processed'
      });

      expect(muxService.handleWebhook).toHaveBeenCalledWith(validEvent);
    });

    it('should handle webhook processing errors', async () => {
      muxService.handleWebhook.mockRejectedValue(new Error('Processing failed'));

      const validEvent = {
        type: 'video.asset.ready',
        id: 'test-event-id',
        created_at: '2024-01-15T10:30:00Z',
        data: {}
      };

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send(JSON.stringify(validEvent));

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to process webhook'
      });

      expect(muxService.handleWebhook).toHaveBeenCalledWith(validEvent);
    });
  });

  describe('Raw Body Parsing', () => {
    beforeEach(() => {
      muxService.verifyWebhookSignature.mockReturnValue(true);
      muxService.handleWebhook.mockResolvedValue(true);
    });

    it('should correctly parse raw body as Buffer for signature verification', async () => {
      const eventData = {
        type: 'video.asset.ready',
        id: 'test-event-id',
        created_at: '2024-01-15T10:30:00Z',
        data: { id: 'asset-123' }
      };

      const rawBody = JSON.stringify(eventData);

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'test-signature')
        .send(rawBody);

      expect(response.status).toBe(200);

      // Verify that verifyWebhookSignature received a Buffer
      const callArgs = muxService.verifyWebhookSignature.mock.calls[0];
      expect(Buffer.isBuffer(callArgs[0])).toBe(true);
      expect(callArgs[0].toString('utf8')).toBe(rawBody);
      expect(callArgs[1]).toBe('test-signature');

      // Verify that handleWebhook received the parsed event object
      expect(muxService.handleWebhook).toHaveBeenCalledWith(eventData);
    });

    it('should handle malformed JSON gracefully', async () => {
      muxService.verifyWebhookSignature.mockReturnValue(true);

      const response = await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send('{ invalid json }');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to process webhook'
      });

      expect(muxService.verifyWebhookSignature).toHaveBeenCalled();
      expect(muxService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = {
        log: jest.spyOn(console, 'log').mockImplementation(),
        error: jest.spyOn(console, 'error').mockImplementation()
      };
      muxService.verifyWebhookSignature.mockReturnValue(true);
      muxService.handleWebhook.mockResolvedValue(true);
    });

    afterEach(() => {
      consoleSpy.log.mockRestore();
      consoleSpy.error.mockRestore();
    });

    it('should log webhook processing steps for valid signatures', async () => {
      const validEvent = {
        type: 'video.asset.ready',
        id: 'test-event-id',
        created_at: '2024-01-15T10:30:00Z',
        data: {}
      };

      await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'valid-signature')
        .send(JSON.stringify(validEvent));

      expect(consoleSpy.log).toHaveBeenCalledWith('🎯 Mux Webhook Hit!');
      expect(consoleSpy.log).toHaveBeenCalledWith('🔐 Signature received:', 'valid-signature');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ Webhook signature verified successfully');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ Valid event received:', 'video.asset.ready');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ Webhook processed successfully');
    });

    it('should log errors for invalid signatures', async () => {
      muxService.verifyWebhookSignature.mockReturnValue(false);

      await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .set('mux-signature', 'invalid-signature')
        .send(JSON.stringify({ type: 'test', data: {} }));

      expect(consoleSpy.error).toHaveBeenCalledWith('❌ Invalid Mux webhook signature');
    });

    it('should log errors for missing signatures', async () => {
      await request(app)
        .post('/api/webhooks/mux')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'test', data: {} }));

      expect(consoleSpy.error).toHaveBeenCalledWith('❌ Missing Mux signature header');
    });
  });
});

describe('Razorpay Webhook Handler', () => {
  let app;
  const mockWebhookSecret = 'test-webhook-secret';

  beforeEach(() => {
    app = express();
    // Register the razorpay webhook route with raw parser (same as in server.js)
    app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), razorpay);
    
    // Set environment variable for webhook secret
    process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  describe('Signature Verification', () => {
    const validEvent = {
      event: 'payment.captured',
      account_id: 'acc_test123',
      created_at: 1642234567,
      payload: {
        payment: {
          entity: {
            id: 'pay_test123',
            order_id: 'order_test123',
            amount: 50000,
            currency: 'INR',
            method: 'card',
            status: 'captured'
          }
        }
      }
    };

    function generateValidSignature(body) {
      return crypto.createHmac('sha256', mockWebhookSecret)
        .update(body)
        .digest('hex');
    }

    it('should successfully process webhook with valid signature', async () => {
       const eventBody = JSON.stringify(validEvent);
       const validSignature = generateValidSignature(eventBody);

       const response = await request(app)
         .post('/api/webhooks/razorpay')
         .set('Content-Type', 'application/json')
         .set('x-razorpay-signature', validSignature)
         .send(eventBody);

       console.log('Response body:', response.body);
       expect(response.status).toBe(200);
       expect(response.body).toEqual({
         success: false,
         message: 'Webhook received but not processed'
       });
     });

    it('should reject webhook with invalid signature', async () => {
      const eventBody = JSON.stringify(validEvent);
      const invalidSignature = 'invalid-signature-hash';

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', invalidSignature)
        .send(eventBody);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Invalid webhook signature'
      });
    });

    it('should reject webhook with missing signature header', async () => {
      const eventBody = JSON.stringify(validEvent);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .send(eventBody);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Missing Razorpay signature header'
      });
    });

    it('should reject webhook with invalid event structure', async () => {
      const invalidEvent = { invalid: 'structure' };
      const eventBody = JSON.stringify(invalidEvent);
      const validSignature = generateValidSignature(eventBody);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', validSignature)
        .send(eventBody);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });
    });
  });

  describe('Event Handling', () => {
    function generateValidSignature(body) {
      return crypto.createHmac('sha256', mockWebhookSecret)
        .update(body)
        .digest('hex');
    }

    it('should handle payment.captured event', async () => {
       const capturedEvent = {
         event: 'payment.captured',
         account_id: 'acc_test123',
         created_at: 1642234567,
         payload: {
           payment: {
             entity: {
               id: 'pay_test123',
               order_id: 'order_test123',
               amount: 50000,
               currency: 'INR',
               method: 'card',
               status: 'captured'
             }
           }
         }
       };

       const eventBody = JSON.stringify(capturedEvent);
       const validSignature = generateValidSignature(eventBody);

       const response = await request(app)
         .post('/api/webhooks/razorpay')
         .set('Content-Type', 'application/json')
         .set('x-razorpay-signature', validSignature)
         .send(eventBody);

       expect(response.status).toBe(200);
       expect(response.body).toEqual({
         success: false,
         message: 'Webhook received but not processed'
       });
     });

    it('should handle payment.failed event', async () => {
       const failedEvent = {
         event: 'payment.failed',
         account_id: 'acc_test123',
         created_at: 1642234567,
         payload: {
           payment: {
             entity: {
               id: 'pay_test123',
               order_id: 'order_test123',
               amount: 50000,
               currency: 'INR',
               method: 'card',
               status: 'failed',
               error_code: 'BAD_REQUEST_ERROR',
               error_description: 'Payment failed due to insufficient funds'
             }
           }
         }
       };

       const eventBody = JSON.stringify(failedEvent);
       const validSignature = generateValidSignature(eventBody);

       const response = await request(app)
         .post('/api/webhooks/razorpay')
         .set('Content-Type', 'application/json')
         .set('x-razorpay-signature', validSignature)
         .send(eventBody);

       expect(response.status).toBe(200);
       expect(response.body).toEqual({
         success: false,
         message: 'Webhook received but not processed'
       });
     });

    it('should handle order.paid event', async () => {
       const orderPaidEvent = {
         event: 'order.paid',
         account_id: 'acc_test123',
         created_at: 1642234567,
         payload: {
           order: {
             entity: {
               id: 'order_test123',
               amount: 50000,
               currency: 'INR',
               status: 'paid'
             }
           },
           payment: {
             entity: {
               id: 'pay_test123',
               order_id: 'order_test123',
               amount: 50000,
               currency: 'INR',
               method: 'card',
               status: 'captured'
             }
           }
         }
       };

       const eventBody = JSON.stringify(orderPaidEvent);
       const validSignature = generateValidSignature(eventBody);

       const response = await request(app)
         .post('/api/webhooks/razorpay')
         .set('Content-Type', 'application/json')
         .set('x-razorpay-signature', validSignature)
         .send(eventBody);

       expect(response.status).toBe(200);
       expect(response.body).toEqual({
         success: false,
         message: 'Webhook received but not processed'
       });
     });

    it('should handle unhandled event types gracefully', async () => {
      const unknownEvent = {
        event: 'unknown.event.type',
        account_id: 'acc_test123',
        created_at: 1642234567,
        payload: {}
      };

      const eventBody = JSON.stringify(unknownEvent);
      const validSignature = generateValidSignature(eventBody);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', validSignature)
        .send(eventBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    function generateValidSignature(body) {
      return crypto.createHmac('sha256', mockWebhookSecret)
        .update(body)
        .digest('hex');
    }

    it('should handle malformed JSON gracefully', async () => {
      const malformedBody = '{ invalid json }';
      const validSignature = generateValidSignature(malformedBody);

      const response = await request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', validSignature)
        .send(malformedBody);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Internal Server Error',
        message: 'Failed to process webhook'
      });
    });
  });
});