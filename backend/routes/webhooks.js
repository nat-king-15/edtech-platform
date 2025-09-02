const express = require('express');
const muxService = require('../services/muxService');

const router = express.Router();

/**
 * Mux webhook handler
 * POST /api/webhooks/mux
 * Public webhook endpoint for Mux video processing events
 */
router.post('/mux', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.get('mux-signature');
    const rawBody = req.body;

    // Verify webhook signature if secret is configured
    if (process.env.MUX_WEBHOOK_SECRET) {
      const isValid = muxService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn('Invalid Mux webhook signature');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature'
        });
      }
    }

    // Parse the webhook event
    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (parseError) {
      console.error('Error parsing Mux webhook payload:', parseError);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid JSON payload'
      });
    }

    console.log('Received Mux webhook event:', {
      type: event.type,
      id: event.id,
      created_at: event.created_at
    });

    // Handle the webhook event
    const success = await muxService.handleWebhook(event);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully'
      });
    } else {
      res.status(200).json({
        success: false,
        message: 'Webhook received but not processed'
      });
    }

  } catch (error) {
    console.error('Error processing Mux webhook:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process webhook'
    });
  }
});

/**
 * Health check for webhook endpoint
 * GET /api/webhooks/health
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Webhook service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;