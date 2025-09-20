const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

// Import Firebase configuration to initialize
require('./config/firebase');

// Import security middleware
const { rateLimitConfigs } = require('./middleware/rateLimiter');
const { auditMiddleware, logAuditEvent, AUDIT_EVENTS, RISK_LEVELS } = require('./middleware/auditLogger');
const { verifyVideoToken, antiPiracyDetection } = require('./middleware/drmProtection');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const teacherRoutes = require('./routes/teacher');
const studentRoutes = require('./routes/student');
const webhookRoutes = require('./routes/webhooks');
const coursesRoutes = require('./routes/courses');
const assignmentRoutes = require('./src/routes/assignments');
const chatRoutes = require('./routes/chat');
const videoRoutes = require('./routes/video');
const forumRoutes = require('./routes/forum');
const analyticsRoutes = require('./routes/analytics');
const reportRoutes = require('./src/routes/reports');
const mobileRoutes = require('./src/routes/mobile');

// Import new pw-extractor inspired routes
const contentRoutes = require('./routes/content');
const announcementRoutes = require('./routes/announcements');
const dashboardRoutes = require('./routes/dashboard');
const tokenRoutes = require('./routes/tokens');
const trackingRoutes = require('./routes/tracking');
const utilityRoutes = require('./routes/utilities');
const notificationRoutes = require('./routes/notifications');

// Import Socket.io handler
const chatSocketHandler = require('./src/socket/chatSocket');

// Import services
const schedulerService = require('./services/schedulerService');

// Import Firebase Admin SDK
const admin = require('firebase-admin');

// Create Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware - Apply rate limiting first
app.use('/api/admin/', rateLimitConfigs.admin); // Higher limits for admin operations
app.use('/api/', rateLimitConfigs.general);
app.use('/api/auth/', rateLimitConfigs.auth);
app.use('/api/teacher/generate-upload-url', rateLimitConfigs.upload);
app.use('/api/teacher/generate-pdf-upload-url', rateLimitConfigs.upload);
app.use('/api/student/batches/*/create-order', rateLimitConfigs.payment);
app.use('/api/student/payment/verify', rateLimitConfigs.payment);

// Apply audit logging to all requests except webhooks
app.use((req, res, next) => {
  // Skip audit logging for webhook endpoints
  if (req.path.startsWith('/api/webhooks/')) {
    return next();
  }
  return auditMiddleware('API_REQUEST')(req, res, next);
});

// Apply anti-piracy detection to video-related routes
app.use('/api/student/batches/*/content', antiPiracyDetection);
app.use('/api/video/*', antiPiracyDetection);

// CORS middleware with enhanced security
app.use(cors({
  origin: function (origin, callback) {
    // In production, only allow specific domains
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development: Allow localhost and local network IPs
      if (!origin) return callback(null, true);
      
      const allowedPatterns = [
        /^http:\/\/localhost:\d+$/,
        /^https:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
        /^https:\/\/127\.0\.0\.1:\d+$/,
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
        /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/
      ];
      
      const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
      callback(null, isAllowed);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;");
  next();
});

// Register webhook routes with raw parser BEFORE express.json()
const webhooks = require('./routes/webhooks');
app.post('/api/webhooks/mux', express.raw({ type: 'application/json' }), webhooks.mux);
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhooks.razorpay);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'EdTech Platform API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Public API endpoint for batch discovery
app.get('/api/batches/published', async (req, res) => {
  try {
    const { courseId, limit = 20, offset = 0 } = req.query;
    
    // Build query for published batches
    let query = admin.firestore().collection('batches')
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc');
    
    // Add courseId filter if provided
    if (courseId) {
      query = query.where('courseId', '==', courseId);
    }
    
    // Apply pagination
    const limitNum = Math.min(parseInt(limit), 50); // Max 50 results
    const offsetNum = parseInt(offset) || 0;
    
    query = query.limit(limitNum).offset(offsetNum);
    
    const snapshot = await query.get();
    
    const batches = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      batches.push({
        id: doc.id,
        name: data.name,
        description: data.description,
        courseId: data.courseId,
        courseName: data.courseName,
        startDate: data.startDate,
        endDate: data.endDate,
        price: data.price,
        currency: data.currency || 'USD',
        status: data.status,
        createdAt: data.createdAt,
        // Don't expose internal fields like createdBy
      });
    });
    
    res.json({
      success: true,
      data: batches,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: batches.length,
        hasMore: batches.length === limitNum
      }
    });
    
  } catch (error) {
    console.error('Error fetching published batches:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to fetch published batches'
    });
  }
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/mobile', mobileRoutes);

