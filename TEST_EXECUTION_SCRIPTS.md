# EdTech Platform - Test Execution Scripts

## Overview
This document contains executable scripts and commands for comprehensive testing of the EdTech platform, covering unit tests, integration tests, API tests, and end-to-end testing scenarios.

## Environment Setup Scripts

### Prerequisites Check Script
```bash
#!/bin/bash
# prerequisites-check.sh

echo "=== EdTech Platform Prerequisites Check ==="

# Check Node.js version
node_version=$(node --version)
echo "Node.js Version: $node_version"
if [[ "$node_version" < "v18.0.0" ]]; then
    echo "❌ Node.js 18+ required"
    exit 1
else
    echo "✅ Node.js version OK"
fi

# Check npm version
npm_version=$(npm --version)
echo "npm Version: $npm_version"

# Check if Firebase CLI is installed
if command -v firebase &> /dev/null; then
    echo "✅ Firebase CLI installed"
    firebase --version
else
    echo "⚠️  Firebase CLI not found - install with: npm install -g firebase-tools"
fi

# Check environment files
if [ -f "frontend/.env.local" ]; then
    echo "✅ Frontend environment file found"
else
    echo "❌ Frontend .env.local missing"
fi

if [ -f "backend/.env" ]; then
    echo "✅ Backend environment file found"
else
    echo "❌ Backend .env missing"
fi

echo "=== Prerequisites Check Complete ==="
```

### Environment Setup Script
```bash
#!/bin/bash
# setup-environment.sh

echo "=== Setting up EdTech Platform Environment ==="

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install
if [ $? -ne 0 ]; then
    echo "❌ Frontend dependency installation failed"
    exit 1
fi

# Install backend dependencies
echo "Installing backend dependencies..."
cd ../backend
npm install
if [ $? -ne 0 ]; then
    echo "❌ Backend dependency installation failed"
    exit 1
fi

# Run database migrations/setup
echo "Setting up database..."
npm run setup:db
if [ $? -ne 0 ]; then
    echo "⚠️  Database setup failed - manual intervention required"
fi

echo "✅ Environment setup complete"
```

## Frontend Test Scripts

### Frontend Unit Tests
```bash
#!/bin/bash
# frontend-unit-tests.sh

echo "=== Running Frontend Unit Tests ==="
cd frontend

# Run all unit tests with coverage
npm run test:unit -- --coverage --watchAll=false

# Run specific component tests
npm run test:unit -- --testPathPattern="components" --coverage

# Run utility function tests
npm run test:unit -- --testPathPattern="utils" --coverage

# Generate coverage report
echo "Generating coverage report..."
npm run test:coverage
```

### Frontend Integration Tests
```bash
#!/bin/bash
# frontend-integration-tests.sh

echo "=== Running Frontend Integration Tests ==="
cd frontend

# Run integration tests
npm run test:integration

# Run API integration tests
npm run test:api-integration

# Run state management tests
npm run test:state-management
```

### Frontend E2E Tests
```bash
#!/bin/bash
# frontend-e2e-tests.sh

echo "=== Running Frontend E2E Tests ==="
cd frontend

# Start development server in background
npm run dev &
SERVER_PID=$!

# Wait for server to start
sleep 10

# Run Playwright E2E tests
npm run test:e2e

# Run specific E2E test suites
npm run test:e2e -- --grep="authentication"
npm run test:e2e -- --grep="course-management"
npm run test:e2e -- --grep="payment-flow"

# Stop development server
kill $SERVER_PID
```

## Backend Test Scripts

### Backend Unit Tests
```bash
#!/bin/bash
# backend-unit-tests.sh

echo "=== Running Backend Unit Tests ==="
cd backend

# Run all unit tests with coverage
npm run test:unit -- --coverage

# Run service layer tests
npm run test:services -- --coverage

# Run middleware tests
npm run test:middleware -- --coverage

# Run utility function tests
npm run test:utils -- --coverage

# Generate coverage report
echo "Generating coverage report..."
npm run test:coverage
```

### Backend API Tests
```bash
#!/bin/bash
# backend-api-tests.sh

echo "=== Running Backend API Tests ==="
cd backend

# Start test server
npm run test:server &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Run API integration tests
npm run test:api

# Run authentication tests
npm run test:auth

# Run authorization tests
npm run test:authorization

# Run validation tests
npm run test:validation

# Stop test server
kill $SERVER_PID
```

