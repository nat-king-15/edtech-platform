# Notification System Documentation

## Overview

The notification system provides comprehensive multi-channel notification capabilities for the EdTech platform, supporting both email and in-app notifications with predefined templates for various event types.

## Architecture

### Core Components

1. **Notification Service** (`backend/services/notificationService.js`)
   - Central service for managing all notification operations
   - Template-based notification system
   - Multi-channel delivery (email + in-app)
   - Bulk notification capabilities

2. **Email Service** (`backend/utils/emailService.js`)
   - Enhanced email delivery using Nodemailer
   - Bulk email processing with rate limiting
   - HTML to text conversion
   - Development mode logging

3. **API Endpoints** (`backend/routes/student.js`)
   - RESTful endpoints for notification management
   - Authentication and authorization
   - Pagination support

## Firestore Schema

### Notifications Collection

```javascript
{
  userId: string,           // User ID who receives the notification
  type: string,            // Notification type (enrollment_success, payment_success, etc.)
  title: string,           // Notification title
  body: string,            // Notification content
  icon: string,            // Icon identifier
  data: object,            // Additional data (batch info, payment details, etc.)
  read: boolean,           // Read status
  createdAt: timestamp,    // Creation timestamp
  updatedAt: timestamp,    // Last update timestamp
  readAt: timestamp        // Read timestamp (optional)
}
```

## Notification Types

### 1. Enrollment Success
- **Type**: `enrollment_success`
- **Trigger**: After successful batch enrollment
- **Template Variables**: `{studentName}`, `{batchName}`, `{enrollmentDate}`

### 2. Payment Success
- **Type**: `payment_success`
- **Trigger**: After payment verification
- **Template Variables**: `{studentName}`, `{amount}`, `{batchName}`, `{paymentDate}`

### 3. Batch Announcement
- **Type**: `batch_announcement`
- **Trigger**: When admin creates batch announcements
- **Template Variables**: `{studentName}`, `{batchName}`, `{announcementTitle}`, `{announcementContent}`

### 4. Content Scheduled
- **Type**: `content_scheduled`
- **Template Variables**: `{studentName}`, `{contentTitle}`, `{scheduledDate}`

### 5. Welcome Message
- **Type**: `welcome`
- **Template Variables**: `{studentName}`, `{platformName}`

### 6. Assignment Due
- **Type**: `assignment_due`
- **Template Variables**: `{studentName}`, `{assignmentTitle}`, `{dueDate}`

## API Endpoints

### Student Notification Endpoints

All endpoints require authentication and student role.

#### 1. Get Notifications
```
GET /api/student/notifications
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `type` (optional): Filter by notification type

**Response:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": "notification_id",
      "type": "enrollment_success",
      "title": "Enrollment Successful",
      "body": "You have successfully enrolled in Batch XYZ",
      "icon": "✅",
      "data": { "batchId": "batch123" },
      "read": false,
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 100,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### 2. Get Unread Count
```
GET /api/student/notifications/unread-count
```

**Response:**
```json
{
  "success": true,
  "unreadCount": 5
}
```

#### 3. Mark Notification as Read
```
PUT /api/student/notifications/:notificationId/read
```

**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read"
}
```

#### 4. Mark All Notifications as Read
```
PUT /api/student/notifications/mark-all-read
```

**Response:**
```json
{
  "success": true,
  "message": "All notifications marked as read",
  "updatedCount": 12
}
```

## Service Methods

### NotificationService

#### sendNotification(userId, type, templateData)
Sends a single notification to a user.

```javascript
const result = await notificationService.sendNotification(
  'user123',
  'enrollment_success',
  {
    studentName: 'John Doe',
    batchName: 'Mathematics Batch A',
    enrollmentDate: '2024-01-15'
  }
);
```

#### sendBulkNotifications(userIds, type, templateData)
Sends notifications to multiple users.

```javascript
const result = await notificationService.sendBulkNotifications(
  ['user1', 'user2', 'user3'],
  'batch_announcement',
  {
    batchName: 'Physics Batch B',
    announcementTitle: 'New Assignment Posted',
    announcementContent: 'Complete Chapter 5 exercises by Friday'
  }
);
```

#### getUserNotifications(userId, options)
Retrieves user notifications with pagination.