// Mount new pw-extractor inspired routes
app.use('/api/content', contentRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/utilities', utilityRoutes);
app.use('/api/notifications', notificationRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to EdTech Platform API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      admin: '/api/admin',
      teacher: '/api/teacher',
      student: '/api/student',
      webhooks: '/api/webhooks',
      batches: '/api/batches/published',
      documentation: 'Coming soon...'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: {
      // Public endpoints
      health: 'GET /health',
      root: 'GET /',
      publishedBatches: 'GET /api/batches/published',
      // Admin endpoints
      admin: 'POST /api/admin/users/:uid/set-role',
      getUserDetails: 'GET /api/admin/users/:uid',
      getUserProfile: 'GET /api/admin/users/:uid/profile',
      listUsers: 'GET /api/admin/users',
      createCourse: 'POST /api/admin/courses',
      createBatch: 'POST /api/admin/batches',
      createSubject: 'POST /api/admin/batches/:batchId/subjects',
      assignTeacher: 'PUT /api/admin/subjects/:subjectId/assign-teacher',
      publishBatch: 'PUT /api/admin/batches/:batchId/publish',
      createAnnouncement: 'POST /api/admin/batches/:batchId/announcements',
      // Teacher endpoints
      teacherSubjects: 'GET /api/teacher/my-subjects',
      subjectDetails: 'GET /api/teacher/subjects/:subjectId',
      generateUploadUrl: 'POST /api/teacher/generate-upload-url',
      generatePdfUploadUrl: 'POST /api/teacher/generate-pdf-upload-url',
      scheduleContent: 'POST /api/teacher/schedule',
      getSchedule: 'GET /api/teacher/subjects/:subjectId/schedule',
      // Student endpoints
      createOrder: 'POST /api/student/batches/:batchId/create-order',
      verifyPayment: 'POST /api/student/payment/verify',
      enrollInBatch: 'POST /api/student/batches/:batchId/enroll',
      myBatches: 'GET /api/student/my-batches',
      batchContent: 'GET /api/student/batches/:batchId/content',
      // Webhook endpoints
      muxWebhook: 'POST /api/webhooks/mux'
    }
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  // Handle specific error types
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body'
    });
  }
  
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body exceeds size limit'
    });
  }

  // Default error response
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' 
      ? error.message 
      : 'Something went wrong',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
chatSocketHandler.initialize(server);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 EdTech Platform API Server started successfully!`);
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`🌐 Local Network: http://0.0.0.0:${PORT} (accessible from other devices)`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Admin endpoints: http://localhost:${PORT}/api/admin`);
  console.log(`👨‍🏫 Teacher endpoints: http://localhost:${PORT}/api/teacher`);
  console.log(`👨‍🎓 Student endpoints: http://localhost:${PORT}/api/student`);
  console.log(`💬 Chat endpoints: http://localhost:${PORT}/api/chat`);
  console.log(`\n📚 Available endpoints:`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  / - API information`);
  console.log(`   GET  /api/batches/published - Get published batches (Public)`);
  console.log(`   POST /api/admin/users/:uid/set-role - Set user role (Admin only)`);
  console.log(`   GET  /api/admin/users/:uid - Get user details (Admin only)`);
  console.log(`   GET  /api/admin/users - List all users (Admin only)`);
  console.log(`   POST /api/admin/courses - Create course (Admin only)`);
  console.log(`   POST /api/admin/batches - Create batch (Admin only)`);
  console.log(`   POST /api/admin/batches/:batchId/subjects - Create subject (Admin only)`);
  console.log(`   PUT  /api/admin/subjects/:subjectId/assign-teacher - Assign teacher (Admin only)`);
  console.log(`   PUT  /api/admin/batches/:batchId/publish - Publish batch (Admin only)`);
  console.log(`   POST /api/admin/batches/:batchId/announcements - Create announcement (Admin only)`);
  console.log(`   GET  /api/teacher/my-subjects - Get assigned subjects (Teacher only)`);
  console.log(`   GET  /api/teacher/subjects/:subjectId - Get subject details (Teacher only)`);
  console.log(`   POST /api/teacher/generate-upload-url - Generate Mux upload URL (Teacher only)`);
  console.log(`   POST /api/teacher/generate-pdf-upload-url - Generate PDF upload URL (Teacher only)`);
  console.log(`   POST /api/teacher/schedule - Schedule content (Teacher only)`);
  console.log(`   GET  /api/teacher/subjects/:subjectId/schedule - Get content schedule (Teacher only)`);
  console.log(`   POST /api/student/batches/:batchId/create-order - Create Razorpay payment order (Student only)`);
  console.log(`   POST /api/student/payment/verify - Verify payment and complete enrollment (Student only)`);
  console.log(`   POST /api/student/batches/:batchId/enroll - Enroll in batch (Student only)`);
  console.log(`   GET  /api/student/my-batches - Get enrolled batches (Student only)`);
  console.log(`   GET  /api/student/batches/:batchId/content - Get batch content (Student only)`);
  console.log(`   GET  /api/student/notifications - Get user notifications (Student only)`);
  console.log(`   GET  /api/student/notifications/unread-count - Get unread notification count (Student only)`);
  console.log(`   PUT  /api/student/notifications/:notificationId/read - Mark notification as read (Student only)`);
  console.log(`   PUT  /api/student/notifications/mark-all-read - Mark all notifications as read (Student only)`);
  console.log(`   POST /api/webhooks/mux - Mux video processing webhook (Public)`);
  console.log(`   POST /api/chat/rooms - Create chat room (Teacher/Admin only)`);
  console.log(`   GET  /api/chat/rooms - Get chat rooms`);
  console.log(`   GET  /api/chat/rooms/:roomId/messages - Get messages`);
  console.log(`   POST /api/chat/rooms/:roomId/messages - Send message`);
  console.log(`\n💬 Real-time Chat: Socket.io enabled on same port`);
  console.log(`\n🔐 Authentication: Bearer token required for protected routes`);
  console.log(`\n⚡ Ready to handle requests!\n`);
});

module.exports = { app, server };