const Mux = require('@mux/mux-node');
const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const notificationService = require('./notificationService');

// Initialize Mux client
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

class MuxService {
  /**
   * Generate a signed upload URL for direct video upload to Mux
   * @param {string|Object} scheduleIdOrOptions - The Firestore document ID for the schedule or options object
   * @param {Object} metadata - Additional metadata for the video (when first param is string)
   * @returns {Promise<Object>} Upload URL and asset ID
   */
  async generateUploadUrl(scheduleIdOrOptions, metadata = {}) {
    try {
      let scheduleId, finalMetadata;
      
      // Support both old and new parameter formats
      if (typeof scheduleIdOrOptions === 'string') {
        // Old format: generateUploadUrl(scheduleId, metadata)
        scheduleId = scheduleIdOrOptions;
        finalMetadata = {
          schedule_id: scheduleId,
          ...metadata
        };
      } else {
        // New format: generateUploadUrl({ passthrough, metadata })
        const options = scheduleIdOrOptions;
        scheduleId = options.passthrough || `upload_${Date.now()}`;
        finalMetadata = {
          ...options.metadata
        };
      }

      const upload = await mux.video.uploads.create({
        new_asset_settings: {
          playback_policy: ['public'],
          passthrough: scheduleId, // This will help us identify the document in webhook
          metadata: finalMetadata
        },
        cors_origin: process.env.FRONTEND_URL || 'http://localhost:3000'
      });

      return {
        uploadUrl: upload.url,
        uploadId: upload.id,
        assetId: upload.asset_id
      };
    } catch (error) {
      console.error('Error generating Mux upload URL:', error);
      throw new Error('Failed to generate upload URL');
    }
  }

