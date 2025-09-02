# Subjects Collection

## Overview
The `subjects` collection stores information about subjects within batches, including teacher assignments and relationships to batches.

## Collection Path
```
subjects/{subjectId}
```

## Document Structure

### Required Fields
- **`title`** (string): The name/title of the subject
- **`batchId`** (string): Reference to the batch document ID this subject belongs to

### Optional Fields
- **`teacherId`** (string): User UID of the assigned teacher (null if no teacher assigned)
- **`teacherName`** (string): Display name of the assigned teacher
- **`teacherEmail`** (string): Email address of the assigned teacher
- **`description`** (string): Optional description of the subject
- **`isActive`** (boolean): Whether the subject is active (default: true)
- **`createdAt`** (string): ISO timestamp when the subject was created
- **`updatedAt`** (string): ISO timestamp when the subject was last updated
- **`createdBy`** (string): UID of the admin who created the subject
- **`assignedAt`** (string): ISO timestamp when teacher was assigned (null if no teacher)
- **`assignedBy`** (string): UID of the admin who assigned the teacher

## Example Document
```json
{
  "title": "Mathematics - Algebra",
  "batchId": "batch123",
  "teacherId": "teacher456",
  "teacherName": "Dr. John Smith",
  "teacherEmail": "john.smith@example.com",
  "description": "Advanced algebra concepts for grade 10",
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:45:00.000Z",
  "createdBy": "admin789",
  "assignedAt": "2024-01-20T14:45:00.000Z",
  "assignedBy": "admin789"
}
```

## Security Rules
```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /subjects/{subjectId} {
      // Admin can read/write all subjects
      allow read, write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      
      // Teachers can read subjects assigned to them
      allow read: if request.auth != null && 
        resource.data.teacherId == request.auth.uid;
      
      // Teachers can update their own subject assignments (limited fields)
      allow update: if request.auth != null && 
        resource.data.teacherId == request.auth.uid &&
        request.writeFields.hasOnly(['updatedAt', 'description']);
    }
  }
}
```

## Indexing
Recommended composite indexes:
- `batchId` (ascending) + `isActive` (ascending)
- `teacherId` (ascending) + `isActive` (ascending)
- `createdAt` (descending) for pagination

## Validation Rules
- `title` must be a non-empty string (max 200 characters)
- `batchId` must reference an existing batch document
- `teacherId` must reference an existing user with teacher role (if provided)
- `teacherEmail` must be a valid email format (if provided)
- `isActive` must be a boolean value
- Timestamps must be valid ISO date strings

## Usage Notes
1. **Subject Creation**: Subjects are created by admins and initially have no teacher assigned
2. **Teacher Assignment**: Teachers are assigned separately through the assign-teacher endpoint
3. **Batch Relationship**: Each subject must belong to exactly one batch
4. **Teacher Access**: Teachers can only view subjects assigned to them
5. **Email Notifications**: When a teacher is assigned, an email notification is sent automatically
6. **Soft Delete**: Use `isActive: false` instead of deleting documents
7. **Audit Trail**: Track who created and assigned teachers for accountability