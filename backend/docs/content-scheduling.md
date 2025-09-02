# Content Scheduling System Documentation

## Overview

The Content Scheduling System allows teachers to schedule and manage educational content including video lectures, lecture notes, and practice problems (DPPs) with integrated Mux video processing capabilities.

## Firestore Collections

### `schedule` Collection

The `schedule` collection is a top-level Firestore collection that stores all scheduled content items across the platform.

#### Collection Structure
```
schedule/
├── {scheduleId}/
│   ├── batchId: string          # Reference to batch document ID
│   ├── subjectId: string        # Reference to subject document ID
│   ├── title: string            # Content title
│   ├── contentType: string      # Content type enum
│   ├── scheduledAt: timestamp   # When content is scheduled
│   ├── status: string           # Processing status
│   ├── teacherId: string        # Teacher who created the content
│   ├── muxPlaybackId?: string   # Mux playback ID (for videos)
│   ├── muxAssetId?: string      # Mux asset ID (for videos)
│   ├── fileUrl?: string         # Firebase Storage URL (for PDFs)
│   ├── createdAt: timestamp     # Document creation time
│   └── updatedAt: timestamp     # Last update time
```

#### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `batchId` | string | Yes | Reference to the batch this content belongs to |
| `subjectId` | string | Yes | Reference to the subject this content belongs to |
| `title` | string | Yes | Human-readable title for the content |
| `contentType` | enum | Yes | Type of content (see Content Types below) |
| `scheduledAt` | timestamp | Yes | When the content is scheduled to be available |
| `status` | enum | Yes | Current processing status (see Status Values below) |
| `teacherId` | string | Yes | UID of the teacher who created this content |
| `muxPlaybackId` | string | No | Mux playback ID for video content (populated by webhook) |
| `muxAssetId` | string | No | Mux asset ID for video content (populated by webhook) |
| `fileUrl` | string | No | Firebase Storage URL for PDF content |
| `createdAt` | timestamp | Yes | When the document was created |
| `updatedAt` | timestamp | Yes | When the document was last updated |

#### Content Types

The `contentType` field accepts the following enum values:

- `VIDEO_LECTURE` - Video lecture content uploaded to Mux
- `LECTURE_NOTES_PDF` - PDF lecture notes stored in Firebase Storage
- `DPP_PDF` - Daily Practice Problem PDF stored in Firebase Storage
- `DPP_VIDEO_SOLUTION` - Video solution for DPP uploaded to Mux

#### Status Values

The `status` field tracks the processing state:

- `pending` - Content scheduled but not yet processed
- `uploading` - Video is being uploaded to Mux
- `processing` - Mux is processing the video
- `ready` - Content is ready for consumption
- `failed` - Processing failed
- `archived` - Content has been archived

## API Endpoints

### Teacher Endpoints

#### Generate Mux Upload URL
```http
POST /api/teacher/generate-upload-url
Authorization: Bearer <firebase-token>
Content-Type: application/json

{
  "title": "Introduction to Calculus",
  "subjectId": "subject123",
  "batchId": "batch456",
  "contentType": "VIDEO_LECTURE"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Upload URL generated successfully",
  "data": {
    "scheduleId": "schedule789",
    "uploadUrl": "https://storage.mux.com/...",
    "uploadId": "upload123"
  }
}
```

#### Schedule Content
```http
POST /api/teacher/schedule
Authorization: Bearer <firebase-token>
Content-Type: application/json

{
  "batchId": "batch456",
  "subjectId": "subject123",
  "title": "Chapter 1 Notes",
  "contentType": "LECTURE_NOTES_PDF",
  "scheduledAt": "2024-01-15T10:00:00Z",
  "fileUrl": "https://firebasestorage.googleapis.com/..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Content scheduled successfully",
  "data": {
    "scheduleId": "schedule789",
    "batchId": "batch456",
    "subjectId": "subject123",
    "title": "Chapter 1 Notes",
    "contentType": "LECTURE_NOTES_PDF",
    "scheduledAt": "2024-01-15T10:00:00.000Z",
    "status": "ready",
    "teacherId": "teacher123",
    "fileUrl": "https://firebasestorage.googleapis.com/...",
    "createdAt": "2024-01-10T08:30:00.000Z",
    "updatedAt": "2024-01-10T08:30:00.000Z"
  }
}
```