```javascript
const notifications = await notificationService.getUserNotifications(
  'user123',
  {
    page: 1,
    limit: 10,
    type: 'enrollment_success'
  }
);
```

#### markAsRead(notificationId)
Marks a specific notification as read.

```javascript
const result = await notificationService.markAsRead('notification123');
```

#### markAllAsRead(userId)
Marks all user notifications as read.

```javascript
const result = await notificationService.markAllAsRead('user123');
```

#### getUnreadCount(userId)
Gets unread notification count for a user.

```javascript
const count = await notificationService.getUnreadCount('user123');
```

## Integration Points

### 1. Enrollment Process
**File**: `backend/routes/student.js`
**Endpoint**: `POST /api/student/payment/verify`

After successful payment verification:
```javascript
// Send enrollment success notification
await notificationService.sendNotification(
  userId,
  'enrollment_success',
  {
    studentName: user.name,
    batchName: batch.name,
    enrollmentDate: new Date().toLocaleDateString()
  }
);

// Send payment success notification
await notificationService.sendNotification(
  userId,
  'payment_success',
  {
    studentName: user.name,
    amount: `₹${payment.amount}`,
    batchName: batch.name,
    paymentDate: new Date().toLocaleDateString()
  }
);
```

### 2. Batch Announcements
**File**: `backend/routes/admin.js`
**Endpoint**: `POST /api/admin/batches/:batchId/announcements`

After creating an announcement:
```javascript
// Get all enrolled students
const enrollments = await firestore
  .collection('enrollments')
  .where('batchId', '==', batchId)
  .where('status', '==', 'active')
  .get();

const userIds = enrollments.docs.map(doc => doc.data().userId);

// Send bulk notifications
if (userIds.length > 0) {
  await notificationService.sendBulkNotifications(
    userIds,
    'batch_announcement',
    {
      batchName: batch.name,
      announcementTitle: title,
      announcementContent: content.substring(0, 100) + '...'
    }
  );
}
```

## Configuration

### Environment Variables

For email notifications to work in production, configure these environment variables:

```env
# Email Configuration
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

### Development Mode

In development, if SMTP is not configured, email notifications will be logged to the console instead of being sent.

## Error Handling

The notification system includes comprehensive error handling:

1. **Graceful Failures**: Notification failures don't disrupt core functionality
2. **Logging**: All errors are logged for debugging
3. **Fallback**: Email service falls back to console logging in development
4. **Validation**: Input validation for all service methods

## Performance Considerations

1. **Bulk Operations**: Use `sendBulkNotifications` for multiple recipients
2. **Rate Limiting**: Built-in delays for bulk email sending
3. **Pagination**: API endpoints support pagination for large datasets
4. **Indexing**: Firestore queries are optimized with proper indexing

## Testing

### Manual Testing

1. **Enrollment Flow**:
   - Complete a batch enrollment
   - Verify notifications are created in Firestore
   - Check email logs in development

2. **Batch Announcements**:
   - Create an announcement as admin
   - Verify all enrolled students receive notifications

3. **API Endpoints**:
   - Test all notification endpoints with Postman
   - Verify authentication and authorization
   - Test pagination and filtering

### Example Test Requests

```bash
# Get notifications
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/student/notifications?page=1&limit=5"

# Mark as read
curl -X PUT -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/student/notifications/notification123/read"

# Get unread count
curl -H "Authorization: Bearer <token>" \
     "http://localhost:3000/api/student/notifications/unread-count"
```

## Future Enhancements

1. **Push Notifications**: Add support for browser/mobile push notifications
2. **SMS Integration**: Add SMS notification channel
3. **Notification Preferences**: Allow users to configure notification preferences
4. **Rich Templates**: Support for rich HTML templates with images
5. **Scheduling**: Support for scheduled notifications
6. **Analytics**: Track notification delivery and engagement metrics

## Troubleshooting

### Common Issues

1. **Email Not Sending**:
   - Check SMTP configuration in `.env`
   - Verify Gmail app password if using Gmail
   - Check console logs for error messages

2. **Notifications Not Appearing**:
   - Verify Firestore permissions
   - Check user authentication
   - Verify notification service integration

3. **API Errors**:
   - Check JWT token validity
   - Verify user role permissions
   - Check request format and parameters

### Debug Mode

Enable debug logging by setting:
```env
NODE_ENV=development
```

This will log all notification operations to the console for debugging purposes.