### Database Tests
```bash
#!/bin/bash
# backend-database-tests.sh

echo "=== Running Database Tests ==="
cd backend

# Run Firestore integration tests
npm run test:firestore

# Run data validation tests
npm run test:data-validation

# Run migration tests
npm run test:migrations

# Clean up test data
npm run test:cleanup
```

## API Test Scripts

### API Health Check
```bash
#!/bin/bash
# api-health-check.sh

echo "=== API Health Check ==="

BASE_URL="http://localhost:5000/api"

# Test health endpoint
response=$(curl -s -w "%{http_code}" $BASE_URL/health)
http_code=${response: -3}

if [ "$http_code" == "200" ]; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed: $http_code"
fi

# Test authentication endpoints
echo "Testing authentication endpoints..."
curl -s -X POST $BASE_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  -w "Login: %{http_code}\n"

# Test protected endpoints
echo "Testing protected endpoints..."
curl -s -X GET $BASE_URL/admin/dashboard \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -w "Admin Dashboard: %{http_code}\n"
```

### API Load Testing
```bash
#!/bin/bash
# api-load-test.sh

echo "=== API Load Testing ==="

# Install load testing tool if not present
if ! command -v artillery &> /dev/null; then
    echo "Installing Artillery for load testing..."
    npm install -g artillery
fi

# Run load tests
echo "Running load tests..."
artillery run tests/load/api-load-test.yml

# Run specific endpoint load tests
artillery run tests/load/auth-load-test.yml
artillery run tests/load/course-load-test.yml
artillery run tests/load/video-stream-load-test.yml
```

## Integration Test Scripts

### Full Integration Test Suite
```bash
#!/bin/bash
# full-integration-tests.sh

echo "=== Running Full Integration Test Suite ==="

# Start all services
echo "Starting services..."
docker-compose up -d

# Wait for services to be ready
sleep 30

# Run frontend tests
echo "Running frontend integration tests..."
cd frontend && npm run test:integration

# Run backend tests
echo "Running backend integration tests..."
cd ../backend && npm run test:integration

# Run end-to-end tests
echo "Running end-to-end tests..."
cd ../frontend && npm run test:e2e

# Run security tests
echo "Running security tests..."
cd ../backend && npm run test:security

# Generate combined report
echo "Generating test report..."
cd .. && npm run test:report

# Stop services
echo "Stopping services..."
docker-compose down

echo "=== Integration Test Suite Complete ==="
```

### Database Integration Tests
```bash
#!/bin/bash
# database-integration-tests.sh

echo "=== Database Integration Tests ==="
cd backend

# Test database connections
npm run test:db-connection

# Test data integrity
npm run test:data-integrity

# Test transaction handling
npm run test:transactions

# Test backup and restore
npm run test:backup-restore

# Test concurrent operations
npm run test:concurrent-ops
```

## Performance Test Scripts

### Frontend Performance Testing
```bash
#!/bin/bash
# frontend-performance-tests.sh

echo "=== Frontend Performance Tests ==="
cd frontend

# Run Lighthouse performance audits
npm run test:lighthouse

# Run bundle analysis
npm run analyze

# Run performance benchmarks
npm run test:performance

# Generate performance report
npm run test:perf-report
```

### Backend Performance Testing
```bash
#!/bin/bash
# backend-performance-tests.sh

echo "=== Backend Performance Tests ==="
cd backend

# Run performance benchmarks
npm run test:benchmarks

# Test database query performance
npm run test:query-performance

# Test API response times
npm run test:api-performance

# Test memory usage
npm run test:memory-usage

# Test concurrent user handling
npm run test:concurrent-users
```

## Security Test Scripts

### Security Scanning
```bash
#!/bin/bash
# security-scan.sh

echo "=== Security Scanning ==="

# Install security scanning tools
npm install -g retire
npm install -g snyk

# Scan for vulnerable dependencies
echo "Scanning for vulnerable dependencies..."
retire --path frontend/
retire --path backend/

# Run Snyk security test
echo "Running Snyk security test..."
snyk test --file=frontend/package.json
snyk test --file=backend/package.json

# Run custom security tests
cd backend && npm run test:security
```

### Penetration Testing
```bash
#!/bin/bash
# penetration-test.sh

echo "=== Penetration Testing ==="

# Test for SQL injection vulnerabilities
cd backend && npm run test:sql-injection

# Test for XSS vulnerabilities
cd frontend && npm run test:xss

# Test for CSRF vulnerabilities
cd backend && npm run test:csrf

# Test authentication bypass
cd backend && npm run test:auth-bypass

# Test authorization bypass
cd backend && npm run test:authorization-bypass
```