#### Get Subject Schedule
```http
GET /api/teacher/subjects/{subjectId}/schedule?limit=20&offset=0&contentType=VIDEO_LECTURE&status=ready
Authorization: Bearer <firebase-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Schedule retrieved successfully",
  "data": {
    "scheduleItems": [
      {
        "scheduleId": "schedule789",
        "batchId": "batch456",
        "subjectId": "subject123",
        "title": "Introduction to Calculus",
        "contentType": "VIDEO_LECTURE",
        "scheduledAt": "2024-01-15T10:00:00.000Z",
        "status": "ready",
        "teacherId": "teacher123",
        "muxPlaybackId": "playback123",
        "muxAssetId": "asset456",
        "createdAt": "2024-01-10T08:30:00.000Z",
        "updatedAt": "2024-01-10T09:15:00.000Z"
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    },
    "subject": {
      "subjectId": "subject123",
      "name": "Mathematics",
      "code": "MATH101"
    }
  }
}
```

### Webhook Endpoints

#### Mux Webhook Handler
```http
POST /api/webhooks/mux
Content-Type: application/json
Mux-Signature: <mux-signature>

{
  "type": "video.asset.ready",
  "id": "event123",
  "created_at": "2024-01-10T09:15:00Z",
  "data": {
    "id": "asset456",
    "passthrough": "schedule789",
    "playback_ids": [
      {
        "id": "playback123",
        "policy": "public"
      }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

## Mux Integration Workflow

### Video Upload Process

1. **Teacher initiates upload**
   - Teacher calls `POST /api/teacher/generate-upload-url`
   - System creates initial schedule document with `status: 'uploading'`
   - Mux SDK generates signed upload URL with schedule ID in passthrough

2. **Frontend uploads video**
   - Frontend uses the upload URL to upload video directly to Mux
   - Mux begins processing the video

3. **Mux processes video**
   - Mux transcodes video and generates playback IDs
   - When ready, Mux sends `video.asset.ready` webhook

4. **Webhook updates schedule**
   - Webhook handler receives event
   - Extracts schedule ID from passthrough field
   - Updates schedule document with `muxPlaybackId` and `status: 'ready'`

### Video Playback

- Use the `muxPlaybackId` to construct playback URLs:
  - HLS: `https://stream.mux.com/{playbackId}.m3u8`
  - MP4: `https://stream.mux.com/{playbackId}.mp4`

## Security Considerations

### Authentication
- All teacher endpoints require Firebase authentication
- Teachers can only access content for subjects they're assigned to
- Webhook endpoint is public but signature-verified

### Authorization
- Teachers can only create/view content for their assigned subjects
- Batch and subject existence is verified before content creation
- Mux webhook signature verification prevents unauthorized updates

### Data Validation
- All required fields are validated
- Content types are restricted to predefined enums
- File URLs are validated for PDF content types

## Error Handling

### Common Error Responses

```json
{
  "error": "Validation Error",
  "message": "Title, subjectId, batchId, and contentType are required"
}
```

```json
{
  "error": "Access Denied",
  "message": "You are not assigned to this subject"
}
```

```json
{
  "error": "Subject Not Found",
  "message": "Subject does not exist"
}
```

## Monitoring and Logging

### Key Metrics to Monitor
- Video upload success/failure rates
- Webhook processing latency
- Content scheduling frequency
- Mux asset processing times

### Log Events
- Schedule document creation
- Mux upload URL generation
- Webhook event processing
- Content status updates

## Best Practices

### For Frontend Developers
1. Always handle upload progress and errors gracefully
2. Poll schedule status after upload completion
3. Implement retry logic for failed uploads
4. Cache playback URLs appropriately

### For Backend Developers
1. Monitor webhook delivery and processing
2. Implement proper error handling for Mux API calls
3. Use Firestore transactions for critical updates
4. Log all significant events for debugging

### For Content Creators
1. Use descriptive titles for better organization
2. Schedule content appropriately for student access
3. Verify content before scheduling
4. Monitor upload status and retry if needed