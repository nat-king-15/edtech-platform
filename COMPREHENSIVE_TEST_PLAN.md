# EdTech Platform - Comprehensive Testing Plan

## Overview

This document outlines a systematic approach to validate all functionality of the EdTech platform after recent fixes and improvements. The testing plan covers environment setup, authentication flows, page validation, API testing, real-time features, integrations, error handling, and documentation.

## Phase 1: Environment Setup & Health Checks

### Prerequisites
- Node.js 18+ installed
- npm package manager
- Firebase project configured
- Environment variables properly set

### Environment Variables Checklist

#### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FCM_VAPID_KEY=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
NEXT_PUBLIC_MUX_ENV_KEY=
NEXT_PUBLIC_ENVIRONMENT=development
```

#### Backend (.env)
```
PORT=5000
NODE_ENV=development
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
FIREBASE_DATABASE_URL=
FIREBASE_STORAGE_BUCKET=
JWT_SECRET=
JWT_EXPIRES_IN=7d
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
MUX_TOKEN_ID=
MUX_TOKEN_SECRET=
MUX_WEBHOOK_SECRET=
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
FCM_SERVER_KEY=
REDIS_URL=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Setup Verification Steps

1. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   - Verify Next.js starts on port 3000
   - Check for TypeScript compilation errors
   - Validate all dependencies resolve correctly

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   - Verify Express server starts on port 5000
   - Check database connection
   - Validate middleware initialization

3. **Health Check Endpoint**
   ```bash
   curl http://localhost:5000/api/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "timestamp": "2024-01-15T10:30:00Z",
     "services": {
       "database": "connected",
       "firebase": "connected",
       "redis": "connected"
     }
   }
   ```

## Phase 2: Authentication Flow Testing

### Test Matrix

| Test Case | Expected Result | Status |
|-----------|-----------------|---------|
| User Registration - Valid Data | Account created, verification email sent | ⏳ |
| User Registration - Duplicate Email | Error: Email already exists | ⏳ |
| User Registration - Invalid Email | Error: Invalid email format | ⏳ |
| User Login - Valid Credentials | JWT token returned, role-based redirect | ⏳ |
| User Login - Invalid Password | Error: Invalid credentials | ⏳ |
| User Login - Non-existent User | Error: User not found | ⏳ |
| Password Reset - Valid Email | Reset email sent | ⏳ |
| Password Reset - Invalid Email | Error: User not found | ⏳ |
| Token Refresh - Valid Token | New JWT token issued | ⏳ |
| Token Refresh - Expired Token | Error: Token expired | ⏳ |

### Role-Based Access Testing

#### Admin User Tests
- [ ] Access to `/admin/*` routes
- [ ] User management functionality
- [ ] Course creation and management
- [ ] Analytics dashboard access
- [ ] System configuration access

#### Teacher User Tests
- [ ] Access to `/teacher/*` routes
- [ ] Subject management
- [ ] Student assignment creation
- [ ] Live streaming setup
- [ ] Grade book access

#### Student User Tests
- [ ] Access to `/student/*` routes
- [ ] Course enrollment
- [ ] Assignment submission
- [ ] Progress tracking
- [ ] Payment processing

## Phase 3: Page-by-Page Validation

### Admin Pages

#### Analytics Dashboard (`/admin/analytics`)
- [ ] Page loads without errors
- [ ] Analytics data displays correctly
- [ ] Charts and graphs render properly
- [ ] Date range filters work
- [ ] Export functionality available

#### User Management (`/admin/users`)
- [ ] User list loads with pagination
- [ ] Search and filter functionality works
- [ ] User role changes update correctly
- [ ] Bulk operations function properly
- [ ] User profile editing works

#### Course Management (`/admin/courses`)
- [ ] Course creation form validates inputs
- [ ] Course list displays with proper status
- [ ] Course editing updates correctly
- [ ] Course deletion with confirmation
- [ ] Batch assignment to courses works

### Teacher Pages

#### Subject Management (`/teacher/subjects`)
- [ ] Subject list loads for assigned teacher
- [ ] Subject creation validates required fields
- [ ] Subject editing updates correctly
- [ ] Subject deletion with dependencies check
- [ ] Chapter management within subjects

#### Live Streaming (`/teacher/live-stream`)
- [ ] Stream setup interface loads
- [ ] Camera and microphone permissions
- [ ] Stream start/stop functionality
- [ ] Student attendance tracking
- [ ] Chat integration during stream

#### Student Management (`/teacher/students`)
- [ ] Student list for assigned batches
- [ ] Student progress tracking
- [ ] Assignment grading interface
- [ ] Communication tools work
- [ ] Performance analytics display

### Student Pages

