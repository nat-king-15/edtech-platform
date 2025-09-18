# EdTech Platform Setup Guide

## 🐛 **Bug Fixes Applied**

This document outlines the major bugs and issues that have been identified and fixed in your EdTech platform.

### **Critical Issues Fixed:**

### 1. **Backend Issues**
- ✅ Fixed assignment service date validation (now allows proper future dates)
- ✅ Fixed Firestore query ordering issues (removed composite index requirements)
- ✅ Fixed file upload signed URL destructuring error
- ✅ Fixed late penalty calculation in grading system
- ✅ Fixed quiz service variable reference bug (`gradingDetails` → `gradingResult`)
- ✅ Added proper database reference initialization

### 2. **Frontend TypeScript Issues**
- ✅ Fixed empty interface violations in UI components
- ✅ Replaced `any` types with proper TypeScript interfaces
- ✅ Added proper type definitions for API responses
- ✅ Fixed unused import warnings

### 3. **Environment Configuration**
- ✅ Created environment variable templates (.env.example files)
- ✅ Added proper CORS configuration for development
- ✅ Fixed Next.js API proxy configuration

### 4. **Test Suite Fixes**
- ✅ Fixed assignment test date validation
- ✅ Updated test expectations to match corrected error messages
- ✅ Fixed mock configurations for proper test execution

## 🚀 **Setup Instructions**

### **Prerequisites**
- Node.js (v16 or higher)
- npm or yarn package manager
- Firebase project with Firestore enabled
- Razorpay account (for payments)
- Mux account (for video streaming)

### **Backend Setup**

1. **Install dependencies:**
```bash
cd backend
npm install
```

2. **Environment Configuration:**
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your actual values
```

Required environment variables:
```env
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com/
FIREBASE_STORAGE_BUCKET=your-project.appspot.com

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# External Services
MUX_ACCESS_TOKEN=your-mux-access-token
MUX_SECRET_KEY=your-mux-secret-key
RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_KEY_SECRET=your-razorpay-secret
```

3. **Start the backend server:**
```bash
npm run dev  # Development mode
# or
npm start   # Production mode
```

### **Frontend Setup**

1. **Install dependencies:**
```bash
cd frontend
npm install
```

2. **Environment Configuration:**
```bash
# Copy the example environment file
cp .env.example .env.local

# Edit .env.local with your actual values
```

Required environment variables:
```env
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000

# Firebase Client Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

3. **Start the frontend:**
```bash
npm run dev
```

### **Firebase Setup**

1. **Create Firestore Collections:**
   - `users` - User profiles and roles
   - `courses` - Course definitions
   - `batches` - Batch/class information
   - `subjects` - Subject details
   - `assignments` - Assignment data
   - `submissions` - Student submissions
   - `quizzes` - Quiz definitions
   - `quizSubmissions` - Quiz results
   - `enrollments` - Student enrollments
   - `notifications` - User notifications

2. **Set up Firestore Rules:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Allow admins to manage all data
    match /{document=**} {
      allow read, write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Teachers can manage their subjects and batches
    match /subjects/{subjectId} {
      allow read, write: if request.auth != null &&
        resource.data.teacherId == request.auth.uid;
    }
    
    // Students can read enrolled content
    match /enrollments/{enrollmentId} {
      allow read: if request.auth != null &&
        resource.data.studentId == request.auth.uid;
    }
  }
}
```

## 🧪 **Testing**

### **Run Backend Tests:**
```bash
cd backend
npm test
```

### **Run Frontend Linting:**
```bash
cd frontend
npm run lint
```

## 🔧 **Development Scripts**

### **Backend:**
- `npm run dev` - Start development server with nodemon
- `npm test` - Run test suite
- `npm test:watch` - Run tests in watch mode
- `npm test:coverage` - Generate coverage report

### **Frontend:**
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## 📝 **Key Improvements Made**

### **Code Quality:**
- Fixed TypeScript strict mode violations
- Improved error handling and validation
- Added proper type definitions
- Removed unused imports and variables

### **Performance:**
- Optimized Firestore queries (removed problematic ordering)
- Added proper caching strategies
- Improved bundle splitting in Next.js

### **Security:**
- Enhanced input validation
- Improved authentication middleware
- Added rate limiting configurations
- Fixed CORS settings for development

### **Testing:**
- Fixed failing test cases
- Updated test data to match validation rules
- Improved mock configurations
- Added proper error case testing

## 🚨 **Known Limitations & TODOs**

### **Database Indexes:**
You'll need to create composite indexes in Firestore for:
- `assignments`: `(batchId, status, dueDate)`
- `submissions`: `(assignmentId, studentId, submittedAt)`
- `quizSubmissions`: `(quizId, studentId, submittedAt)`

### **Production Considerations:**
- Set up proper environment variables for production
- Configure Firebase security rules
- Set up monitoring and logging
- Configure CDN for static assets
- Set up backup strategies

### **Feature Completions:**
- Email notification system needs SMTP configuration
- Real-time chat needs Socket.io server setup
- Payment webhook verification needs proper testing
- Video DRM protection needs Mux configuration

## 🆘 **Troubleshooting**

### **Common Issues:**

1. **Firebase Connection Errors:**
   - Verify environment variables are correctly set
   - Check Firebase project permissions
   - Ensure service account key is valid

2. **CORS Errors:**
   - Verify NEXT_PUBLIC_API_URL points to correct backend
   - Check backend CORS configuration
   - Ensure both servers are running

3. **Build Errors:**
   - Clear node_modules and reinstall dependencies
   - Check TypeScript configuration
   - Verify all environment variables are set

4. **Test Failures:**
   - Ensure all mocks are properly configured
   - Check test data matches validation rules
   - Verify database connections in tests

## 📞 **Support**

If you encounter any issues:
1. Check the console for error messages
2. Verify environment variables are correctly set
3. Ensure all services (Firebase, Mux, Razorpay) are properly configured
4. Check network connectivity and firewall settings

The platform should now run without critical errors. All major bugs have been identified and fixed!