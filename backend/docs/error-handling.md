# Error Handling Guide

Comprehensive guide for error handling in the EdTech Platform API.

## Error Response Format

All API errors follow a consistent JSON format:

```json
{
  "error": "ErrorType",
  "message": "Human-readable error description",
  "details": {
    // Additional error context (optional)
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/endpoint",
  "method": "GET|POST|PUT|DELETE"
}
```

## HTTP Status Codes

### 400 - Bad Request

**Common Scenarios:**
- Invalid request body format
- Missing required fields
- Invalid field values
- Validation errors

**Example Response:**
```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "details": {
    "field": "email",
    "value": "invalid-email",
    "expected": "Valid email format"
  }
}
```

**Solutions:**
- Verify request body format
- Check required fields
- Validate field values according to API documentation

### 401 - Unauthorized

**Common Scenarios:**
- Missing Authorization header
- Invalid Firebase ID token
- Expired token
- Malformed token

**Example Response:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing authentication token",
  "details": {
    "reason": "Token expired",
    "action": "Please refresh your authentication token"
  }
}
```

**Solutions:**
- Include valid Firebase ID token in Authorization header
- Refresh expired tokens
- Ensure token format: `Bearer <token>`

### 403 - Forbidden

**Common Scenarios:**
- Insufficient role permissions
- Accessing resources belonging to other users
- Role-based access control violations

**Example Response:**
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions to access this resource",
  "details": {
    "requiredRole": "admin",
    "currentRole": "teacher",
    "action": "Contact administrator for role upgrade"
  }
}
```

**Solutions:**
- Verify user role permissions
- Contact administrator for role changes
- Use appropriate endpoints for your role

### 404 - Not Found

**Common Scenarios:**
- Resource doesn't exist
- Invalid resource ID
- Deleted resources
- Incorrect endpoint URL

**Example Response:**
```json
{
  "error": "NotFound",
  "message": "Requested resource not found",
  "details": {
    "resource": "batch",
    "id": "invalid-batch-id",
    "suggestion": "Verify the batch ID and try again"
  }
}
```

**Solutions:**
- Verify resource IDs
- Check if resource exists
- Ensure correct endpoint URLs

### 409 - Conflict

**Common Scenarios:**
- Duplicate resource creation
- Resource already exists
- Conflicting state changes

**Example Response:**
```json
{
  "error": "Conflict",
  "message": "Resource already exists",
  "details": {
    "resource": "course",
    "conflictField": "title",
    "existingValue": "JavaScript Fundamentals",
    "suggestion": "Use a different title or update the existing course"
  }
}
```

**Solutions:**
- Use unique values for required fields
- Update existing resources instead of creating new ones
- Check resource state before operations

### 500 - Internal Server Error

**Common Scenarios:**
- Database connection issues
- Firebase service errors
- Email service failures
- Unexpected server errors

**Example Response:**
```json
{
  "error": "InternalServerError",
  "message": "An unexpected error occurred",
  "details": {
    "errorId": "err_123456789",
    "action": "Please try again later or contact support"
  }
}
```

**Solutions:**
- Retry the request after some time
- Contact support with error ID
- Check server status

## Specific Error Types

### Authentication Errors

#### Invalid Token Format
```json
{
  "error": "InvalidTokenFormat",
  "message": "Authorization header must be in format: Bearer <token>",
  "details": {
    "received": "InvalidFormat",
    "expected": "Bearer <firebase-id-token>"
  }
}
```

#### Token Verification Failed
```json
{
  "error": "TokenVerificationFailed",
  "message": "Failed to verify Firebase ID token",
  "details": {
    "reason": "Token signature invalid",
    "action": "Please sign in again to get a new token"
  }
}
```

### Validation Errors

#### Missing Required Fields
```json
{
  "error": "MissingRequiredFields",
  "message": "Required fields are missing",
  "details": {
    "missingFields": ["title", "courseId"],
    "received": ["description", "price"]
  }
}
```

#### Invalid Field Values
```json
{
  "error": "InvalidFieldValue",
  "message": "One or more field values are invalid",
  "details": {
    "invalidFields": {
      "price": {
        "value": -100,
        "error": "Price must be a positive number"
      },
      "email": {
        "value": "invalid-email",
        "error": "Must be a valid email address"
      }
    }
  }
}
```

### Database Errors

