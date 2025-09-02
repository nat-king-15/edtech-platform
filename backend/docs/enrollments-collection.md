# Enrollments Collection Documentation

## Overview

The `enrollments` collection manages student enrollments in batches, tracking payment status and enrollment timestamps. This collection serves as the bridge between students and batches, enabling access control for content delivery.

## Collection Structure

### Collection Name
`enrollments`

### Document ID Format
`<studentUid>_<batchId>`

**Example**: `user123_batch456`

### Document Schema

```javascript
{
  studentId: string,        // Firebase Auth UID of the student
  batchId: string,          // Reference to the batch document ID
  enrolledAt: Timestamp,    // Server timestamp when enrollment was created
  paymentStatus: string,    // Payment status: 'completed', 'pending', 'failed'
  amount: number,           // Amount paid for the batch
  currency: string          // Currency code (e.g., 'USD', 'INR')
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `studentId` | string | Yes | Firebase Auth UID of the enrolled student |
| `batchId` | string | Yes | Document ID of the batch being enrolled in |
| `enrolledAt` | Timestamp | Yes | Server timestamp of enrollment creation |
| `paymentStatus` | string | Yes | Current payment status |
| `amount` | number | No | Amount paid (0 for free batches) |
| `currency` | string | No | Currency code, defaults to 'USD' |

### Payment Status Values

- `completed`: Payment successful, student has full access
- `pending`: Payment initiated but not confirmed
- `failed`: Payment failed, enrollment may be revoked
- `refunded`: Payment refunded, access revoked

## Example Documents

### Paid Enrollment
```javascript
{
  studentId: "firebase_user_123",
  batchId: "batch_math_2024",
  enrolledAt: Timestamp(2024-01-15T10:30:00Z),
  paymentStatus: "completed",
  amount: 299.99,
  currency: "USD"
}
```

### Free Enrollment
```javascript
{
  studentId: "firebase_user_456",
  batchId: "batch_demo_2024",
  enrolledAt: Timestamp(2024-01-15T14:20:00Z),
  paymentStatus: "completed",
  amount: 0,
  currency: "USD"
}
```

## API Endpoints

### POST /api/student/batches/:batchId/enroll

Enrolls a student in a batch after simulated payment processing.

**Request Headers:**
```
Authorization: Bearer <firebase_token>
Content-Type: application/json
```

**Request Body:**
```javascript
// No body required - enrollment details extracted from token and batch
```

**Response (Success - 201):**
```javascript
{
  "success": true,
  "message": "Successfully enrolled in batch",
  "data": {
    "enrollmentId": "user123_batch456",
    "batchId": "batch456",
    "batchName": "Advanced Mathematics",
    "enrolledAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Responses:**

- **404 Batch Not Found:**
```javascript
{
  "error": "Batch Not Found",
  "message": "The specified batch does not exist"
}
```

- **400 Batch Not Available:**
```javascript
{
  "error": "Batch Not Available",
  "message": "This batch is not available for enrollment"
}
```

- **409 Already Enrolled:**
```javascript
{
  "error": "Already Enrolled",
  "message": "You are already enrolled in this batch"
}
```

## Business Logic

### Enrollment Process

1. **Authentication Check**: Verify student role via middleware
2. **Batch Validation**: Ensure batch exists and is published
3. **Duplicate Check**: Prevent multiple enrollments in same batch
4. **Payment Simulation**: Mock payment processing (always successful)
5. **Record Creation**: Create enrollment document with composite ID
6. **Response**: Return enrollment confirmation

### Access Control

Enrollment records are used to:
- Verify student access to batch content
- Filter content based on schedule (only past content)
- Track payment status for billing
- Generate enrollment reports

### Content Access Logic

```javascript
// Pseudo-code for content access verification
const checkAccess = async (studentId, batchId) => {
  const enrollmentId = `${studentId}_${batchId}`;
  const enrollment = await firestore.collection('enrollments').doc(enrollmentId).get();
  
  return enrollment.exists && enrollment.data().paymentStatus === 'completed';
};
```

## Security Considerations

### Authentication
- All enrollment operations require valid Firebase Auth token
- Student role verification via middleware
- No admin override for student enrollments

### Authorization
- Students can only enroll themselves
- Students can only access their own enrollments
- Batch content access requires valid enrollment

### Data Validation
- Batch existence and publication status verified
- Duplicate enrollment prevention
- Payment status validation

### Privacy
- Enrollment data only accessible to enrolled student
- Payment information not exposed in content APIs
- Audit trail maintained via timestamps

## Database Indexes

### Recommended Indexes

```javascript
// Single field indexes
studentId: ascending
batchId: ascending
enrolledAt: descending
paymentStatus: ascending

// Composite indexes
[studentId, enrolledAt]: [ascending, descending]
[batchId, paymentStatus]: [ascending, ascending]
```

### Query Patterns

```javascript
// Get all enrollments for a student
firestore.collection('enrollments')
  .where('studentId', '==', studentId)
  .orderBy('enrolledAt', 'desc')

// Get all enrollments for a batch
firestore.collection('enrollments')
  .where('batchId', '==', batchId)
  .where('paymentStatus', '==', 'completed')

// Check specific enrollment
firestore.collection('enrollments')
  .doc(`${studentId}_${batchId}`)
```

## Integration Points

### Related Collections

- **batches**: Referenced by `batchId`
- **users**: Referenced by `studentId`
- **schedule**: Content access controlled by enrollment
- **subjects**: Indirect relationship via batch subjects

### External Services

- **Payment Gateway**: Future integration for real payments
- **Email Service**: Enrollment confirmation emails
- **Analytics**: Enrollment tracking and reporting

## Best Practices

### For Frontend Developers

1. **Error Handling**: Always handle enrollment errors gracefully
2. **Loading States**: Show loading during enrollment process
3. **Confirmation**: Display enrollment success clearly
4. **Access Control**: Check enrollment before showing content

### For Backend Developers

1. **Atomic Operations**: Use transactions for enrollment creation
2. **Idempotency**: Handle duplicate enrollment attempts
3. **Validation**: Validate all input parameters
4. **Logging**: Log enrollment events for audit

### For Administrators

1. **Monitoring**: Track enrollment success rates
2. **Refunds**: Handle refund scenarios properly
3. **Reporting**: Generate enrollment analytics
4. **Support**: Provide tools for enrollment troubleshooting

## Data Consistency

### Referential Integrity

- Enrollment documents reference valid batch IDs
- Student IDs match Firebase Auth users
- Payment status reflects actual payment state

### Cleanup Procedures

```javascript
// Clean up enrollments for deleted batches
const cleanupEnrollments = async (deletedBatchId) => {
  const enrollments = await firestore.collection('enrollments')
    .where('batchId', '==', deletedBatchId)
    .get();
    
  const batch = firestore.batch();
  enrollments.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
};
```

## Monitoring and Analytics

### Key Metrics

- Enrollment conversion rate
- Payment success rate
- Time to enrollment completion
- Popular batch enrollment patterns
- Student retention by batch

### Logging Strategy

```javascript
// Enrollment event logging
console.log('Enrollment Event', {
  type: 'enrollment_created',
  studentId: enrollment.studentId,
  batchId: enrollment.batchId,
  amount: enrollment.amount,
  timestamp: new Date().toISOString()
});
```

## Future Enhancements

### Planned Features

1. **Real Payment Integration**: Stripe/PayPal integration
2. **Enrollment Limits**: Maximum students per batch
3. **Waitlist System**: Queue for full batches
4. **Partial Refunds**: Pro-rated refund calculations
5. **Group Enrollments**: Bulk enrollment discounts
6. **Enrollment Analytics**: Advanced reporting dashboard

### Migration Considerations

- Document ID format is stable for future migrations
- Additional fields can be added without breaking changes
- Payment integration will extend existing payment fields
- Audit trail can be enhanced with additional metadata