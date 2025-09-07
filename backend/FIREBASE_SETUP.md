# Firebase Setup Guide

## Step 1: Create/Access Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Either create a new project or select your existing project
3. Click on your project name

## Step 2: Generate Service Account Key

1. In your Firebase project, click the **gear icon** ⚙️ (Project Settings)
2. Go to the **"Service accounts"** tab
3. Click **"Generate new private key"** button
4. Download the JSON file (keep it safe!)

## Step 3: Update .env File

Replace the placeholder values in `backend/.env` with values from the downloaded JSON file:

```env
# Firebase Configuration (Real Values)
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_PRIVATE_KEY_ID=your-actual-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour-actual-private-key-content\n-----END PRIVATE KEY-----"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-actual-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com/
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

## Step 4: Map JSON to Environment Variables

From the downloaded JSON file, map these values:

| JSON Field | Environment Variable |
|------------|---------------------|
| `project_id` | `FIREBASE_PROJECT_ID` |
| `private_key_id` | `FIREBASE_PRIVATE_KEY_ID` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `client_id` | `FIREBASE_CLIENT_ID` |

## Step 5: Enable Required Services

In Firebase Console:

1. **Authentication**: Enable Email/Password provider
2. **Firestore Database**: Create database in production mode
3. **Storage**: Enable Firebase Storage
4. **Realtime Database**: Enable (if using)

## Step 6: Set Firestore Rules

Go to Firestore Database > Rules and set appropriate security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Add more rules as needed for other collections
  }
}
```

## Step 7: Test Connection

After updating .env, restart the server:
```bash
node server.js
```

You should see:
```
✅ Firebase Admin SDK initialized successfully
📊 Project ID: your-actual-project-id
📧 Service Account: firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

## Troubleshooting

If you see errors:
1. Check that all environment variables are set correctly
2. Ensure the private key includes the BEGIN/END lines
3. Verify the service account has proper permissions
4. Check that the project ID matches exactly