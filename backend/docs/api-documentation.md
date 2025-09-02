# EdTech Platform API Documentation

Comprehensive documentation for all API endpoints in the EdTech Platform backend.

## Base URL
```
http://localhost:3000
```

## Authentication

The platform uses a hybrid authentication system:

1.  **Firebase Authentication**: Used for core user management (creating users, handling passwords, etc.).
2.  **JWT (JSON Web Tokens)**: Used for session management and authorizing API requests.

### Authentication Flow

1.  **Registration (`/api/auth/register`)**: A new user is created in Firebase Auth and a corresponding user document is created in Firestore. A JWT is returned to the client.
2.  **Login (`/api/auth/login`)**: The user is authenticated against Firebase. If successful, a JWT is generated and returned to the client.
3.  **API Requests**: All protected API endpoints require a valid JWT in the `Authorization` header.

```
Authorization: Bearer <jwt-token>
```

The `authMiddleware` in the backend verifies the JWT for protected routes. Role-based access is also handled by this middleware.

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Detailed error message"
  }
}
```

## Public Endpoints

### Health Check
- **GET** `/health`
- **Description**: Check server health status.
- **Authentication**: None required.

### API Information
- **GET** `/`
- **Description**: Get API information.
- **Authentication**: None required.

## Auth Endpoints

### Register User
- **POST** `/api/auth/register`
- **Description**: Register a new user.
- **Body**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Test User",
  "role": "student"
}
```

### Login User
- **POST** `/api/auth/login`
- **Description**: Login a user.
- **Body**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Get User Profile
- **GET** `/api/auth/profile`
- **Description**: Get the profile of the currently authenticated user.
- **Authentication**: JWT required.

### Logout User
- **POST** `/api/auth/logout`
- **Description**: Logout the user (currently returns a success message).
- **Authentication**: JWT required.

## Admin Endpoints

All admin endpoints require authentication and admin role.

### User Management

#### Set User Role
- **POST** `/api/admin/users/:uid/set-role`
- **Description**: Set or update a user's role.

#### Get User Details
- **GET** `/api/admin/users/:uid`
- **Description**: Get detailed information for a specific user.

#### List All Users
- **GET** `/api/admin/users`
- **Description**: List all users with pagination.

### Course Management

#### Create Course
- **POST** `/api/admin/courses`
- **Description**: Create a new course.

#### List Courses
- **GET** `/api/admin/courses`
- **Description**: List all courses with pagination and filtering.

#### Update Course
- **PUT** `/api/admin/courses/:courseId`
- **Description**: Update an existing course.

#### Delete Course
- **DELETE** `/api/admin/courses/:courseId`
- **Description**: Delete a course.

### Batch Management

#### Create Batch
- **POST** `/api/admin/batches`
- **Description**: Create a new batch.

#### Update Batch
- **PUT** `/api/admin/batches/:batchId`
- **Description**: Update an existing batch.

#### List Batches
- **GET** `/api/admin/batches`
- **Description**: List all batches with pagination and filtering.

#### Publish Batch
- **PUT** `/api/admin/batches/:batchId/publish`
- **Description**: Publish a batch after content validation.

### Subject Management

#### Create Subject
- **POST** `/api/admin/batches/:batchId/subjects`
- **Description**: Create a new subject for a batch.

#### Assign Teacher to Subject
- **PUT** `/api/admin/subjects/:subjectId/assign-teacher`
- **Description**: Assign a teacher to a subject.

#### List Subjects for Batch
- **GET** `/api/admin/batches/:batchId/subjects`
- **Description**: List all subjects for a specific batch.

#### Get All Subjects
- **GET** `/api/admin/subjects`
- **Description**: List all subjects across all batches.

#### Get Subject Details
- **GET** `/api/admin/subjects/:subjectId`
- **Description**: Get details of a single subject.

#### Update Subject
- **PUT** `/api/admin/subjects/:subjectId`
- **Description**: Update subject details.

#### Delete Subject
- **DELETE** `/api/admin/subjects/:subjectId`
- **Description**: Soft delete a subject.

### File Management