## Real-time Features Test Scripts

### WebSocket Testing
```bash
#!/bin/bash
# websocket-tests.sh

echo "=== WebSocket Tests ==="
cd backend

# Test WebSocket connections
npm run test:websocket-connection

# Test real-time messaging
npm run test:realtime-messaging

# Test broadcast functionality
npm run test:broadcast

# Test connection limits
npm run test:connection-limits

# Test reconnection handling
npm run test:reconnection
```

### FCM Notification Testing
```bash
#!/bin/bash
# fcm-notification-tests.sh

echo "=== FCM Notification Tests ==="
cd backend

# Test FCM token management
npm run test:fcm-tokens

# Test notification delivery
npm run test:notification-delivery

# Test notification scheduling
npm run test:notification-scheduling

# Test batch notifications
npm run test:batch-notifications
```

## Continuous Integration Scripts

### Pre-commit Testing
```bash
#!/bin/bash
# pre-commit-tests.sh

echo "=== Pre-commit Tests ==="

# Run linting
echo "Running linting..."
cd frontend && npm run lint
cd ../backend && npm run lint

# Run unit tests
echo "Running unit tests..."
cd frontend && npm run test:unit -- --watchAll=false
cd ../backend && npm run test:unit -- --watchAll=false

# Run type checking
echo "Running type checking..."
cd frontend && npm run type-check

# Run security checks
echo "Running security checks..."
cd backend && npm run test:security-quick

echo "✅ Pre-commit tests passed"
```

### Full CI Pipeline
```bash
#!/bin/bash
# ci-pipeline.sh

echo "=== CI Pipeline ==="

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf frontend/build backend/dist

# Install dependencies
echo "Installing dependencies..."
cd frontend && npm ci
cd ../backend && npm ci

# Run all tests
echo "Running test suite..."
./run-all-tests.sh

# Build applications
echo "Building applications..."
cd frontend && npm run build
cd ../backend && npm run build

# Generate reports
echo "Generating reports..."
npm run generate-reports

# Upload coverage
echo "Uploading coverage reports..."
npm run upload-coverage

echo "=== CI Pipeline Complete ==="
```

## Test Data Management Scripts

### Seed Test Data
```bash
#!/bin/bash
# seed-test-data.sh

echo "=== Seeding Test Data ==="
cd backend

# Create test users
npm run seed:users

# Create test courses
npm run seed:courses

# Create test batches
npm run seed:batches

# Create test assignments
npm run seed:assignments

# Create test notifications
npm run seed:notifications

echo "✅ Test data seeded successfully"
```

### Clean Test Data
```bash
#!/bin/bash
# clean-test-data.sh

echo "=== Cleaning Test Data ==="
cd backend

# Remove test users
npm run cleanup:users

# Remove test courses
npm run cleanup:courses

# Remove test data
npm run cleanup:all

echo "✅ Test data cleaned successfully"
```

## Report Generation Scripts

### Generate Test Reports
```bash
#!/bin/bash
# generate-test-reports.sh

echo "=== Generating Test Reports ==="

# Generate frontend test report
cd frontend
npm run test:report

# Generate backend test report
cd ../backend
npm run test:report

# Generate combined report
cd ..
npm run test:combined-report

# Generate coverage badges
npm run generate-badges

echo "✅ Test reports generated"
```

### Monitor Test Trends
```bash
#!/bin/bash
# monitor-test-trends.sh

echo "=== Monitoring Test Trends ==="

# Collect test metrics
cd backend && npm run test:metrics

# Generate trend analysis
npm run test:trend-analysis

# Generate performance trends
npm run test:performance-trends

# Send notifications if needed
npm run test:notifications

echo "✅ Test trend monitoring complete"
```

## Usage Instructions

1. **Make scripts executable:**
   ```bash
   chmod +x *.sh
   ```

2. **Run individual test suites:**
   ```bash
   ./frontend-unit-tests.sh
   ./backend-api-tests.sh
   ./full-integration-tests.sh
   ```

3. **Run complete test suite:**
   ```bash
   ./run-all-tests.sh
   ```

4. **Monitor test execution:**
   ```bash
   tail -f logs/test-execution.log
   ```

5. **View test reports:**
   ```bash
   open reports/test-report.html
   ```

## Notes

- All scripts should be run from the project root directory
- Ensure environment variables are properly configured before running tests
- Some tests require services to be running (database, Redis, etc.)
- Review test logs for detailed failure information
- Update test data scripts as needed for your specific test scenarios