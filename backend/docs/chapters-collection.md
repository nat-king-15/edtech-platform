# Chapters Collection

## Overview
The `chapters` collection stores information about chapters within subjects, allowing teachers to organize subject content into manageable sections.

## Collection Path
```
chapters/{chapterId}
```

## Document Structure

### Required Fields
- **`title`** (string): The name/title of the chapter
- **`subjectId`** (string): Reference to the subject document ID this chapter belongs to
- **`order`** (number): Display order of the chapter within the subject (1, 2, 3, etc.)

### Optional Fields
- **`description`** (string): Optional description of the chapter content
- **`content`** (string): Chapter content/notes (markdown supported)
- **`duration`** (number): Estimated duration in minutes to complete the chapter
- **`difficulty`** (string): Difficulty level ('beginner', 'intermediate', 'advanced')
- **`objectives`** (array): Learning objectives for the chapter
- **`resources`** (array): Additional resources (links, files, etc.)
- **`isActive`** (boolean): Whether the chapter is active (default: true)
- **`isPublished`** (boolean): Whether the chapter is published to students (default: false)
- **`createdAt`** (string): ISO timestamp when the chapter was created
- **`updatedAt`** (string): ISO timestamp when the chapter was last updated
- **`createdBy`** (string): UID of the teacher who created the chapter

## Example Document
```json
{
  "title": "Introduction to Algebra",
  "subjectId": "subject123",
  "order": 1,
  "description": "Basic concepts of algebraic expressions and equations",
  "content": "# Introduction to Algebra\n\nAlgebra is a branch of mathematics...",
  "duration": 45,
  "difficulty": "beginner",
  "objectives": [
    "Understand algebraic expressions",
    "Solve simple linear equations",
    "Apply algebraic concepts to real-world problems"
  ],
  "resources": [
    {
      "type": "video",
      "title": "Algebra Basics Video",
      "url": "https://example.com/video1"
    },
    {
      "type": "pdf",
      "title": "Practice Worksheets",
      "url": "https://example.com/worksheet.pdf"
    }
  ],
  "isActive": true,
  "isPublished": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:45:00.000Z",
  "createdBy": "teacher456"
}
```

## Security Rules
```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chapters/{chapterId} {
      // Admin can read/write all chapters
      allow read, write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      
      // Teachers can read/write chapters for their assigned subjects
      allow read, write: if request.auth != null && 
        get(/databases/$(database)/documents/subjects/$(resource.data.subjectId)).data.teacherId == request.auth.uid;
      
      // Students can read published chapters for subjects they're enrolled in
      allow read: if request.auth != null && 
        resource.data.isPublished == true &&
        resource.data.isActive == true;
    }
  }
}
```

## Indexing
Recommended composite indexes:
- `subjectId` (ascending) + `order` (ascending)
- `subjectId` (ascending) + `isActive` (ascending) + `isPublished` (ascending)
- `createdBy` (ascending) + `createdAt` (descending)

## Validation Rules
- `title` must be a non-empty string (max 200 characters)
- `subjectId` must reference an existing subject document
- `order` must be a positive integer
- `difficulty` must be one of: 'beginner', 'intermediate', 'advanced'
- `duration` must be a positive number (if provided)
- `isActive` and `isPublished` must be boolean values
- Timestamps must be valid ISO date strings

## Usage Notes
1. **Chapter Creation**: Chapters are created by teachers for their assigned subjects
2. **Ordering**: Chapters are ordered sequentially within each subject
3. **Publishing**: Teachers can control when chapters become visible to students
4. **Content Management**: Support for markdown content and rich media resources
5. **Progress Tracking**: Can be extended to track student progress through chapters
6. **Soft Delete**: Use `isActive: false` instead of deleting documents
7. **Teacher Access**: Only teachers assigned to the subject can manage its chapters
8. **Student Access**: Students can only view published and active chapters

## API Endpoints
- `GET /api/teacher/subjects/:subjectId/chapters` - List chapters for a subject
- `POST /api/teacher/subjects/:subjectId/chapters` - Create new chapter
- `GET /api/teacher/chapters/:chapterId` - Get chapter details
- `PUT /api/teacher/chapters/:chapterId` - Update chapter
- `DELETE /api/teacher/chapters/:chapterId` - Delete chapter (soft delete)
- `PUT /api/teacher/chapters/:chapterId/publish` - Publish/unpublish chapter
- `PUT /api/teacher/chapters/reorder` - Reorder chapters within subject