#### Upload File
- **POST** `/api/admin/upload`
- **Description**: Upload a file (e.g., course thumbnail) to Firebase Storage.

### Announcements

#### Create Batch Announcement
- **POST** `/api/admin/batches/:batchId/announcements`
- **Description**: Create an announcement for a specific batch.

### Analytics

#### Get Dashboard Stats
- **GET** `/api/admin/dashboard/stats`
- **Description**: Get dashboard statistics.

#### Get Enrollment Analytics
- **GET** `/api/admin/analytics/enrollments`
- **Description**: Get detailed enrollment statistics.

#### Get Progress Tracking Analytics
- **GET** `/api/admin/analytics/progress`
- **Description**: Get student progress statistics.

## Teacher Endpoints

All teacher endpoints require authentication and teacher role.

### Get My Subjects
- **GET** `/api/teacher/my-subjects`
- **Description**: Get all subjects assigned to the authenticated teacher.

### Get Subject Details
- **GET** `/api/teacher/subjects/:subjectId`
- **Description**: Get detailed information about a specific assigned subject.

### Update Subject Description
- **PUT** `/api/teacher/subjects/:subjectId`
- **Description**: Update the description of an assigned subject.

### Content Management

#### Generate Mux Upload URL
- **POST** `/api/teacher/generate-upload-url`
- **Description**: Get a signed upload URL for video content.

#### Generate PDF Upload URL
- **POST** `/api/teacher/generate-pdf-upload-url`
- **Description**: Get a signed upload URL for PDF content.

#### Schedule Content
- **POST** `/api/teacher/schedule`
- **Description**: Schedule a new content item.

#### Get Subject Schedule
- **GET** `/api/teacher/subjects/:subjectId/schedule`
- **Description**: Fetch the full content schedule for a subject.

## Student Endpoints

All student endpoints require authentication and student role.

### Enrollment and Payment (Razorpay)

#### Create Razorpay Order
- **POST** `/api/student/batches/:batchId/create-order`
- **Description**: Create a Razorpay order for batch enrollment.

#### Verify Payment and Enroll
- **POST** `/api/student/payment/verify`
- **Description**: Verify the Razorpay payment and complete the enrollment.

### My Learning

#### Get My Enrolled Batches
- **GET** `/api/student/my-batches`
- **Description**: View all batches the student is enrolled in.

#### Get Batch Content
- **GET** `/api/student/batches/:batchId/content`
- **Description**: Access content for an enrolled batch.

### Notifications

#### Get My Notifications
- **GET** `/api/student/notifications`
- **Description**: Get notifications for the authenticated student.

#### Get Unread Notification Count
- **GET** `/api/student/notifications/unread-count`
- **Description**: Get the count of unread notifications.

#### Mark Notification as Read
- **PUT** `/api/student/notifications/:notificationId/read`
- **Description**: Mark a specific notification as read.

#### Mark All Notifications as Read
- **PUT** `/api/student/notifications/mark-all-read`
- **Description**: Mark all notifications as read.

## Webhook Endpoints

### Mux Webhook
- **POST** `/api/webhooks/mux`
- **Description**: Handles webhook events from Mux for video processing.

## Error Codes

| Status Code | Error Code | Description |
|-------------|------------|-------------|
| 400 | VALIDATION_ERROR | Invalid request parameters or body. |
| 401 | UNAUTHORIZED | Missing or invalid authentication token. |
| 403 | FORBIDDEN | Insufficient permissions for the requested action. |
| 404 | NOT_FOUND | Requested resource does not exist. |
| 409 | CONFLICT | Resource already exists or conflicts with the current state. |
| 500 | SERVER_ERROR | An internal server error occurred. |

## Firestore Collections

Refer to the following documentation files for Firestore collection schemas:
- [Users Collection](./users-collection.md)
- [Courses Collection](./courses-collection.md)
- [Batches Collection](./batches-collection.md)
- [Subjects Collection](./subjects-collection.md)
- [Enrollments Collection](./enrollments-collection.md)
- [Schedule Collection](./content-scheduling.md)
- [Notifications Collection](./notification-system.md)
- [Announcements Collection](./announcements-collection.md)