  /**
   * Handle Mux webhook events
   * @param {Object} event - Mux webhook event
   * @returns {Promise<boolean>} Success status
   */
  async handleWebhook(event) {
    try {
      // Handle live stream events
      if (event.type.startsWith('video.live_stream.') || 
          (event.type === 'video.asset.created' && event.data.created_by_live_stream_id)) {
        return await this.handleLiveStreamWebhook(event);
      }

      if (event.type === 'video.asset.ready') {
        console.log('🎬 Processing video.asset.ready event');
        const asset = event.data;
        console.log('🎬 Asset data:', JSON.stringify(asset, null, 2));
        const passthrough = asset.passthrough;
        console.log('🎬 Passthrough:', passthrough);

        if (!passthrough) {
          console.warn('No passthrough found in asset');
          return false;
        }

        // Get playback IDs (we'll use the first public one)
        const playbackIds = asset.playback_ids || [];
        console.log('🎬 Playback IDs:', JSON.stringify(playbackIds, null, 2));
        const publicPlaybackId = playbackIds.find(p => p.policy === 'public');
        console.log('🎬 Public playback ID:', JSON.stringify(publicPlaybackId, null, 2));

        if (!publicPlaybackId) {
          console.warn('No public playback ID found for asset:', asset.id);
          return false;
        }

        // Generate Mux media URLs for the asset
        const playbackId = publicPlaybackId.id;
        const muxMetadata = {
          muxPlaybackId: playbackId,
          muxAssetId: asset.id,
          duration: asset.duration || 0,
          status: 'ready',
          // Thumbnail URLs
          thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.webp`,
          thumbnailPngUrl: `https://image.mux.com/${playbackId}/thumbnail.png`,
          thumbnailJpgUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`,
          // Animated preview URLs
          animatedGifUrl: `https://image.mux.com/${playbackId}/animated.gif`,
          animatedWebpUrl: `https://image.mux.com/${playbackId}/animated.webp`,
          // Storyboard URLs for timeline hover previews
          storyboardUrl: `https://image.mux.com/${playbackId}/storyboard.jpg`,
          storyboardWebpUrl: `https://image.mux.com/${playbackId}/storyboard.webp`,
          storyboardJsonUrl: `https://image.mux.com/${playbackId}/storyboard.json`,
          storyboardVttUrl: `https://image.mux.com/${playbackId}/storyboard.vtt`,
          // Video stream URL
          streamUrl: `https://stream.mux.com/${playbackId}.m3u8`,
          updatedAt: admin.firestore.Timestamp.fromDate(new Date()).toString()
        };
        
        // Add optional metadata only if they exist
        if (asset.aspect_ratio) muxMetadata.aspectRatio = asset.aspect_ratio;
        if (asset.resolution_tier) muxMetadata.resolutionTier = asset.resolution_tier;
        if (asset.video_quality) muxMetadata.videoQuality = asset.video_quality;
        if (asset.max_stored_frame_rate) muxMetadata.maxStoredFrameRate = asset.max_stored_frame_rate;
        
        // Clean undefined values from muxMetadata
        const cleanMuxMetadata = Object.fromEntries(
          Object.entries(muxMetadata).filter(([_, value]) => value !== undefined)
        );
        
        // Debug log the cleaned muxMetadata object
        console.log('🔍 Cleaned muxMetadata object:', JSON.stringify(cleanMuxMetadata, null, 2));
        console.log('🔍 Original muxMetadata object:', JSON.stringify(muxMetadata, null, 2));

        // Check if this is a topic content upload
        const metadata = asset.metadata || {};
        const contentType = metadata.contentType;
        
        if (contentType === 'topic_video' || contentType === 'dpp_video') {
          // Handle topic content video uploads
          const { topicId, teacherId } = metadata;
          
          if (topicId) {
            const collectionName = contentType === 'topic_video' ? 'videos' : 'dppVideos';
            
            // Find the video document by muxUploadId
            // The passthrough format is: topicId_video_timestamp or topicId_dpp_video_timestamp
            // We need to extract the upload ID from the passthrough
            let uploadIdToMatch;
            if (passthrough.includes('_video_')) {
              uploadIdToMatch = passthrough.split('_video_')[1];
            } else if (passthrough.includes('_dpp_video_')) {
              uploadIdToMatch = passthrough.split('_dpp_video_')[1];
            } else {
              uploadIdToMatch = passthrough;
            }
            
            console.log(`Looking for ${contentType} with uploadId: ${uploadIdToMatch} in topic: ${topicId}`);
            
            const videoQuery = await db.collection('topics').doc(topicId)
              .collection(collectionName)
              .where('muxUploadId', '==', uploadIdToMatch)
              .limit(1)
              .get();
            
            if (!videoQuery.empty) {
              const videoDoc = videoQuery.docs[0];
              await videoDoc.ref.update(cleanMuxMetadata);
              console.log(`Updated ${contentType} ${videoDoc.id} with complete Mux metadata: ${playbackId}`);
            } else {
              console.warn(`No ${contentType} document found with muxUploadId: ${uploadIdToMatch} in topic: ${topicId}`);
              
              // Try alternative approach - find by status 'processing'
              const processingQuery = await db.collection('topics').doc(topicId)
                .collection(collectionName)
                .where('status', '==', 'processing')
                .orderBy('uploadedAt', 'desc')
                .limit(1)
                .get();
              
              if (!processingQuery.empty) {
                const videoDoc = processingQuery.docs[0];
                await videoDoc.ref.update(cleanMuxMetadata);
                console.log(`Updated latest processing ${contentType} ${videoDoc.id} with complete Mux metadata: ${playbackId}`);
              } else {
                console.error(`No processing ${contentType} found in topic: ${topicId}`);
              }
            }
          }
        } else {
          // Check if this is a live stream recording
          if (asset.created_by_live_stream_id) {
            // Update the schedule document with recording playback ID and complete metadata
            const scheduleRef = db.collection('schedule').doc(passthrough);
            const scheduleDoc = await scheduleRef.get();
            
            if (scheduleDoc.exists) {
              await scheduleRef.update({
                ...cleanMuxMetadata,
                recordingPlaybackId: playbackId,
                recordingAssetId: asset.id,
                recordingStatus: 'ready',
                updatedAt: admin.firestore.Timestamp.fromDate(new Date())
              });
              console.log(`Updated schedule ${passthrough} with recording metadata: ${playbackId}`);
            } else {
               console.warn(`Schedule document ${passthrough} not found, skipping update`);
             }
          } else {
            // Regular video upload to schedule
            const scheduleRef = db.collection('schedule').doc(passthrough);
            const scheduleDoc = await scheduleRef.get();
            
            if (scheduleDoc.exists) {
              await scheduleRef.update(cleanMuxMetadata);
              console.log(`Updated schedule ${passthrough} with complete Mux metadata: ${playbackId}`);
            } else {
              console.warn(`Schedule document ${passthrough} not found, skipping update`);
            }
          }
        }

        return true;
      }

      // Handle other event types if needed
      console.log('Received Mux webhook event:', event.type);
      return true;
    } catch (error) {
      console.error('Error handling Mux webhook:', error);
      throw error;
    }
  }

