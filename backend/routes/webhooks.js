const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const muxService = require('../services/muxService');

const router = express.Router();

/**
 * Razorpay webhook handler with signature verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const razorpay = async (req, res) => {
  console.log('💳 Razorpay Webhook Hit!');
  console.log('🔍 Request Headers:', req.headers);
  
  try {
    // 1) Read the signature from headers
    const signature = req.headers['x-razorpay-signature'];
    
    if (!signature) {
      console.error('❌ Missing Razorpay signature header');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing Razorpay signature header'
      });
    }
    
    console.log('🔐 Signature received:', signature);
    
    // 2) Verify webhook signature
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');
    
    if (expected !== signature) {
      console.error('❌ Invalid Razorpay webhook signature');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid webhook signature'
      });
    }
    
    console.log('✅ Webhook signature verified successfully');
    
    // 3) Parse the event from raw body
    const event = JSON.parse(req.body.toString('utf8'));
    console.log('📦 Parsed event:', {
      event: event.event,
      account_id: event.account_id,
      created_at: event.created_at
    });
    
    // 4) Validate event structure
    if (!event || !event.event) {
      console.error('❌ Invalid event structure');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });
    }
    
    console.log('✅ Valid event received:', event.event);

    // 5) Handle different Razorpay events
    let success = false;
    
    switch (event.event) {
      case 'payment.captured':
        success = await handlePaymentCaptured(event.payload.payment.entity);
        break;
      
      case 'payment.failed':
        success = await handlePaymentFailed(event.payload.payment.entity);
        break;
      
      case 'order.paid':
        success = await handleOrderPaid(event.payload.order.entity, event.payload.payment.entity);
        break;
      
      case 'subscription.activated':
        success = await handleSubscriptionActivated(event.payload.subscription.entity);
        break;
      
      case 'subscription.cancelled':
        success = await handleSubscriptionCancelled(event.payload.subscription.entity);
        break;
      
      default:
        console.log(`⚠️ Unhandled event type: ${event.event}`);
        success = true; // Return success for unhandled events to avoid retries
        break;
    }

    if (success) {
      console.log('✅ Razorpay webhook processed successfully');
      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully'
      });
    } else {
      console.log('⚠️ Razorpay webhook received but not processed');
      res.status(200).json({
        success: false,
        message: 'Webhook received but not processed'
      });
    }

  } catch (error) {
    console.error('❌ Error processing Razorpay webhook:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process webhook'
    });
  }
};

/**
 * Handle payment captured event
 */
