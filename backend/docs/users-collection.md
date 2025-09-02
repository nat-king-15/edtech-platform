# Users Collection Structure

## Overview
The `users` collection in Firestore stores user profile information for the EdTech platform. Each document uses the Firebase Authentication UID as the document ID.

## Collection Path
```
firestore/users/{uid}
```

## Document Structure

### Core Fields
- `uid` (string): The user's Firebase Authentication UID.
- `email` (string): User's email address.
- `displayName` (string): User's display name.
- `role` (string): User's role in the platform (`student`, `teacher`, or `admin`).
- `createdAt` (timestamp): Timestamp when the user was created.
- `updatedAt` (timestamp): Timestamp when the user was last updated.
- `isActive` (boolean): Whether the user's account is active.

### Profile Object (`profile`)
- `avatar` (string, nullable): URL to the user's avatar image.
- `bio` (string): A short biography of the user.
- `phone` (string): The user's phone number.
- `dateOfBirth` (timestamp, nullable): The user's date of birth.
- `address` (object): The user's address.
  - `street` (string)
  - `city` (string)
  - `state` (string)
  - `zipCode` (string)
  - `country` (string)

### Preferences Object (`preferences`)
- `notifications` (object): Notification preferences.
  - `email` (boolean)
  - `push` (boolean)
  - `sms` (boolean)
- `language` (string): The user's preferred language (e.g., 'en').
- `timezone` (string): The user's timezone (e.g., 'Asia/Kolkata').

### Role-Specific Data

- **For students (`studentData` object):**
  - `enrolledCourses` (array): List of course IDs the student is enrolled in.
  - `completedCourses` (array): List of course IDs the student has completed.
  - `totalStudyHours` (number): Total hours the student has spent studying.
  - `certificates` (array): List of certificates earned by the student.
  - `progress` (object): A map of course IDs to the student's progress in that course.

- **For teachers (`teacherData` object):**
  - `courses` (array): List of course IDs the teacher is associated with.
  - `subjects` (array): List of subject IDs the teacher is assigned to.
  - `experience` (string): The teacher's years of experience.
  - `qualifications` (array): The teacher's qualifications.
  - `rating` (number): The teacher's average rating.
  - `totalStudents` (number): The total number of students taught by the teacher.
  - `bio` (string): A detailed biography of the teacher.

- **For admins (`adminData` object):**
  - `permissions` (array): List of admin permissions.
  - `lastLogin` (timestamp, nullable): Timestamp of the admin's last login.

## Example Document (Student)
```json
{
  "uid": "some-firebase-uid",
  "email": "student@example.com",
  "displayName": "John Doe",
  "role": "student",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "isActive": true,
  "profile": {
    "avatar": null,
    "bio": "Eager to learn!",
    "phone": "+91-1234567890",
    "dateOfBirth": null,
    "address": {
      "street": "123 Main St",
      "city": "Anytown",
      "state": "CA",
      "zipCode": "12345",
      "country": "India"
    }
  },
  "preferences": {
    "notifications": {
      "email": true,
      "push": true,
      "sms": false
    },
    "language": "en",
    "timezone": "Asia/Kolkata"
  },
  "studentData": {
    "enrolledCourses": [],
    "completedCourses": [],
    "totalStudyHours": 0,
    "certificates": [],
    "progress": {}
  }
}
```

## Security Rules
The collection should be protected with Firestore security rules:
- Users can read their own document.
- Only admins can write/update user documents.
- Teachers can read student documents in their courses.

## Indexing
Recommended indexes for efficient queries:
- `role` (ascending)
- `email` (ascending)
- `createdAt` (descending)

## Usage Notes
1. The document ID MUST match the Firebase Auth UID.
2. Role changes require updating both the Firestore document and Firebase custom claims.
3. Always validate role values against the allowed roles: `student`, `teacher`, `admin`.
4. Use transactions when updating both Auth custom claims and the Firestore document to ensure data consistency.
