const fetch = require('node-fetch');

// Test the subjects API endpoints directly
async function testSubjectsAPI() {
  console.log('Testing subjects API endpoints...');
  
  const batchId = 'uwOrbZPZRRttGAVOBXLK';
  const baseUrl = 'http://localhost:5000';
  
  // Test GET subjects endpoint
  console.log('\n1. Testing GET subjects endpoint...');
  const getUrl = `${baseUrl}/api/admin/batches/${batchId}/subjects`;
  console.log('URL:', getUrl);
  
  try {
    const response = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response body:', text);
    
  } catch (error) {
    console.error('GET Error:', error);
  }
  
  // Test POST subjects endpoint
  console.log('\n2. Testing POST subjects endpoint...');
  const postUrl = `${baseUrl}/api/admin/batches/${batchId}/subjects`;
  console.log('URL:', postUrl);
  
  try {
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Test Subject',
        description: 'Test Description'
      })
    });
    
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response body:', text);
    
  } catch (error) {
    console.error('POST Error:', error);
  }
}

testSubjectsAPI();