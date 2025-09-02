const fetch = require('node-fetch');

async function testCoursesAPI() {
  try {
    console.log('Testing courses API...');
    
    // Test the courses list endpoint
    const response = await fetch('http://localhost:5000/api/admin/courses', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjVlM2Y0ZGZkNzY4ZjY4ZmY4ZGY2ZGY2ZGY2ZGY2ZGY2ZGY2ZGYiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vZWR0ZWNoLXBsYXRmb3JtLWRldiIsImF1ZCI6ImVkdGVjaC1wbGF0Zm9ybS1kZXYiLCJhdXRoX3RpbWUiOjE3MzU0NzI4MDAsInVzZXJfaWQiOiJxak81bGZOaGtmaDRPZ2g0SXRyemF4b2RCeXUyIiwic3ViIjoicWpPNWxmTmhrZmg0T2doNEl0cnpheG9kQnl1MiIsImlhdCI6MTczNTQ3MjgwMCwiZXhwIjoxNzM1NDc2NDAwLCJlbWFpbCI6Im5hdHJhamxpbGhhcmUxNTFAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZW1haWwiOlsibmF0cmFqbGlsaGFyZTE1MUBnbWFpbC5jb20iXX0sInNpZ25faW5fcHJvdmlkZXIiOiJwYXNzd29yZCJ9fQ'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('API Response:', JSON.stringify(data, null, 2));
      
      if (data.data && data.data.courses) {
        console.log('Number of courses found:', data.data.courses.length);
        data.data.courses.forEach((course, index) => {
          console.log(`Course ${index + 1}:`, {
            id: course.id,
            courseId: course.courseId,
            title: course.title
          });
        });
      } else {
        console.log('No courses found in response');
      }
    } else {
      const errorText = await response.text();
      console.error('API Error:', errorText);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

testCoursesAPI();