async function handlePaymentCaptured(payment) {
  try {
    console.log('💰 Processing payment captured:', payment.id);
    
    // Update payment document in Firestore
    const paymentRef = admin.firestore().collection('payments').doc(payment.id);
    await paymentRef.update({
      status: 'captured',
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update enrollment status if order_id exists
    if (payment.order_id) {
      const enrollmentQuery = await admin.firestore()
        .collection('enrollments')
        .where('orderId', '==', payment.order_id)
        .get();
      
      if (!enrollmentQuery.empty) {
        const enrollmentDoc = enrollmentQuery.docs[0];
        await enrollmentDoc.ref.update({
          paymentStatus: 'completed',
          status: 'active',
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Enrollment activated for order:', payment.order_id);
        
        // TODO: Send enrollment confirmation email/notification
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error handling payment captured:', error);
    return false;
  }
}

/**
 * Handle payment failed event
 */
async function handlePaymentFailed(payment) {
  try {
    console.log('❌ Processing payment failed:', payment.id);
    
    // Update payment document in Firestore
    const paymentRef = admin.firestore().collection('payments').doc(payment.id);
    await paymentRef.update({
      status: 'failed',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      errorCode: payment.error_code,
      errorDescription: payment.error_description,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update enrollment status if order_id exists
    if (payment.order_id) {
      const enrollmentQuery = await admin.firestore()
        .collection('enrollments')
        .where('orderId', '==', payment.order_id)
        .get();
      
      if (!enrollmentQuery.empty) {
        const enrollmentDoc = enrollmentQuery.docs[0];
        await enrollmentDoc.ref.update({
          paymentStatus: 'failed',
          status: 'payment_pending',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('⚠️ Enrollment payment failed for order:', payment.order_id);
        
        // TODO: Send payment failure notification
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error handling payment failed:', error);
    return false;
  }
}

/**
 * Handle order paid event
 */
async function handleOrderPaid(order, payment) {
  try {
    console.log('💳 Processing order paid:', order.id);
    
    // Update order document in Firestore
    const orderRef = admin.firestore().collection('orders').doc(order.id);
    await orderRef.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentId: payment.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Order marked as paid:', order.id);
    return true;
  } catch (error) {
    console.error('❌ Error handling order paid:', error);
    return false;
  }
}

/**
 * Handle subscription activated event
 */
async function handleSubscriptionActivated(subscription) {
  try {
    console.log('🔄 Processing subscription activated:', subscription.id);
    
    // Update subscription document in Firestore
    const subscriptionRef = admin.firestore().collection('subscriptions').doc(subscription.id);
    await subscriptionRef.update({
      status: 'active',
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      currentStart: subscription.current_start,
      currentEnd: subscription.current_end,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Subscription activated:', subscription.id);
    return true;
  } catch (error) {
    console.error('❌ Error handling subscription activated:', error);
    return false;
  }
}

/**
 * Handle subscription cancelled event
 */
async function handleSubscriptionCancelled(subscription) {
  try {
    console.log('❌ Processing subscription cancelled:', subscription.id);
    
    // Update subscription document in Firestore
    const subscriptionRef = admin.firestore().collection('subscriptions').doc(subscription.id);
    await subscriptionRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('⚠️ Subscription cancelled:', subscription.id);
    return true;
  } catch (error) {
    console.error('❌ Error handling subscription cancelled:', error);
    return false;
  }
}

/**
 * Mux webhook handler with signature verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const mux = async (req, res) => {
  console.log('🎯 Mux Webhook Hit!');
  console.log('🔍 Request Headers:', req.headers);
  
  try {
    // 1) Read the signature from headers
    const signature = req.headers['mux-signature'];
    
    if (!signature) {
      console.error('❌ Missing Mux signature header');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing Mux signature header'
      });
    }
    
    console.log('🔐 Signature received:', signature);
    
    // 2) Verify webhook signature
    const isValid = muxService.verifyWebhookSignature(req.body, signature);
    
    if (!isValid) {
      console.error('❌ Invalid Mux webhook signature');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid webhook signature'
      });
    }
    
    console.log('✅ Webhook signature verified successfully');
    
    // 4) Parse the event from raw body
    const event = JSON.parse(req.body.toString('utf8'));
    console.log('📦 Parsed event:', {
      type: event.type,
      id: event.id,
      created_at: event.created_at
    });
    
    // 5) Validate event.type
    if (!event || !event.type) {
      console.error('❌ Invalid event structure');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid event structure'
      });
    }
    
    console.log('✅ Valid event received:', event.type);

    // Handle the webhook event
    const success = await muxService.handleWebhook(event);

    if (success) {
      console.log('✅ Webhook processed successfully');
      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully'
      });
    } else {
      console.log('⚠️ Webhook received but not processed');
      res.status(200).json({
        success: false,
        message: 'Webhook received but not processed'
      });
    }

  } catch (error) {
    console.error('❌ Error processing Mux webhook:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process webhook'
    });
  }
};

/**
 * Legacy Mux webhook route (for router-based routing)
 * POST /api/webhooks/mux
 * Public webhook endpoint for Mux video processing events
 */
/**
 * Health check for webhook endpoint
 * GET /api/webhooks/health
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Webhook service is healthy',
    timestamp: admin.firestore.Timestamp.fromDate(new Date())
  });
});

// Export both the router and the webhook handler functions
module.exports = router;
module.exports.mux = mux;
module.exports.razorpay = razorpay;