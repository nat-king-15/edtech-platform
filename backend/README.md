# EdTech Platform Backend

A robust Node.js/Express.js backend API for an educational technology platform with Firebase integration, user authentication, and role-based access control.

## Features

- **Firebase Authentication**: Secure user authentication with JWT tokens
- **Role-Based Access Control**: Support for student, teacher, and admin roles
- **User Management**: Admin endpoints for managing user roles and profiles
- **Course Management**: Create and manage educational courses
- **Batch Management**: Organize courses into batches with teacher assignments
- **Subject Management**: Create subjects within batches and assign teachers
- **Teacher Dashboard**: Teachers can view and manage their assigned subjects
- **Email Notifications**: Automatic email notifications for teacher assignments
- **Firestore Integration**: Real-time database for storing all platform data
- **Email Services**: Nodemailer integration for notifications
- **Video Processing**: Mux integration for video content management
- **CORS Support**: Cross-origin resource sharing enabled
- **Environment Configuration**: Secure environment variable management
- **Comprehensive Documentation**: Detailed Firestore collection schemas

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Email**: Nodemailer
- **Video**: Mux
- **Environment**: dotenv

## Project Structure

```
backend/
├── config/
│   └── firebase.js          # Firebase Admin SDK configuration
├── middleware/
│   └── authMiddleware.js     # Authentication and authorization middleware
├── routes/
│   ├── admin.js             # Admin-specific API routes
│   └── teacher.js           # Teacher-specific API routes
├── utils/
│   └── emailService.js      # Email notification service
├── docs/
│   ├── users-collection.md  # Firestore users collection documentation
│   ├── courses-collection.md # Firestore courses collection documentation
│   ├── batches-collection.md # Firestore batches collection documentation
│   └── subjects-collection.md # Firestore subjects collection documentation
├── .env                     # Environment variables (not in git)
├── server.js               # Main application entry point
├── package.json            # Project dependencies and scripts
└── README.md              # This file
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd edtech/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   - Copy `.env.example` to `.env`
   - Fill in your Firebase configuration details
   - Add your Firebase Admin SDK service account credentials

4. **Start the server**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Public Endpoints

- `GET /` - Health check endpoint
- `GET /health` - Server health status

### Admin Endpoints (Requires Authentication + Admin Role)

#### User Management
- `POST /api/admin/users/:uid/set-role` - Set user role
- `GET /api/admin/users/:uid` - Get user details
- `GET /api/admin/users` - List all users (with pagination)

#### Course Management
- `POST /api/admin/courses` - Create new course
- `GET /api/admin/courses` - List all courses (with pagination and filtering)

#### Batch Management
- `POST /api/admin/batches` - Create new batch
- `PUT /api/admin/batches/:batchId` - Update existing batch
- `GET /api/admin/batches` - List all batches (with pagination and filtering)

#### Subject Management
- `POST /api/admin/batches/:batchId/subjects` - Create subject for a batch
- `PUT /api/admin/subjects/:subjectId/assign-teacher` - Assign teacher to subject (with email notification)
- `GET /api/admin/batches/:batchId/subjects` - List subjects for a batch

### Teacher Endpoints (Requires Authentication + Teacher Role)

- `GET /api/teacher/my-subjects` - Get all subjects assigned to the teacher
- `GET /api/teacher/subjects/:subjectId` - Get specific subject details
- `PUT /api/teacher/subjects/:subjectId` - Update subject description

## Authentication

### Firebase Token Authentication

All protected endpoints require a Firebase ID token in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

### Getting a Firebase ID Token

```javascript
// Frontend JavaScript example
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();
const userCredential = await signInWithEmailAndPassword(auth, email, password);
const idToken = await userCredential.user.getIdToken();

// Use idToken in API requests
fetch('/api/admin/users', {
  headers: {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json'
  }
});
```

## User Roles

- **student**: Default role for regular users
- **teacher**: Instructors who can create and manage courses
- **admin**: Platform administrators with full access

## Environment Variables

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project-rtdb.firebaseio.com
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef
FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Firebase Admin SDK
FIREBASE_PRIVATE_KEY_ID=key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=123456789
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token

# Email Configuration (for notifications)
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
FRONTEND_URL=http://localhost:3000
```

## Usage Examples

### Setting User Role (Admin Only)

```bash
curl -X POST http://localhost:3000/api/admin/users/user-uid-123/set-role \
  -H "Authorization: Bearer <admin-firebase-token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "teacher"}'
```

### Getting User Details (Admin Only)

```bash
curl -X GET http://localhost:3000/api/admin/users/user-uid-123 \
  -H "Authorization: Bearer <admin-firebase-token>"
```

### Listing All Users (Admin Only)

```bash
curl -X GET "http://localhost:3000/api/admin/users?limit=10" \
  -H "Authorization: Bearer <admin-firebase-token>"
```

### Creating a Course (Admin Only)

```bash
curl -X POST http://localhost:3000/api/admin/courses \
  -H "Authorization: Bearer <admin-firebase-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "JavaScript Fundamentals",
    "category": "Programming",
    "thumbnailUrl": "https://example.com/thumbnail.jpg",
    "description": "Learn JavaScript from basics to advanced",
    "tags": ["javascript", "programming", "web-development"]
  }'
```

### Creating a Batch (Admin Only)

```bash
curl -X POST http://localhost:3000/api/admin/batches \
  -H "Authorization: Bearer <admin-firebase-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "JS Batch 2024",
    "courseId": "course-id-123",
    "description": "JavaScript batch for 2024",
    "price": 5000,
    "teachers": [{"uid": "teacher-uid", "name": "John Doe", "email": "john@example.com"}],
    "startDate": "2024-01-15",
    "status": "published",
    "maxStudents": 50
  }'
```

### Creating a Subject (Admin Only)

```bash
curl -X POST http://localhost:3000/api/admin/batches/batch-id-123/subjects \
  -H "Authorization: Bearer <admin-firebase-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Variables and Data Types",
    "description": "Introduction to JavaScript variables and data types"
  }'
```

### Assigning Teacher to Subject (Admin Only)

```bash
curl -X PUT http://localhost:3000/api/admin/subjects/subject-id-123/assign-teacher \
  -H "Authorization: Bearer <admin-firebase-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "teacherId": "teacher-uid-456",
    "teacherName": "Jane Smith",
    "teacherEmail": "jane@example.com"
  }'
```

### Getting Teacher's Subjects (Teacher Only)

```bash
curl -X GET "http://localhost:3000/api/teacher/my-subjects?limit=10" \
  -H "Authorization: Bearer <teacher-firebase-token>"
```

## Development

### Running in Development Mode

```bash
npm run dev
```

This uses nodemon for automatic server restarts on file changes.

### Code Style

- Use ES6+ features
- Follow consistent indentation (2 spaces)
- Use meaningful variable and function names
- Add comments for complex logic
- Handle errors appropriately

## Security Considerations

1. **Environment Variables**: Never commit `.env` files to version control
2. **Firebase Rules**: Implement proper Firestore security rules
3. **Input Validation**: Validate all user inputs
4. **Error Handling**: Don't expose sensitive information in error messages
5. **HTTPS**: Use HTTPS in production
6. **Rate Limiting**: Implement rate limiting for API endpoints

## Error Handling

The API returns consistent error responses:

```json
{
  "error": "Error Type",
  "message": "Detailed error message"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Internal Server Error

## Logging

The server logs important events:
- Server startup
- Firebase initialization
- Authentication errors
- API endpoint access
- Error details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License - see LICENSE file for details