#### Document Not Found
```json
{
  "error": "DocumentNotFound",
  "message": "Requested document does not exist in database",
  "details": {
    "collection": "batches",
    "documentId": "batch-id-123",
    "action": "Verify the document ID and try again"
  }
}
```

#### Database Connection Error
```json
{
  "error": "DatabaseConnectionError",
  "message": "Failed to connect to database",
  "details": {
    "service": "Firestore",
    "action": "Please try again later"
  }
}
```

### Email Service Errors

#### Email Send Failed
```json
{
  "error": "EmailSendFailed",
  "message": "Failed to send email notification",
  "details": {
    "recipient": "teacher@example.com",
    "reason": "SMTP authentication failed",
    "action": "Email configuration may need to be updated"
  }
}
```

#### Invalid Email Configuration
```json
{
  "error": "InvalidEmailConfiguration",
  "message": "Email service is not properly configured",
  "details": {
    "missingConfig": ["EMAIL_USER", "EMAIL_PASSWORD"],
    "action": "Contact administrator to configure email settings"
  }
}
```

## Error Handling Best Practices

### For Frontend Developers

1. **Always Check Status Codes**
```javascript
const response = await fetch('/api/admin/courses', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(courseData)
});

if (!response.ok) {
  const error = await response.json();
  console.error('API Error:', error);
  // Handle specific error types
  switch (response.status) {
    case 401:
      // Redirect to login
      break;
    case 403:
      // Show permission denied message
      break;
    case 400:
      // Show validation errors
      break;
    default:
      // Show generic error message
  }
}
```

2. **Implement Retry Logic for 5xx Errors**
```javascript
const retryRequest = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
    // Wait before retry (exponential backoff)
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
  }
};
```

3. **Handle Token Expiration**
```javascript
const apiCall = async (url, options) => {
  let response = await fetch(url, options);
  
  if (response.status === 401) {
    // Try to refresh token
    const newToken = await refreshAuthToken();
    options.headers.Authorization = `Bearer ${newToken}`;
    response = await fetch(url, options);
  }
  
  return response;
};
```

### For Backend Developers

1. **Use Consistent Error Format**
```javascript
const createError = (type, message, details = {}, statusCode = 500) => {
  return {
    error: type,
    message,
    details,
    timestamp: new Date().toISOString(),
    statusCode
  };
};
```

2. **Log Errors Appropriately**
```javascript
const handleError = (error, req, res) => {
  // Log error details for debugging
  console.error('API Error:', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    user: req.user?.uid,
    timestamp: new Date().toISOString()
  });
  
  // Send appropriate response to client
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json(createError(
    error.type || 'InternalServerError',
    error.message || 'An unexpected error occurred',
    error.details || {}
  ));
};
```

3. **Validate Input Data**
```javascript
const validateCourseData = (data) => {
  const errors = {};
  
  if (!data.title || data.title.trim().length === 0) {
    errors.title = 'Title is required';
  }
  
  if (!data.category || data.category.trim().length === 0) {
    errors.category = 'Category is required';
  }
  
  if (data.price && (isNaN(data.price) || data.price < 0)) {
    errors.price = 'Price must be a positive number';
  }
  
  if (Object.keys(errors).length > 0) {
    throw createError('ValidationError', 'Invalid input data', { invalidFields: errors }, 400);
  }
};
```

## Debugging Tips

1. **Check Server Logs**: Always check server console for detailed error information
2. **Verify Environment Variables**: Ensure all required environment variables are set
3. **Test with Postman**: Use API testing tools to isolate issues
4. **Check Firebase Console**: Verify Firebase configuration and permissions
5. **Monitor Network Requests**: Use browser dev tools to inspect API calls

## Common Solutions

### Authentication Issues
- Ensure Firebase project is properly configured
- Verify service account key is valid
- Check token expiration and refresh logic

### Permission Issues
- Verify user roles in Firebase Auth custom claims
- Check middleware implementation
- Ensure proper role assignment

### Database Issues
- Verify Firestore rules and permissions
- Check document structure and field names
- Ensure proper indexing for queries

### Email Issues
- Verify Gmail app password configuration
- Check email service environment variables
- Test email connectivity

## Support

For additional support:
1. Check server logs for detailed error information
2. Verify API documentation for correct usage
3. Test endpoints with proper authentication
4. Contact development team with error IDs for investigation