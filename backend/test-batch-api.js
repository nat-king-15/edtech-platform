const fetch = require('node-fetch');

// Test the batch API endpoint directly
async function testBatchAPI() {
  console.log('Testing batch API endpoint...');
  
  const courseId = 'rGFjmH8bG1CzJb4Tq1cG';
  const url = `http://localhost:3000/api/admin/courses/${courseId}/batches`;
  
  console.log('URL:', url);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers.raw());
    
    const text = await response.text();
    console.log('Response body:', text);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testBatchAPI();