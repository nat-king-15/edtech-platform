const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import your existing server app
const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: true,
  credentials: true
}));

// Import all your existing routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const courseRoutes = require('./routes/courses');
const contentRoutes = require('./routes/content');
const videoRoutes = require('./routes/video');
const analyticsRoutes = require('./routes/analytics');
const dashboardRoutes = require('./routes/dashboard');
const chatRoutes = require('./routes/chat');
const forumRoutes = require('./routes/forum');
const announcementRoutes = require('./routes/announcements');
const trackingRoutes = require('./routes/tracking');
const tokenRoutes = require('./routes/tokens');
const utilityRoutes = require('./routes/utilities');
const webhookRoutes = require('./routes/webhooks');

// Import middleware
const authMiddleware = require('./middleware/authMiddleware');
const rateLimiter = require('./middleware/rateLimiter');
const auditLogger = require('./middleware/auditLogger');

// Apply middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(rateLimiter);
app.use(auditLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'EdTech Platform API is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/student', authMiddleware, studentRoutes);
app.use('/api/teacher', authMiddleware, teacherRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/content', authMiddleware, contentRoutes);
app.use('/api/video', authMiddleware, videoRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/forum', authMiddleware, forumRoutes);
app.use('/api/announcements', authMiddleware, announcementRoutes);
app.use('/api/tracking', authMiddleware, trackingRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/utilities', utilityRoutes);
app.use('/api/webhooks', webhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    },
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'API endpoint not found'
    },
    timestamp: new Date().toISOString()
  });
});

// Export the Express app as a Firebase Function
exports.api = functions.https.onRequest(app);