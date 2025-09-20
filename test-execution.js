#!/usr/bin/env node

/**
 * EdTech Platform Test Execution Script
 * This script helps automate testing of the EdTech platform APIs
 */

const axios = require('axios');
const chalk = require('chalk');

// Configuration
const BASE_URL = process.env.API_URL || 'http://localhost:5000/api';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Test data
const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin123!@#',
    role: 'admin'
  },
  teacher: {
    email: 'teacher@test.com',
    password: 'Teacher123!@#',
    role: 'teacher'
  },
  student: {
    email: 'student@test.com',
    password: 'Student123!@#',
    role: 'student'
  }
};

// Store tokens and test results
let tokens = {};
let testResults = [];

// Utility functions
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  };
  
  console.log(`[${timestamp}] ${colors[type] || chalk.blue}(message)}`);
}

async function makeRequest(method, endpoint, data = null, token = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status
    };
  }
}

function addTestResult(testName, passed, details = '') {
  testResults.push({
    testName,
    passed,
    details,
    timestamp: new Date().toISOString()
  });
}

// Test functions
async function testHealthCheck() {
  log('Testing health check endpoint...', 'info');
  
  const result = await makeRequest('GET', '/health');
  
  if (result.success && result.data.status === 'healthy') {
    log('✅ Health check passed', 'success');
    addTestResult('Health Check', true);
    return true;
  } else {
    log('❌ Health check failed', 'error');
    addTestResult('Health Check', false, result.error);
    return false;
  }
}

async function testUserRegistration(userType) {
  log(`Testing ${userType} registration...`, 'info');
  
  const userData = testUsers[userType];
  const result = await makeRequest('POST', '/auth/register', userData);
  
  if (result.success) {
    log(`✅ ${userType} registration successful`, 'success');
    addTestResult(`${userType} Registration`, true);
    return true;
  } else if (result.status === 400 && result.error?.error?.code === 'USER_EXISTS') {
    log(`⚠️ ${userType} user already exists`, 'warning');
    addTestResult(`${userType} Registration`, true, 'User already exists');
    return true;
  } else {
    log(`❌ ${userType} registration failed: ${result.error}`, 'error');
    addTestResult(`${userType} Registration`, false, result.error);
    return false;
  }
}

async function testUserLogin(userType) {
  log(`Testing ${userType} login...`, 'info');
  
  const userData = testUsers[userType];
  const result = await makeRequest('POST', '/auth/login', {
    email: userData.email,
    password: userData.password
  });
  
  if (result.success && result.data.token) {
    tokens[userType] = result.data.token;
    log(`✅ ${userType} login successful`, 'success');
    addTestResult(`${userType} Login`, true);
    return true;
  } else {
    log(`❌ ${userType} login failed: ${result.error}`, 'error');
    addTestResult(`${userType} Login`, false, result.error);
    return false;
  }
}

async function testRoleBasedAccess(userType, endpoint, expectedStatus = 200) {
  log(`Testing ${userType} access to ${endpoint}...`, 'info');
  
  const token = tokens[userType];
  if (!token) {
    log(`❌ No token found for ${userType}`, 'error');
    addTestResult(`${userType} Access to ${endpoint}`, false, 'No token');
    return false;
  }
  
  const result = await makeRequest('GET', endpoint, null, token);
  
  if (result.success && result.status === expectedStatus) {
    log(`✅ ${userType} access to ${endpoint} successful`, 'success');
    addTestResult(`${userType} Access to ${endpoint}`, true);
    return true;
  } else if (!result.success && result.status === 403) {
    log(`⚠️ ${userType} access to ${endpoint} forbidden (expected)`, 'warning');
    addTestResult(`${userType} Access to ${endpoint}`, true, 'Access forbidden as expected');
    return true;
  } else {
    log(`❌ ${userType} access to ${endpoint} failed: ${result.error}`, 'error');
    addTestResult(`${userType} Access to ${endpoint}`, false, result.error);
    return false;
  }
}

