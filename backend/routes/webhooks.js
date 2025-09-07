const express = require('express');
const muxService = require('../services/muxService');

const router = express.Router();

/**
 * Mux webhook handler
 * POST /api/webhooks/mux
 * Public webhook endpoint for Mux video processing events
 */
router.post('/mux', async (req, res) => {
  console.log('🎯 Mux Webhook Hit!');
  console.log('🔍 Request Body:', req.body);
  console.log('🔍 Request Headers:', req.headers);
  
  try {
    const event = req.body;
    
    if (!event || !event.type) {
      console.error('❌ Invalid event structure');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });
    }
    
    console.log('✅ Valid event received:', event.type);

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