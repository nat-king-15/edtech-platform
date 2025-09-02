const videoProgressService = require('../../services/videoProgressService');
const { firestore } = require('../../config/firebase');

// Mock Firestore
jest.mock('../../config/firebase', () => ({
  firestore: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        set: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({
          exists: true,
          data: () => ({
            studentId: 'test-student',
            videoId: 'test-video',
            batchId: 'test-batch',
            subjectId: 'test-subject',
            currentTime: 120,
            duration: 300,
            progressPercentage: 40,
            completed: false,
            lastWatched: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          })
        })),
        update: jest.fn(() => Promise.resolve())
      })),
      where: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({
          docs: [
            {
              id: 'progress1',
              data: () => ({
                studentId: 'test-student',
                videoId: 'test-video-1',
                progressPercentage: 100,
                completed: true,
                currentTime: 300,
                duration: 300
              })
            },
            {
              id: 'progress2',
              data: () => ({
                studentId: 'test-student',
                videoId: 'test-video-2',
                progressPercentage: 50,
                completed: false,
                currentTime: 150,
                duration: 300
              })
            }
          ]
        }))
      }))
    }))
  }
}));

describe('VideoProgressService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateProgress', () => {
    it('should update video progress successfully', async () => {
      const result = await videoProgressService.updateProgress(
        'test-student',
        'test-video',
        'test-batch',
        'test-subject',
        120,
        300,
        false
      );

      expect(result.success).toBe(true);
      expect(result.data.progressPercentage).toBe(40);
      expect(result.data.completed).toBe(false);
    });

    it('should mark video as completed when progress reaches 100%', async () => {
      const result = await videoProgressService.updateProgress(
        'test-student',
        'test-video',
        'test-batch',
        'test-subject',
        300,
        300,
        true
      );

      expect(result.success).toBe(true);
      expect(result.data.progressPercentage).toBe(100);
      expect(result.data.completed).toBe(true);
    });

    it('should handle invalid input parameters', async () => {
      await expect(
        videoProgressService.updateProgress(
          '',
          'test-video',
          'test-batch',
          'test-subject',
          120,
          300
        )
      ).rejects.toThrow('Student ID is required');
    });
  });

  describe('getProgress', () => {
    it('should fetch student progress successfully', async () => {
      const result = await videoProgressService.getProgress('test-student');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should filter progress by videoId when provided', async () => {
      const result = await videoProgressService.getProgress(
        'test-student',
        'test-video-1'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('getBatchProgressSummary', () => {
    it('should calculate batch progress summary correctly', async () => {
      const result = await videoProgressService.getBatchProgressSummary(
        'test-student',
        'test-batch'
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('completionPercentage');
      expect(result.data).toHaveProperty('videosWatched');
      expect(result.data).toHaveProperty('totalWatchTime');
    });
  });

  describe('markVideoCompleted', () => {
    it('should mark video as completed successfully', async () => {
      const result = await videoProgressService.markVideoCompleted(
        'test-student',
        'test-video'
      );

      expect(result.success).toBe(true);
      expect(result.data.completed).toBe(true);
      expect(result.data.progressPercentage).toBe(100);
    });
  });

  describe('getVideoAnalytics', () => {
    it('should fetch video analytics for a batch', async () => {
      const result = await videoProgressService.getVideoAnalytics('test-batch');

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalStudents');
      expect(result.data).toHaveProperty('studentsWatched');
      expect(result.data).toHaveProperty('averageProgress');
    });

    it('should filter analytics by videoId when provided', async () => {
      const result = await videoProgressService.getVideoAnalytics(
        'test-batch',
        'test-video-1'
      );

      expect(result.success).toBe(true);
    });
  });
});