#### Batch Dashboard (`/student/batches`)
- [ ] Enrolled batches display correctly
- [ ] Batch progress indicators work
- [ ] Upcoming classes show schedule
- [ ] Batch switching functionality
- [ ] Batch details load properly

#### Assignments (`/student/assignments`)
- [ ] Assignment list with due dates
- [ ] Assignment submission interface
- [ ] File upload functionality
- [ ] Submission confirmation
- [ ] Grade feedback display

#### Progress Tracking (`/student/progress`)
- [ ] Overall progress metrics
- [ ] Subject-wise progress breakdown
- [ ] Time spent analytics
- [ ] Achievement badges display
- [ ] Goal setting functionality

## Phase 4: API Endpoint Testing

### Authentication Routes

#### POST `/api/auth/register`
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "name": "Test User",
    "role": "student"
  }'
```

#### POST `/api/auth/login`
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }'
```

### Admin Routes (Require Admin Token)

#### GET `/api/admin/users`
```bash
curl -X GET http://localhost:5000/api/admin/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

#### GET `/api/admin/analytics`
```bash
curl -X GET http://localhost:5000/api/admin/analytics \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Teacher Routes (Require Teacher Token)

#### GET `/api/teacher/subjects`
```bash
curl -X GET http://localhost:5000/api/teacher/subjects \
  -H "Authorization: Bearer YOUR_TEACHER_TOKEN"
```

#### POST `/api/teacher/assignments`
```bash
curl -X POST http://localhost:5000/api/teacher/assignments \
  -H "Authorization: Bearer YOUR_TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Assignment",
    "description": "Test description",
    "dueDate": "2024-01-30",
    "batchId": "batch123"
  }'
```

### Student Routes (Require Student Token)

#### GET `/api/student/batches`
```bash
curl -X GET http://localhost:5000/api/student/batches \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN"
```

#### POST `/api/student/enrollments`
```bash
curl -X POST http://localhost:5000/api/student/enrollments \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "course123",
    "batchId": "batch123"
  }'
```

## Phase 5: Real-time Features Testing

### FCM Notifications

#### Test Notification Types
- [ ] New assignment notifications
- [ ] Class reminder notifications
- [ ] Grade update notifications
- [ ] System announcements
- [ ] Payment confirmations

#### Testing Steps
1. Enable browser notifications
2. Register FCM token
3. Trigger notification events
4. Verify notification delivery
5. Check notification click handling

### Socket.io Chat

#### Test Scenarios
- [ ] Real-time message delivery
- [ ] Typing indicators
- [ ] Message read receipts
- [ ] File sharing in chat
- [ ] Chat history persistence

#### Testing Commands
```javascript
// Connect to chat server
const socket = io('http://localhost:5000');

// Join room
socket.emit('join-room', { roomId: 'room123', userId: 'user123' });

// Send message
socket.emit('send-message', {
  roomId: 'room123',
  message: 'Test message',
  userId: 'user123'
});

// Receive message
socket.on('receive-message', (data) => {
  console.log('Message received:', data);
});
```

### Live Streaming

#### Test Components
- [ ] Stream initialization
- [ ] Video quality adaptation
- [ ] Audio synchronization
- [ ] Chat integration during stream
- [ ] Recording functionality

## Phase 6: Integration Testing

### Payment Flow Testing

#### Razorpay Integration
1. **Payment Creation**
   ```bash
   curl -X POST http://localhost:5000/api/payments/create \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 1000,
       "currency": "INR",
       "receipt": "receipt123"
     }'
   ```

2. **Payment Verification**
   ```bash
   curl -X POST http://localhost:5000/api/payments/verify \
     -H "Content-Type: application/json" \
     -d '{
       "razorpay_payment_id": "pay_123",
       "razorpay_order_id": "order_123",
       "razorpay_signature": "signature123"
     }'
   ```

3. **Webhook Testing**
   - Test payment success webhook
   - Test payment failure webhook
   - Test refund webhook
   - Verify signature validation

### Video Streaming Integration

#### Mux Video Testing
1. **Video Upload**
   ```bash
   curl -X POST http://localhost:5000/api/videos/upload \
     -H "Authorization: Bearer TOKEN" \
     -F "video=@test-video.mp4"
   ```

2. **Stream URL Generation**
   ```bash
   curl -X GET http://localhost:5000/api/videos/stream/VIDEO_ID \
     -H "Authorization: Bearer TOKEN"
   ```

3. **DRM Protection**
   - Verify token-based access
   - Test playback restrictions
   - Validate domain restrictions

### File Upload Testing

#### Test File Types
- [ ] PDF documents
- [ ] Image files (PNG, JPG)
- [ ] Video files (MP4)
- [ ] Audio files (MP3)
- [ ] Document files (DOC, DOCX)