  /**
   * Verify Mux webhook signature
   * @param {string} rawBody - Raw request body
   * @param {string} signature - Mux signature header
   * @returns {boolean} Verification result
   */
  verifyWebhookSignature(rawBody, signature) {
    try {
      return Mux.webhooks.verifyHeader(
        rawBody,
        signature,
        process.env.MUX_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error('Error verifying Mux webhook signature:', error);
      return false;
    }
  }

  /**
   * Get asset information from Mux
   * @param {string} assetId - Mux asset ID
   * @returns {Promise<Object>} Asset information
   */
  async getAsset(assetId) {
    try {
      const asset = await mux.video.assets.retrieve(assetId);
      return asset;
    } catch (error) {
      console.error('Error retrieving Mux asset:', error);
      throw new Error('Failed to retrieve asset information');
    }
  }

  /**
   * Delete an asset from Mux
   * @param {string} assetId - Mux asset ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteAsset(assetId) {
    try {
      await mux.video.assets.delete(assetId);
      return true;
    } catch (error) {
      console.error('Error deleting Mux asset:', error);
      throw new Error('Failed to delete asset');
    }
  }

  /**
   * Create a live stream
   * @param {string} scheduleId - The Firestore document ID for the schedule
   * @param {Object} options - Live stream options
   * @returns {Promise<Object>} Live stream details
   */
  async createLiveStream(scheduleId, options = {}) {
    try {
      const liveStream = await mux.video.liveStreams.create({
        playback_policy: ['public'],
        passthrough: scheduleId,
        new_asset_settings: {
          playback_policy: ['public'],
          metadata: {
            schedule_id: scheduleId,
            type: 'live_stream_recording',
            ...options.metadata
          }
        },
        reconnect_window: 60, // seconds
        ...options
      });

      return {
        liveStreamId: liveStream.id,
        streamKey: liveStream.stream_key,
        playbackIds: liveStream.playback_ids,
        status: liveStream.status,
        rtmpUrl: 'rtmp://global-live.mux.com:5222/app'
      };
    } catch (error) {
      console.error('Error creating Mux live stream:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      if (error.error && error.error.error && error.error.error.messages) {
        console.error('Mux API error messages:', error.error.error.messages);
      }
      throw new Error(`Failed to create live stream: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Get live stream information
   * @param {string} liveStreamId - Mux live stream ID
   * @returns {Promise<Object>} Live stream information
   */
  async getLiveStream(liveStreamId) {
    try {
      const liveStream = await mux.video.liveStreams.retrieve(liveStreamId);
      return liveStream;
    } catch (error) {
      console.error('Error retrieving Mux live stream:', error);
      throw new Error('Failed to retrieve live stream information');
    }
  }

  /**
   * Delete a live stream
   * @param {string} liveStreamId - Mux live stream ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteLiveStream(liveStreamId) {
    try {
      await mux.video.liveStreams.delete(liveStreamId);
      return true;
    } catch (error) {
      console.error('Error deleting Mux live stream:', error);
      throw new Error('Failed to delete live stream');
    }
  }

  /**
   * Handle live stream webhook events
   * @param {Object} event - Mux webhook event
   * @returns {Promise<boolean>} Success status
   */
  async handleLiveStreamWebhook(event) {
    try {
      const { type, data } = event;
      
      if (type === 'video.live_stream.active') {
        // Live stream started
        const liveStream = data;
        const scheduleId = liveStream.passthrough;
        
        if (scheduleId) {
          // Get schedule data for notifications
          const scheduleDoc = await db.collection('schedule').doc(scheduleId).get();
          const scheduleData = scheduleDoc.data();
          
          if (scheduleDoc.exists) {
            await db.collection('schedule').doc(scheduleId).update({
              liveStreamStatus: 'active',
              liveStreamStartedAt: admin.firestore.Timestamp.fromDate(new Date()),
              updatedAt: admin.firestore.Timestamp.fromDate(new Date())
            });
          } else {
            console.warn(`Schedule document ${scheduleId} not found for live stream start, skipping update`);
          }
          
          // Notify students that live stream has started
          if (scheduleData && scheduleData.batchId) {
            await notificationService.notifyLiveStreamStarted(scheduleData.batchId, {
              scheduleId,
              title: scheduleData.title || 'Live Class',
              playbackId: liveStream.playback_ids?.[0]?.id
            });
          }
          
          console.log(`Live stream started for schedule: ${scheduleId}`);
        }
        return true;
      }
      
      if (type === 'video.live_stream.idle') {
        // Live stream ended
        const liveStream = data;
        const scheduleId = liveStream.passthrough;
        
        if (scheduleId) {
          // Get schedule data for notifications
          const scheduleDoc = await db.collection('schedule').doc(scheduleId).get();
          const scheduleData = scheduleDoc.data();
          
          if (scheduleDoc.exists) {
            await db.collection('schedule').doc(scheduleId).update({
              liveStreamStatus: 'idle',
              liveStreamEndedAt: admin.firestore.Timestamp.fromDate(new Date()),
              updatedAt: admin.firestore.Timestamp.fromDate(new Date())
            });
          } else {
            console.warn(`Schedule document ${scheduleId} not found for live stream end, skipping update`);
          }
          
          // Notify students that live stream has ended
          if (scheduleData && scheduleData.batchId) {
            await notificationService.notifyLiveStreamEnded(scheduleData.batchId, {
              scheduleId,
              title: scheduleData.title || 'Live Class'
            });
          }
          
          console.log(`Live stream ended for schedule: ${scheduleId}`);
        }
        return true;
      }
      
      if (type === 'video.asset.created') {
        // New asset created from live stream recording
        const asset = data;
        const scheduleId = asset.passthrough;
        
        if (scheduleId && asset.created_by_live_stream_id) {
          // This is a recording from a live stream
          const scheduleDoc = await db.collection('schedule').doc(scheduleId).get();
          
          if (scheduleDoc.exists) {
            await db.collection('schedule').doc(scheduleId).update({
              recordingAssetId: asset.id,
              recordingStatus: 'processing',
              updatedAt: admin.firestore.Timestamp.fromDate(new Date())
            });
            console.log(`Recording asset created for schedule: ${scheduleId}`);
          } else {
            console.warn(`Schedule document ${scheduleId} not found for recording asset, skipping update`);
          }
        }
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error handling live stream webhook:', error);
      throw error;
    }
  }
}

module.exports = new MuxService();