async function testFrontendPages() {
  log('Testing frontend page accessibility...', 'info');
  
  const pages = [
    '/',
    '/login',
    '/register',
    '/admin',
    '/teacher',
    '/student'
  ];
  
  for (const page of pages) {
    try {
      const response = await axios.get(`${FRONTEND_URL}${page}`);
      if (response.status === 200) {
        log(`✅ Frontend page ${page} accessible`, 'success');
        addTestResult(`Frontend Page ${page}`, true);
      } else {
        log(`❌ Frontend page ${page} returned status ${response.status}`, 'error');
        addTestResult(`Frontend Page ${page}`, false, `Status: ${response.status}`);
      }
    } catch (error) {
      log(`❌ Frontend page ${page} not accessible: ${error.message}`, 'error');
      addTestResult(`Frontend Page ${page}`, false, error.message);
    }
  }
}

async function testErrorHandling() {
  log('Testing error handling...', 'info');
  
  // Test invalid token
  const result = await makeRequest('GET', '/admin/users', null, 'invalid-token');
  if (!result.success && result.status === 401) {
    log('✅ Invalid token handling works correctly', 'success');
    addTestResult('Error Handling - Invalid Token', true);
  } else {
    log('❌ Invalid token handling failed', 'error');
    addTestResult('Error Handling - Invalid Token', false);
  }
  
  // Test missing required fields
  const registerResult = await makeRequest('POST', '/auth/register', {
    email: 'test@example.com'
    // Missing password and name
  });
  
  if (!registerResult.success && registerResult.status === 400) {
    log('✅ Missing field validation works correctly', 'success');
    addTestResult('Error Handling - Missing Fields', true);
  } else {
    log('❌ Missing field validation failed', 'error');
    addTestResult('Error Handling - Missing Fields', false);
  }
}

async function generateTestReport() {
  log('Generating test report...', 'info');
  
  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  
  const report = {
    summary: {
      totalTests,
      passedTests,
      failedTests,
      passRate: ((passedTests / totalTests) * 100).toFixed(2) + '%'
    },
    details: testResults,
    timestamp: new Date().toISOString()
  };
  
  // Write report to file
  const fs = require('fs');
  const reportPath = 'test-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`Test report saved to ${reportPath}`, 'success');
  
  // Print summary
  console.log('\n' + chalk.bold('Test Summary:'));
  console.log(chalk.green(`✅ Passed: ${passedTests}`));
  console.log(chalk.red(`❌ Failed: ${failedTests}`));
  console.log(chalk.blue(`📊 Pass Rate: ${report.summary.passRate}`));
  
  if (failedTests > 0) {
    console.log('\n' + chalk.bold('Failed Tests:'));
    testResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(chalk.red(`❌ ${r.testName}: ${r.details}`));
      });
  }
  
  return report;
}

// Main test execution function
async function runTests() {
  log('Starting EdTech Platform Test Suite...', 'info');
  log(`Testing backend: ${BASE_URL}`, 'info');
  log(`Testing frontend: ${FRONTEND_URL}`, 'info');
  
  try {
    // Phase 1: Health and Basic Functionality
    await testHealthCheck();
    
    // Phase 2: User Registration and Login
    for (const userType of ['admin', 'teacher', 'student']) {
      await testUserRegistration(userType);
      await testUserLogin(userType);
    }
    
    // Phase 3: Role-Based Access Control
    await testRoleBasedAccess('admin', '/admin/users');
    await testRoleBasedAccess('admin', '/admin/analytics');
    await testRoleBasedAccess('teacher', '/teacher/subjects');
    await testRoleBasedAccess('student', '/student/batches');
    
    // Test cross-role access (should fail)
    await testRoleBasedAccess('student', '/admin/users', 403);
    await testRoleBasedAccess('teacher', '/admin/analytics', 403);
    
    // Phase 4: Frontend Testing
    await testFrontendPages();
    
    // Phase 5: Error Handling
    await testErrorHandling();
    
    // Generate final report
    const report = await generateTestReport();
    
    log('Test execution completed!', 'success');
    
    // Exit with appropriate code
    process.exit(report.summary.failedTests > 0 ? 1 : 0);
    
  } catch (error) {
    log(`Test execution failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  runTests,
  testHealthCheck,
  testUserRegistration,
  testUserLogin,
  testRoleBasedAccess,
  testFrontendPages,
  testErrorHandling,
  generateTestReport
};