#### Security Testing
- [ ] File size limits
- [ ] File type validation
- [ ] Malware scanning
- [ ] Secure storage URLs
- [ ] Access permission validation

## Phase 7: Error Handling Validation

### API Error Testing

#### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": []
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Test Error Scenarios
- [ ] Invalid authentication token
- [ ] Expired authentication token
- [ ] Insufficient permissions
- [ ] Resource not found
- [ ] Validation errors
- [ ] Rate limiting
- [ ] Database connection errors
- [ ] External service failures

### Frontend Error Boundaries

#### Test Error Cases
- [ ] Component rendering errors
- [ ] API call failures
- [ ] Network connectivity issues
- [ ] Browser compatibility issues
- [ ] Memory usage optimization

#### Error Recovery Testing
- [ ] Retry mechanisms
- [ ] Fallback components
- [ ] User-friendly error messages
- [ ] Logging and reporting
- [ ] Graceful degradation

## Phase 8: Performance Testing

### Load Testing

#### API Performance
- [ ] Response time under normal load
- [ ] Response time under peak load
- [ ] Database query optimization
- [ ] Caching effectiveness
- [ ] Rate limiting behavior

#### Frontend Performance
- [ ] Page load times
- [ ] Bundle size optimization
- [ ] Image loading optimization
- [ ] Lazy loading effectiveness
- [ ] Memory usage monitoring

### Stress Testing

#### Concurrent User Testing
- [ ] 10 concurrent users
- [ ] 50 concurrent users
- [ ] 100 concurrent users
- [ ] Database connection limits
- [ ] Server resource usage

## Phase 9: Security Testing

### Authentication Security

#### Token Security
- [ ] JWT token expiration
- [ ] Token refresh mechanism
- [ ] Token invalidation on logout
- [ ] Secure token storage
- [ ] Cross-site request forgery protection

#### Input Validation
- [ ] SQL injection prevention
- [ ] XSS attack prevention
- [ ] CSRF token validation
- [ ] File upload security
- [ ] API parameter sanitization

### Data Protection

#### Privacy Testing
- [ ] Personal data encryption
- [ ] Data anonymization
- [ ] GDPR compliance
- [ ] Data retention policies
- [ ] User consent management

## Phase 10: Documentation & Reporting

### Test Results Documentation

#### Success Criteria
- [ ] All test cases pass
- [ ] No critical bugs found
- [ ] Performance meets requirements
- [ ] Security vulnerabilities addressed
- [ ] User experience validated

#### Issue Reporting
- [ ] Bug severity classification
- [ ] Reproduction steps documented
- [ ] Expected vs actual behavior
- [ ] Screenshots/screen recordings
- [ ] Environment details

### Recommendations

#### Immediate Actions
- [ ] Fix critical security issues
- [ ] Resolve performance bottlenecks
- [ ] Address user experience issues
- [ ] Update documentation
- [ ] Deploy to staging environment

#### Long-term Improvements
- [ ] Implement automated testing
- [ ] Add monitoring and alerting
- [ ] Optimize database queries
- [ ] Enhance security measures
- [ ] Improve error handling

## Test Execution Schedule

### Week 1: Environment & Authentication
- Day 1-2: Environment setup and health checks
- Day 3-4: Authentication flow testing
- Day 5: Role-based access validation

### Week 2: Page Validation & API Testing
- Day 1-2: Admin page validation
- Day 3-4: Teacher page validation
- Day 5: Student page validation

### Week 3: Real-time Features & Integrations
- Day 1-2: FCM notification testing
- Day 3-4: Socket.io chat testing
- Day 5: Payment and video integration testing

### Week 4: Performance & Security
- Day 1-2: Performance testing
- Day 3-4: Security testing
- Day 5: Documentation and reporting

## Test Tools & Resources

### Required Tools
- Postman or Insomnia for API testing
- Browser developer tools for frontend debugging
- curl for command-line API testing
- WebSocket testing tools for real-time features
- Performance testing tools (optional)

### Test Data
- Sample user accounts (admin, teacher, student)
- Test course materials
- Sample assignments and submissions
- Test payment information (sandbox)
- Sample video files for streaming

### Test Environments
- Local development environment
- Staging environment (if available)
- Production environment (final validation)

## Conclusion

This comprehensive testing plan ensures thorough validation of the EdTech platform's functionality, security, and performance. Execute all test phases systematically and document any issues discovered for prompt resolution.

The testing should be performed by team members with appropriate role access and should include both automated and manual testing approaches where applicable.

Regular updates to this test plan should be made as new features are added or existing functionality is modified.