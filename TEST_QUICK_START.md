# EdTech Platform - Testing Quick Start Guide

## Overview

This guide provides step-by-step instructions for running comprehensive tests on the EdTech platform. Follow these steps to validate all functionality after recent fixes.

## Prerequisites

### Environment Setup
1. **Node.js 18+** installed
2. **npm** package manager
3. **Git** for version control
4. **Modern web browser** (Chrome, Firefox, Safari, Edge)

### Project Setup
```bash
# Clone the repository (if not already done)
git clone [repository-url]
cd edtech

# Install dependencies
cd frontend && npm install
cd ../backend && npm install
```

## Step 1: Environment Configuration

### Backend Environment Variables
Create `backend/.env` file with:
```env
PORT=5000
NODE_ENV=development
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
JWT_SECRET=your-jwt-secret
RAZORPAY_KEY_ID=your-razorpay-key
RAZORPAY_KEY_SECRET=your-razorpay-secret
MUX_TOKEN_ID=your-mux-token
MUX_TOKEN_SECRET=your-mux-secret
```

### Frontend Environment Variables
Create `frontend/.env.local` file with:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_RAZORPAY_KEY_ID=your-razorpay-key
NEXT_PUBLIC_ENVIRONMENT=development
```

## Step 2: Start the Applications

### Start Backend Server
```bash
cd backend
npm run dev
```
- Backend should start on http://localhost:5000
- Check console for any startup errors

### Start Frontend Server
```bash
cd frontend
npm run dev
```
- Frontend should start on http://localhost:3000
- Check for TypeScript compilation errors

## Step 3: Run Automated Tests

### Install Test Dependencies
```bash
# In the root directory (c:\Users\natra\edtech)
npm install axios chalk
```

### Run Full Test Suite
```bash
node test-execution.js
```

### Run Specific Test Categories
```bash
# Health check only
node test-execution.js health

# Authentication tests only
node test-execution.js auth

# API tests only
node test-execution.js api

# Frontend tests only
node test-execution.js frontend
```

## Step 4: Manual Testing Checklist

### Authentication Flow
1. **Registration Test**
   - Navigate to http://localhost:3000/register
   - Create test accounts for admin, teacher, and student roles
   - Verify email validation and password requirements

2. **Login Test**
   - Navigate to http://localhost:3000/login
   - Test login with each user role
   - Verify role-based redirects work correctly

### Dashboard Testing
1. **Admin Dashboard**
   - Login as admin user
   - Navigate to http://localhost:3000/admin
   - Verify analytics display correctly
   - Test user management functionality

2. **Teacher Dashboard**
   - Login as teacher user
   - Navigate to http://localhost:3000/teacher
   - Verify subject management works
   - Test assignment creation

3. **Student Dashboard**
   - Login as student user
   - Navigate to http://localhost:3000/student
   - Verify course enrollment works
   - Test assignment submission

### Key Features to Test
- **Video Player**: Test video playback, progress tracking, DRM protection
- **Live Streaming**: Test stream setup, chat integration, attendance tracking
- **Chat System**: Test real-time messaging, file sharing, notifications
- **Payment Flow**: Test enrollment payments, receipt generation, refunds
- **Mobile Responsiveness**: Test on different screen sizes and devices

## Step 5: Performance Testing

### Browser Developer Tools
1. **Network Tab**
   - Check API response times
   - Verify no failed requests
   - Monitor payload sizes

2. **Performance Tab**
   - Measure page load times
   - Check for memory leaks
   - Monitor CPU usage

3. **Console Tab**
   - Check for JavaScript errors
   - Verify no warning messages
   - Monitor API responses

### Load Testing (Optional)
```bash
# Install load testing tool
npm install -g artillery

# Run load test (create load-test.yml first)
artillery run load-test.yml
```

## Step 6: Security Testing

### Authentication Security
- Test JWT token expiration
- Verify rate limiting works
- Check for XSS vulnerabilities
- Test SQL injection prevention

### Data Protection
- Verify HTTPS enforcement
- Check input validation
- Test file upload restrictions
- Validate API permissions

## Step 7: Accessibility Testing

### Automated Tools
```bash
# Install accessibility testing tools
npm install -g axe-core lighthouse

# Run Lighthouse audit
lighthouse http://localhost:3000 --chrome-flags="--headless"
```

### Manual Checks
- Test keyboard navigation
- Verify screen reader compatibility
- Check color contrast ratios
- Test with browser zoom at 200%

## Step 8: Document Results

### Create Test Report
1. Use the `TEST_RESULTS_TEMPLATE.md` file
2. Fill in test execution details
3. Document all issues found
4. Include screenshots of problems
5. Add performance metrics

### Issue Tracking
For each issue found:
1. Create a detailed bug report
2. Include reproduction steps
3. Add screenshots/videos
4. Assign priority level
5. Tag with appropriate labels

## Common Issues & Solutions

### Backend Issues
- **Port 5000 already in use**: Change PORT in .env file
- **Firebase connection failed**: Verify Firebase credentials
- **JWT errors**: Check JWT_SECRET configuration

### Frontend Issues
- **Build errors**: Check TypeScript compilation
- **API connection failed**: Verify NEXT_PUBLIC_API_URL
- **Missing environment variables**: Check .env.local file

### Database Issues
- **Connection refused**: Verify Firebase project configuration
- **Permission denied**: Check Firestore security rules
- **Data not loading**: Verify database indexes

## Test Data

### Sample Test Users
```javascript
// Admin user
{
  email: 'admin@test.com',
  password: 'Admin123!@#',
  role: 'admin'
}

// Teacher user
{
  email: 'teacher@test.com',
  password: 'Teacher123!@#',
  role: 'teacher'
}

// Student user
{
  email: 'student@test.com',
  password: 'Student123!@#',
  role: 'student'
}
```

### Test Files
- **Video**: Use small MP4 files (under 50MB) for testing
- **Documents**: Use PDF files for assignment submissions
- **Images**: Use JPG/PNG files for profile pictures

## Success Criteria

### All Tests Pass When:
- ✅ No critical security vulnerabilities
- ✅ All API endpoints respond correctly
- ✅ Frontend loads without errors
- ✅ Authentication works for all roles
- ✅ Core features function properly
- ✅ Performance meets requirements
- ✅ Mobile responsiveness works
- ✅ Accessibility standards met

### Ready for Production:
- All critical issues resolved
- Performance benchmarks achieved
- Security audit completed
- User acceptance testing passed
- Documentation updated
- Deployment plan approved

## Next Steps

1. **Fix Issues**: Address all critical and major issues found
2. **Regression Testing**: Re-test fixed functionality
3. **Performance Optimization**: Optimize based on test results
4. **Security Review**: Conduct final security assessment
5. **User Acceptance**: Get stakeholder approval
6. **Deployment**: Deploy to production environment

## Support

### Getting Help
- Check existing documentation in `/docs` folder
- Review API documentation at `/api/docs`
- Check browser console for error messages
- Review server logs for backend issues

### Additional Resources
- [COMPREHENSIVE_TEST_PLAN.md](./COMPREHENSIVE_TEST_PLAN.md)
- [MANUAL_TESTING_CHECKLIST.md](./MANUAL_TESTING_CHECKLIST.md)
- [TEST_RESULTS_TEMPLATE.md](./TEST_RESULTS_TEMPLATE.md)
- [BUGFIX_REPORT.md](./BUGFIX_REPORT.md)

---

**Remember**: Testing is an iterative process. Run tests frequently during development and always before major releases. Document everything and maintain high quality standards.