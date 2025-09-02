# Announcements Collection Documentation

## Overview

The `announcements` collection stores announcements that can be targeted to specific batches or made globally visible to all users. This collection supports the admin announcement system for communicating important information to students and teachers.

## Collection Structure

### Collection Name
```
announcements
```

### Document Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `batchId` | string | Conditional | ID of the target batch. Required when `global` is false |
| `global` | boolean | Yes | Whether the announcement is visible to all users (true) or specific to a batch (false) |
| `title` | string | Yes | Title/subject of the announcement |
| `content` | string | Yes | Main content/body of the announcement |
| `createdAt` | timestamp | Yes | When the announcement was created |
| `createdBy` | string | Yes | UID of the admin who created the announcement |

### Document Structure Example

```javascript
// Batch-specific announcement
{
  "batchId": "batch_12345",
  "global": false,
  "title": "New Assignment Available",
  "content": "A new physics assignment has been uploaded. Please complete it by Friday.",
  "createdAt": "2024-01-15T10:30:00Z",
  "createdBy": "admin_uid_123"
}

// Global announcement
{
  "global": true,
  "title": "System Maintenance Notice",
  "content": "The platform will undergo maintenance on Sunday from 2 AM to 4 AM IST.",
  "createdAt": "2024-01-15T09:00:00Z",
  "createdBy": "admin_uid_456"
}
```

## API Endpoints

### Create Batch Announcement

**Endpoint:** `POST /api/admin/batches/:batchId/announcements`

**Authentication:** Admin only

**Request Body:**
```javascript
{
  "title": "Assignment Deadline Extended",
  "content": "The deadline for the mathematics assignment has been extended to next Monday."
}
```

**Response:**
```javascript
{
  "success": true,
  "message": "Announcement created successfully",
  "data": {
    "announcementId": "announcement_789",
    "batchId": "batch_12345",
    "global": false,
    "title": "Assignment Deadline Extended",
    "content": "The deadline for the mathematics assignment has been extended to next Monday.",
    "createdAt": "2024-01-15T11:00:00Z",
    "createdBy": "admin_uid_123",
    "batchInfo": {
      "title": "JEE Main 2024 Batch A"
    }
  }
}
```

## Business Logic

### Announcement Types

1. **Batch-Specific Announcements** (`global: false`)
   - Targeted to students and teachers of a specific batch
   - Requires valid `batchId`
   - Only visible to users associated with that batch

2. **Global Announcements** (`global: true`)
   - Visible to all platform users
   - No `batchId` required
   - Used for platform-wide notifications

### Validation Rules

1. **Title Validation:**
   - Required field
   - Must be non-empty after trimming
   - Maximum length: 200 characters

2. **Content Validation:**
   - Required field
   - Must be non-empty after trimming
   - Maximum length: 2000 characters

3. **Batch Validation:**
   - For batch-specific announcements, batch must exist
   - Batch must be accessible to the creating admin

4. **Permission Validation:**
   - Only users with admin role can create announcements
   - Admin must be authenticated

## Security Considerations

### Access Control
- Only authenticated admins can create announcements
- Batch existence is verified before creating batch-specific announcements
- Input sanitization prevents XSS attacks

### Data Validation
- All text fields are trimmed to prevent whitespace-only content
- Content length limits prevent abuse
- Timestamp is server-generated to prevent manipulation

## Query Patterns

### Common Queries

```javascript
// Get all announcements for a specific batch
firestore.collection('announcements')
  .where('batchId', '==', batchId)
  .orderBy('createdAt', 'desc')
  .get();

// Get all global announcements
firestore.collection('announcements')
  .where('global', '==', true)
  .orderBy('createdAt', 'desc')
  .get();

// Get all announcements for a user (batch-specific + global)
// This requires a compound query or multiple queries
```

### Indexing Recommendations

```javascript
// Recommended Firestore indexes
{
  "collectionGroup": "announcements",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "batchId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "announcements",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "global", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

## Error Handling

### Common Error Scenarios

1. **Missing Required Fields (400)**
   ```javascript
   {
     "error": "Invalid Request",
     "message": "Title and content are required"
   }
   ```

2. **Batch Not Found (404)**
   ```javascript
   {
     "error": "Batch Not Found",
     "message": "Batch with the provided ID does not exist"
   }
   ```

3. **Unauthorized Access (401/403)**
   ```javascript
   {
     "error": "Unauthorized",
     "message": "Admin access required"
   }
   ```

## Best Practices

### For Frontend Developers
1. **Real-time Updates:** Use Firestore listeners for real-time announcement updates
2. **Pagination:** Implement pagination for announcement lists
3. **Caching:** Cache announcements locally to improve performance
4. **Filtering:** Allow users to filter announcements by date or type

### For Backend Developers
1. **Validation:** Always validate input data before creating announcements
2. **Logging:** Log announcement creation for audit purposes
3. **Rate Limiting:** Implement rate limiting to prevent spam
4. **Cleanup:** Consider implementing automatic cleanup of old announcements

### For Admins
1. **Content Quality:** Write clear, concise announcement content
2. **Timing:** Consider the timing of announcements for maximum visibility
3. **Targeting:** Use batch-specific announcements for relevant content
4. **Follow-up:** Monitor engagement and follow up if necessary

## Integration with Other Collections

### Related Collections
- **batches:** Referenced by `batchId` for batch-specific announcements
- **users:** Referenced by `createdBy` for tracking announcement creators

### Data Consistency
- Batch existence is verified before creating batch-specific announcements
- Creator information is validated against authenticated user
- Timestamps are server-generated for consistency

## Monitoring and Analytics

### Key Metrics
- Announcement creation frequency
- Batch-specific vs global announcement ratio
- Admin activity patterns
- Announcement engagement (if tracking is implemented)

### Logging
- All announcement creation events are logged
- Failed creation attempts are logged with error details
- Email notification failures are logged as warnings