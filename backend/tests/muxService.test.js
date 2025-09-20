const muxService = require('../services/muxService');
const { db } = require('../config/firebase');
const notificationService = require('./notificationService');
const crypto = require('crypto');

// Mock Mux SDK
const mockMux = {
  video: {
    uploads: {
      create: jest.fn()
    },
    assets: {
      retrieve: jest.fn(),
      delete: jest.fn()
    },
    liveStreams: {
      create: jest.fn(),
      retrieve: jest.fn(),
      delete: jest.fn()
    }
  }
};

jest.mock('@mux/mux-node', () => {
  return jest.fn().mockImplementation(() => mockMux);
});

// Mock Firebase
jest.mock('../config/firebase', () => ({
  db: {
    collection: jest.fn(),
    doc: jest.fn()
  }
}));

// Mock notification service
jest.mock('./notificationService', () => ({
  notifyLiveStreamStarted: jest.fn(),
  notifyLiveStreamEnded: jest.fn(),
  notifyRecordingAvailable: jest.fn()
}));

// Mock crypto for signature verification
jest.mock('crypto', () => ({
  createHmac: jest.fn(),
  timingSafeEqual: jest.fn()
}));

describe('MuxService', () => {
  let mockCollection, mockDoc, mockGet, mockSet, mockUpdate;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup Firebase mocks
    mockSet = jest.fn();
    mockUpdate = jest.fn();
    mockGet = jest.fn();
    
    mockDoc = jest.fn(() => ({
      id: 'mock-doc-id',
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    }));
    
    mockCollection = jest.fn(() => ({
      doc: mockDoc,
      get: mockGet
    }));
    
    db.collection.mockReturnValue({
      doc: mockDoc,
      get: mockGet
    });

    db.doc.mockReturnValue({
      set: mockSet,
      update: mockUpdate,
      get: mockGet
    });

    // Setup environment variables
    process.env.MUX_TOKEN_ID = 'test-token-id';
    process.env.MUX_TOKEN_SECRET = 'test-token-secret';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.MUX_WEBHOOK_SECRET = 'test-webhook-secret';
  });

  describe('generateUploadUrl', () => {
    it('should generate upload URL with old parameter format (scheduleId, metadata)', async () => {
      const scheduleId = 'schedule123';
      const metadata = { title: 'Test Video', duration: 300 };

      const mockUpload = {
        url: 'https://storage.googleapis.com/mux-uploads/test-upload-url',
        id: 'upload123',
        asset_id: 'asset123'
      };

      mockMux.video.uploads.create.mockResolvedValue(mockUpload);

      const result = await muxService.generateUploadUrl(scheduleId, metadata);

      expect(result).toEqual({
        uploadUrl: mockUpload.url,
        uploadId: mockUpload.id,
        assetId: mockUpload.asset_id
      });

      expect(mockMux.video.uploads.create).toHaveBeenCalledWith({
        new_asset_settings: {
          playback_policy: ['public'],
          passthrough: scheduleId,
          metadata: {
            schedule_id: scheduleId,
            ...metadata
          }
        },
        cors_origin: 'http://localhost:3000'
      });
    });

    it('should generate upload URL with new parameter format (options object)', async () => {
      const options = {
        passthrough: 'custom-passthrough',
        metadata: { title: 'New Video', instructor: 'John Doe' }
      };

      const mockUpload = {
        url: 'https://storage.googleapis.com/mux-uploads/test-upload-url-2',
        id: 'upload456',
        asset_id: 'asset456'
      };

      mockMux.video.uploads.create.mockResolvedValue(mockUpload);

      const result = await muxService.generateUploadUrl(options);

      expect(result).toEqual({
        uploadUrl: mockUpload.url,
        uploadId: mockUpload.id,
        assetId: mockUpload.asset_id
      });

      expect(mockMux.video.uploads.create).toHaveBeenCalledWith({
        new_asset_settings: {
          playback_policy: ['public'],
          passthrough: 'custom-passthrough',
          metadata: options.metadata
        },
        cors_origin: 'http://localhost:3000'
      });
    });

    it('should handle Mux API error', async () => {
      const scheduleId = 'schedule123';

      mockMux.video.uploads.create.mockRejectedValue(new Error('Mux API error'));

      await expect(muxService.generateUploadUrl(scheduleId)).rejects.toThrow('Failed to generate upload URL');
    });

    it('should use default passthrough when not provided', async () => {
      const options = {
        metadata: { title: 'Test Video' }
      };

      const mockUpload = {
        url: 'https://storage.googleapis.com/mux-uploads/test',
        id: 'upload789',
        asset_id: 'asset789'
      };

      mockMux.video.uploads.create.mockResolvedValue(mockUpload);

      await muxService.generateUploadUrl(options);

      expect(mockMux.video.uploads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          new_asset_settings: expect.objectContaining({
            passthrough: expect.stringMatching(/^upload_\d+$/)
          })
        })
      );
    });
  });

  describe('handleWebhook', () => {
    it('should handle video.asset.ready event successfully', async () => {
      const event = {
        type: 'video.asset.ready',
        data: {
          id: 'asset123',
          passthrough: 'schedule456',
          playback_ids: [
            { id: 'playback123', policy: 'public' }
          ],
          duration: 1800
        }
      };

      // Mock schedule document
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          title: 'Test Video',
          batchId: 'batch123'
        })
      });

      mockUpdate.mockResolvedValue();

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        muxPlaybackId: 'playback123',
        muxAssetId: 'asset123',
        duration: 1800,
        status: 'ready',
        updatedAt: expect.any(Object)
      });
    });

    it('should handle missing passthrough in asset', async () => {
      const event = {
        type: 'video.asset.ready',
        data: {
          id: 'asset123',
          playback_ids: [
            { id: 'playback123', policy: 'public' }
          ]
        }
      };

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle missing public playback ID', async () => {
      const event = {
        type: 'video.asset.ready',
        data: {
          id: 'asset123',
          passthrough: 'schedule456',
          playback_ids: [
            { id: 'playback123', policy: 'signed' }
          ]
        }
      };

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle schedule document not found', async () => {
      const event = {
        type: 'video.asset.ready',
        data: {
          id: 'asset123',
          passthrough: 'nonexistent-schedule',
          playback_ids: [
            { id: 'playback123', policy: 'public' }
          ]
        }
      };

      mockGet.mockResolvedValue({
        exists: false
      });

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should handle live stream events', async () => {
      const event = {
        type: 'video.live_stream.active',
        data: {
          id: 'live123',
          passthrough: 'schedule789'
        }
      };

      jest.spyOn(muxService, 'handleLiveStreamWebhook').mockResolvedValue(true);

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(true);
      expect(muxService.handleLiveStreamWebhook).toHaveBeenCalledWith(event);
    });

    it('should handle asset created by live stream', async () => {
      const event = {
        type: 'video.asset.created',
        data: {
          id: 'asset123',
          created_by_live_stream_id: 'live456'
        }
      };

      jest.spyOn(muxService, 'handleLiveStreamWebhook').mockResolvedValue(true);

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(true);
      expect(muxService.handleLiveStreamWebhook).toHaveBeenCalledWith(event);
    });

    it('should handle unknown event types', async () => {
      const event = {
        type: 'video.unknown.event',
        data: {}
      };

      const result = await muxService.handleWebhook(event);

      expect(result).toBe(true); // Should return true for unknown events
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const rawBody = 'test-webhook-body';
      const signature = 'valid-signature';
      const expectedSignature = 'valid-signature';

      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue(expectedSignature)
      };

      crypto.createHmac.mockReturnValue(mockHmac);
      crypto.timingSafeEqual.mockReturnValue(true);

      const result = muxService.verifyWebhookSignature(rawBody, signature);

      expect(result).toBe(true);
      expect(crypto.createHmac).toHaveBeenCalledWith('sha256', 'test-webhook-secret');
      expect(mockHmac.update).toHaveBeenCalledWith(rawBody);
      expect(mockHmac.digest).toHaveBeenCalledWith('hex');
    });

    it('should reject invalid webhook signature', () => {
      const rawBody = 'test-webhook-body';
      const signature = 'invalid-signature';
      const expectedSignature = 'valid-signature';

      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue(expectedSignature)
      };

      crypto.createHmac.mockReturnValue(mockHmac);
      crypto.timingSafeEqual.mockReturnValue(false);

      const result = muxService.verifyWebhookSignature(rawBody, signature);

      expect(result).toBe(false);
    });

    it('should handle signature verification error', () => {
      const rawBody = 'test-webhook-body';
      const signature = 'test-signature';

      crypto.createHmac.mockImplementation(() => {
        throw new Error('Crypto error');
      });

      const result = muxService.verifyWebhookSignature(rawBody, signature);

      expect(result).toBe(false);
    });
  });

  describe('getAsset', () => {
    it('should retrieve asset successfully', async () => {
      const assetId = 'asset123';
      const mockAsset = {
        id: 'asset123',
        status: 'ready',
        playback_ids: [{ id: 'playback123', policy: 'public' }],
        duration: 1800
      };

      mockMux.video.assets.retrieve.mockResolvedValue(mockAsset);

      const result = await muxService.getAsset(assetId);

      expect(result).toEqual(mockAsset);
      expect(mockMux.video.assets.retrieve).toHaveBeenCalledWith(assetId);
    });

    it('should handle asset not found', async () => {
      const assetId = 'nonexistent';

      mockMux.video.assets.retrieve.mockRejectedValue(new Error('Asset not found'));

      await expect(muxService.getAsset(assetId)).rejects.toThrow('Failed to retrieve asset');
    });
  });

  describe('deleteAsset', () => {
    it('should delete asset successfully', async () => {
      const assetId = 'asset123';

      mockMux.video.assets.delete.mockResolvedValue({ id: assetId });

      const result = await muxService.deleteAsset(assetId);

      expect(result).toBe(true);
      expect(mockMux.video.assets.delete).toHaveBeenCalledWith(assetId);
    });

    it('should handle asset deletion error', async () => {
      const assetId = 'asset123';

      mockMux.video.assets.delete.mockRejectedValue(new Error('Deletion failed'));

      await expect(muxService.deleteAsset(assetId)).rejects.toThrow('Failed to delete asset');
    });
  });

  describe('createLiveStream', () => {
    it('should create live stream successfully', async () => {
      const scheduleId = 'schedule123';
      const options = {
        playback_policy: ['public'],
        new_asset_settings: {
          playback_policy: ['public']
        }
      };

      const mockLiveStream = {
        id: 'live123',
        playback_ids: [{ id: 'playback456', policy: 'public' }],
        stream_key: 'stream-key-123'
      };

      mockMux.video.liveStreams.create.mockResolvedValue(mockLiveStream);

      // Mock schedule document update
      mockUpdate.mockResolvedValue();

      const result = await muxService.createLiveStream(scheduleId, options);

      expect(result).toEqual({
        liveStreamId: 'live123',
        playbackId: 'playback456',
        streamKey: 'stream-key-123'
      });

      expect(mockMux.video.liveStreams.create).toHaveBeenCalledWith({
        passthrough: scheduleId,
        playback_policy: ['public'],
        new_asset_settings: {
          playback_policy: ['public']
        }
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        liveStreamId: 'live123',
        playbackId: 'playback456',
        streamKey: 'stream-key-123',
        isLive: false,
        updatedAt: expect.any(Object)
      });
    });

    it('should handle live stream creation error', async () => {
      const scheduleId = 'schedule123';

      mockMux.video.liveStreams.create.mockRejectedValue(new Error('Live stream creation failed'));

      await expect(muxService.createLiveStream(scheduleId)).rejects.toThrow('Failed to create live stream');
    });

    it('should handle missing public playback ID in live stream', async () => {
      const scheduleId = 'schedule123';

      const mockLiveStream = {
        id: 'live123',
        playback_ids: [{ id: 'playback456', policy: 'signed' }],
        stream_key: 'stream-key-123'
      };

      mockMux.video.liveStreams.create.mockResolvedValue(mockLiveStream);

      await expect(muxService.createLiveStream(scheduleId)).rejects.toThrow('Failed to create live stream');
    });
  });

  describe('getLiveStream', () => {
    it('should retrieve live stream successfully', async () => {
      const liveStreamId = 'live123';
      const mockLiveStream = {
        id: 'live123',
        status: 'active',
        playback_ids: [{ id: 'playback456', policy: 'public' }]
      };

      mockMux.video.liveStreams.retrieve.mockResolvedValue(mockLiveStream);

      const result = await muxService.getLiveStream(liveStreamId);

      expect(result).toEqual(mockLiveStream);
      expect(mockMux.video.liveStreams.retrieve).toHaveBeenCalledWith(liveStreamId);
    });

    it('should handle live stream not found', async () => {
      const liveStreamId = 'nonexistent';

      mockMux.video.liveStreams.retrieve.mockRejectedValue(new Error('Live stream not found'));

      await expect(muxService.getLiveStream(liveStreamId)).rejects.toThrow('Failed to retrieve live stream');
    });
  });

  describe('deleteLiveStream', () => {
    it('should delete live stream successfully', async () => {
      const liveStreamId = 'live123';

      mockMux.video.liveStreams.delete.mockResolvedValue({ id: liveStreamId });

      const result = await muxService.deleteLiveStream(liveStreamId);

      expect(result).toBe(true);
      expect(mockMux.video.liveStreams.delete).toHaveBeenCalledWith(liveStreamId);
    });

    it('should handle live stream deletion error', async () => {
      const liveStreamId = 'live123';

      mockMux.video.liveStreams.delete.mockRejectedValue(new Error('Deletion failed'));

      await expect(muxService.deleteLiveStream(liveStreamId)).rejects.toThrow('Failed to delete live stream');
    });
  });

  describe('handleLiveStreamWebhook', () => {
    it('should handle live stream active event', async () => {
      const event = {
        type: 'video.live_stream.active',
        data: {
          id: 'live123',
          passthrough: 'schedule456'
        }
      };

      // Mock schedule document
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          title: 'Live Class',
          batchId: 'batch123'
        })
      });

      mockUpdate.mockResolvedValue();
      notificationService.notifyLiveStreamStarted.mockResolvedValue(true);

      const result = await muxService.handleLiveStreamWebhook(event);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        isLive: true,
        liveStatus: 'active',
        updatedAt: expect.any(Object)
      });
      expect(notificationService.notifyLiveStreamStarted).toHaveBeenCalledWith('batch123', {
        title: 'Live Class',
        liveStreamId: 'live123'
      });
    });

    it('should handle live stream idle event', async () => {
      const event = {
        type: 'video.live_stream.idle',
        data: {
          id: 'live123',
          passthrough: 'schedule456'
        }
      };

      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          title: 'Live Class',
          batchId: 'batch123'
        })
      });

      mockUpdate.mockResolvedValue();
      notificationService.notifyLiveStreamEnded.mockResolvedValue(true);

      const result = await muxService.handleLiveStreamWebhook(event);

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        isLive: false,
        liveStatus: 'idle',
        updatedAt: expect.any(Object)
      });
      expect(notificationService.notifyLiveStreamEnded).toHaveBeenCalledWith('batch123', {
        title: 'Live Class',
        liveStreamId: 'live123'
      });
    });

    it('should handle asset created from live stream', async () => {
      const event = {
        type: 'video.asset.created',
        data: {
          id: 'asset123',
          created_by_live_stream_id: 'live456',
          playback_ids: [{ id: 'playback789', policy: 'public' }]
        }
      };

      // Mock live stream schedule lookup
      mockGet.mockResolvedValue({
        docs: [{
          id: 'schedule789',
          data: () => ({
            title: 'Recorded Class',
            batchId: 'batch456'
          })
        }]
      });

      mockUpdate.mockResolvedValue();
      notificationService.notifyRecordingAvailable.mockResolvedValue(true);

      const result = await muxService.handleLiveStreamWebhook(event);

      expect(result).toBe(true);
      expect(notificationService.notifyRecordingAvailable).toHaveBeenCalledWith('batch456', {
        title: 'Recorded Class',
        assetId: 'asset123',
        playbackId: 'playback789'
      });
    });

    it('should handle schedule not found for live stream event', async () => {
      const event = {
        type: 'video.live_stream.active',
        data: {
          id: 'live123',
          passthrough: 'nonexistent-schedule'
        }
      };

      mockGet.mockResolvedValue({
        exists: false
      });

      const result = await muxService.handleLiveStreamWebhook(event);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});