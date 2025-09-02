const Mux = require('@mux/mux-node');
const { db } = require('../config/firebase');

// Initialize Mux client
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

class MuxService {
  /**
   * Generate a signed upload URL for direct video upload to Mux
   * @param {string} scheduleId - The Firestore document ID for the schedule
   * @param {Object} metadata - Additional metadata for the video
   * @returns {Promise<Object>} Upload URL and asset ID
   */
  async generateUploadUrl(scheduleId, metadata = {}) {
    try {
      const upload = await mux.video.uploads.create({
        new_asset_settings: {
          playback_policy: ['public'],
          passthrough: scheduleId, // This will help us identify the schedule document in webhook
          metadata: {
            schedule_id: scheduleId,
            ...metadata
          }
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
      if (event.type === 'video.asset.ready') {
        const asset = event.data;
        const scheduleId = asset.passthrough;

        if (!scheduleId) {
          console.warn('No schedule ID found in asset passthrough');
          return false;
        }

        // Get playback IDs (we'll use the first public one)
        const playbackIds = asset.playback_ids || [];
        const publicPlaybackId = playbackIds.find(p => p.policy === 'public');

        if (!publicPlaybackId) {
          console.warn('No public playback ID found for asset:', asset.id);
          return false;
        }

        // Update the schedule document with the playback ID
        const scheduleRef = db.collection('schedule').doc(scheduleId);
        await scheduleRef.update({
          muxPlaybackId: publicPlaybackId.id,
          muxAssetId: asset.id,
          status: 'ready',
          updatedAt: new Date()
        });

        console.log(`Updated schedule ${scheduleId} with playback ID: ${publicPlaybackId.id}`);
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
}

module.exports = new MuxService();