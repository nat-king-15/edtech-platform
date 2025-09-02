const axios = require('axios');
const jwt = require('jsonwebtoken');

// Test Settings API endpoints
const BASE_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function testSettingsAPI() {
  console.log('🧪 Testing Settings API endpoints...');
  
  // Use the provided valid JWT token
  const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJxak81bGZOaGtmaDRPZ2g0SXRyemF4b2RCeXUyIiwiZW1haWwiOiJuYXRyYWpsaWxoYXJlMTUxQGdtYWlsLmNvbSIsInJvbGUiOiJhZG1pbiIsImRpc3BsYXlOYW1lIjoiTkFUUkFKIExJTEhBUkUiLCJpYXQiOjE3NTY1MTYzMDMsImV4cCI6MTc1NzEyMTEwM30.Uq4byDIz6Tbon05aJBUqCLpwe0YoeFZcxo4zlVF-w4c';
  console.log('🔑 Using provided test token for admin user');
  
  try {
    // Test GET /api/admin/settings
    console.log('\n1. Testing GET /api/admin/settings');
    const getResponse = await axios.get(`${BASE_URL}/api/admin/settings`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ GET Settings - Status:', getResponse.status);
    console.log('📄 Response data keys:', Object.keys(getResponse.data.data || {}));
    console.log('📋 Sample settings:', {
      appName: getResponse.data.data?.appName,
      maintenanceMode: getResponse.data.data?.maintenanceMode,
      maxFileSize: getResponse.data.data?.maxFileSize
    });
    
    // Test PUT /api/admin/settings
    console.log('\n2. Testing PUT /api/admin/settings');
    const updateData = {
      appName: 'Test EdTech Platform Updated',
      maintenanceMode: false,
      maxFileSize: 15728640 // 15MB
    };
    
    const putResponse = await axios.put(`${BASE_URL}/api/admin/settings`, updateData, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ PUT Settings - Status:', putResponse.status);
    console.log('📝 Update response:', putResponse.data.message);
    
    // Verify the update by getting settings again
    console.log('\n2.1. Verifying the update...');
    const verifyResponse = await axios.get(`${BASE_URL}/api/admin/settings`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('📋 Updated settings:', {
      appName: verifyResponse.data.data?.appName,
      maxFileSize: verifyResponse.data.data?.maxFileSize
    });
    
    // Test POST /api/admin/settings/reset
    console.log('\n3. Testing POST /api/admin/settings/reset');
    const resetResponse = await axios.post(`${BASE_URL}/api/admin/settings/reset`, {}, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ POST Reset Settings - Status:', resetResponse.status);
    console.log('🔄 Reset response:', resetResponse.data.message);
    
    // Verify the reset
    console.log('\n3.1. Verifying the reset...');
    const resetVerifyResponse = await axios.get(`${BASE_URL}/api/admin/settings`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('📋 Reset settings:', {
      appName: resetVerifyResponse.data.data?.appName,
      maxFileSize: resetVerifyResponse.data.data?.maxFileSize
    });
    
    console.log('\n🎉 All Settings API tests completed successfully!');
    
  } catch (error) {
    console.error('❌ API Test Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
}

// Run the tests
testSettingsAPI();