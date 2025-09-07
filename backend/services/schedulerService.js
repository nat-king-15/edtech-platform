const cron = require('node-cron');
const { db } = require('../config/firebase');
const muxService = require('./muxService');
const notificationService = require('./notificationService');

class SchedulerService {
  constructor() {
    this.scheduledTasks = new Map();
    this.init();
  }

  /**
   * Initialize the scheduler service
   */
  init() {
    console.log('🕒 Scheduler Service initialized');
    
    // Run every minute to check for scheduled live streams
    cron.schedule('* * * * *', () => {
      this.checkScheduledLiveStreams();
    });

    // Run every 5 minutes to check for completed recordings
    cron.schedule('*/5 * * * *', () => {
      this.checkAndConvertRecordings();
    });

    // Send reminders for upcoming live streams every minute
    cron.schedule('* * * * *', () => {
      this.sendLiveStreamReminders();
    });

    // Load existing scheduled live streams on startup
    this.loadScheduledLiveStreams();
  }

  /**
   * Load existing scheduled live streams from database
   */
  async loadScheduledLiveStreams() {
    try {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours

      // Get all scheduled live streams (without complex where clauses to avoid index requirement)
      const scheduledStreamsSnapshot = await db.collection('schedule')
        .where('contentType', '==', 'LIVE_TOPIC')
        .where('status', '==', 'scheduled')
        .get();

      // Filter in memory to avoid index requirement
      const futureStreams = scheduledStreamsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const scheduledAt = data.scheduledAt.toDate();
        return scheduledAt > now && scheduledAt <= futureTime;
      });

      console.log(`📅 Loaded ${futureStreams.length} scheduled live streams`);

      futureStreams.forEach(doc => {
        const data = doc.data();
        this.scheduleTask(doc.id, data.scheduledAt.toDate());
      });
    } catch (error) {
      console.error('Error loading scheduled live streams:', error);
    }
  }

  /**
   * Check for scheduled live streams that need to start
   */
  async checkScheduledLiveStreams() {
    try {
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      // Get all scheduled live streams (without complex where clauses to avoid index requirement)
      const scheduledStreamsSnapshot = await db
        .collection('schedule')
        .where('contentType', '==', 'LIVE_TOPIC')
        .where('status', '==', 'scheduled')
        .get();

      // Filter in memory to avoid index requirement
      const streamsToStart = scheduledStreamsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const scheduledAt = data.scheduledAt.toDate();
        return scheduledAt <= fiveMinutesFromNow && scheduledAt > now;
      });

      if (streamsToStart.length === 0) {
        console.log('No scheduled live streams found to start');
        return;
      }

      for (const doc of streamsToStart) {
        const scheduleId = doc.id;
        const data = doc.data();
        
        if (!this.scheduledTasks.has(scheduleId)) {
          console.log(`⏰ Starting live stream for schedule: ${scheduleId}`);
          await this.startLiveStream(scheduleId, data);
        }
      }
    } catch (error) {
      console.error('Error checking scheduled live streams:', error);
    }
  }

  /**
   * Schedule a task for a specific live stream
   * @param {string} scheduleId - Schedule document ID
   * @param {Date} scheduledTime - When to start the stream
   */
  scheduleTask(scheduleId, scheduledTime) {
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Stream should have already started
      console.log(`⚠️ Live stream ${scheduleId} was scheduled in the past`);
      return;
    }

    if (delay > 24 * 60 * 60 * 1000) {
      // Don't schedule tasks more than 24 hours in advance
      console.log(`📅 Live stream ${scheduleId} scheduled too far in advance`);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        console.log(`🎬 Auto-starting live stream: ${scheduleId}`);
        const scheduleDoc = await db.collection('schedule').doc(scheduleId).get();
        if (scheduleDoc.exists) {
          await this.startLiveStream(scheduleId, scheduleDoc.data());
        }
        this.scheduledTasks.delete(scheduleId);
      } catch (error) {
        console.error(`Error auto-starting live stream ${scheduleId}:`, error);
      }
    }, delay);

    this.scheduledTasks.set(scheduleId, timeoutId);
    console.log(`⏰ Scheduled live stream ${scheduleId} to start at ${scheduledTime.toISOString()}`);
  }

  /**
   * Start a live stream
   * @param {string} scheduleId - Schedule document ID
   * @param {Object} scheduleData - Schedule document data
   */
  async startLiveStream(scheduleId, scheduleData) {
    try {
      // Create live stream in Mux
      const liveStreamData = await muxService.createLiveStream(scheduleId, {
        metadata: {
          title: scheduleData.title,
          description: scheduleData.description,
          chapterId: scheduleData.chapterId,
          subjectId: scheduleData.subjectId,
          batchId: scheduleData.batchId
        }
      });

      // Update schedule document with live stream details
      await db.collection('schedule').doc(scheduleId).update({
        liveStreamId: liveStreamData.liveStreamId,
        streamKey: liveStreamData.streamKey,
        livePlaybackIds: liveStreamData.playbackIds,
        rtmpUrl: liveStreamData.rtmpUrl,
        liveStreamStatus: 'ready',
        status: 'live_ready',
        updatedAt: new Date()
      });

      // Send notifications to enrolled students
      await this.notifyStudents(scheduleData);

      console.log(`✅ Live stream created successfully for schedule: ${scheduleId}`);
      console.log(`🔑 Stream Key: ${liveStreamData.streamKey}`);
      console.log(`📺 RTMP URL: ${liveStreamData.rtmpUrl}`);

    } catch (error) {
      console.error(`Error starting live stream for schedule ${scheduleId}:`, error);
      
      // Update status to failed
      await db.collection('schedule').doc(scheduleId).update({
        status: 'failed',
        error: error.message,
        updatedAt: new Date()
      });
    }
  }

  /**
   * Notify students about live stream
   * @param {Object} scheduleData - Schedule document data
   */
  async notifyStudents(scheduleData) {
    try {
      // Get enrolled students for the batch
      const enrollments = await db.collection('enrollments')
        .where('batchId', '==', scheduleData.batchId)
        .where('status', '==', 'active')
        .get();

      const studentIds = enrollments.docs.map(doc => doc.data().studentId);

      if (studentIds.length > 0) {
        await notificationService.sendBulkNotification({
          userIds: studentIds,
          title: `Live Class Started: ${scheduleData.title}`,
          message: `Your live class for ${scheduleData.title} has started. Join now!`,
          type: 'live_stream_started',
          data: {
            scheduleId: scheduleData.id,
            chapterId: scheduleData.chapterId,
            subjectId: scheduleData.subjectId,
            batchId: scheduleData.batchId
          }
        });

        console.log(`📢 Notified ${studentIds.length} students about live stream`);
      }
    } catch (error) {
      console.error('Error notifying students:', error);
    }
  }

  /**
   * Cancel a scheduled live stream
   * @param {string} scheduleId - Schedule document ID
   */
  cancelScheduledStream(scheduleId) {
    if (this.scheduledTasks.has(scheduleId)) {
      clearTimeout(this.scheduledTasks.get(scheduleId));
      this.scheduledTasks.delete(scheduleId);
      console.log(`❌ Cancelled scheduled live stream: ${scheduleId}`);
    }
  }

  /**
   * Add a new scheduled live stream
   * @param {string} scheduleId - Schedule document ID
   * @param {Date} scheduledTime - When to start the stream
   */
  addScheduledStream(scheduleId, scheduledTime) {
    this.scheduleTask(scheduleId, scheduledTime);
  }

  /**
   * Convert live stream recording to regular topic video
   * @param {string} scheduleId - Schedule document ID
   */
  async convertRecordingToTopicVideo(scheduleId) {
    try {
      const scheduleDoc = await db.collection('schedule').doc(scheduleId).get();
      if (!scheduleDoc.exists) {
        console.error(`Schedule document not found: ${scheduleId}`);
        return;
      }

      const scheduleData = scheduleDoc.data();
      
      // Check if recording is ready and not already converted
      if (scheduleData.recordingStatus !== 'ready' || scheduleData.convertedToTopicVideo) {
        return;
      }

      // Create a new content document for the topic video
      const contentData = {
        title: scheduleData.title,
        description: scheduleData.description || `Recorded live session: ${scheduleData.title}`,
        type: 'topic_video',
        muxPlaybackId: scheduleData.recordingPlaybackId,
        muxAssetId: scheduleData.recordingAssetId,
        duration: 0, // Will be updated when asset info is available
        chapterId: scheduleData.chapterId,
        subjectId: scheduleData.subjectId,
        batchId: scheduleData.batchId,
        createdBy: scheduleData.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
        isFromLiveStream: true,
        originalScheduleId: scheduleId
      };

      // Add the content to the chapter
      const contentRef = await db.collection('chapters')
        .doc(scheduleData.chapterId)
        .collection('content')
        .add(contentData);

      // Update the schedule document to mark as converted
      await db.collection('schedule').doc(scheduleId).update({
        convertedToTopicVideo: true,
        topicVideoContentId: contentRef.id,
        conversionCompletedAt: new Date(),
        updatedAt: new Date()
      });

      // Notify students about the recording availability
      await notificationService.notifyRecordingAvailable(scheduleData.batchId, {
        title: scheduleData.title,
        contentId: contentRef.id,
        chapterId: scheduleData.chapterId
      });

      console.log(`✅ Converted live stream recording to topic video: ${scheduleId} -> ${contentRef.id}`);

    } catch (error) {
      console.error(`Error converting recording to topic video for schedule ${scheduleId}:`, error);
    }
  }

  /**
   * Send reminders for upcoming live streams
   */
  async sendLiveStreamReminders() {
    try {
      const now = new Date();
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const sixteenMinutesFromNow = new Date(now.getTime() + 16 * 60 * 1000);

      // Get scheduled live streams starting in 15-16 minutes
      const scheduledStreamsSnapshot = await db.collection('schedule')
        .where('contentType', '==', 'LIVE_TOPIC')
        .where('status', '==', 'scheduled')
        .get();

      // Filter for streams starting in 15-16 minutes (1-minute window)
      const streamsForReminder = scheduledStreamsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const scheduledAt = data.scheduledAt.toDate();
        return scheduledAt >= fifteenMinutesFromNow && scheduledAt <= sixteenMinutesFromNow;
      });

      if (streamsForReminder.length === 0) {
        return;
      }

      console.log(`📢 Sending reminders for ${streamsForReminder.length} upcoming live streams`);

      // Send reminders for each stream
      for (const doc of streamsForReminder) {
        const data = doc.data();
        
        if (data.batchId) {
          await notificationService.sendLiveStreamReminder(data.batchId, {
            scheduleId: doc.id,
            title: data.title || 'Live Class',
            scheduledAt: data.scheduledAt.toDate()
          }, 15);
        }
      }
    } catch (error) {
      console.error('Error sending live stream reminders:', error);
    }
  }

  /**
   * Check for completed recordings and convert them to topic videos
   */
  async checkAndConvertRecordings() {
    try {
      const readyRecordings = await db.collection('schedule')
        .where('contentType', '==', 'LIVE_TOPIC')
        .where('recordingStatus', '==', 'ready')
        .where('convertedToTopicVideo', '==', false)
        .get();

      for (const doc of readyRecordings.docs) {
        await this.convertRecordingToTopicVideo(doc.id);
      }

      if (readyRecordings.size > 0) {
        console.log(`🎬 Processed ${readyRecordings.size} recording conversions`);
      }
    } catch (error) {
      console.error('Error checking and converting recordings:', error);
    }
  }

  /**
   * Update a scheduled live stream
   * @param {string} scheduleId - Schedule document ID
   * @param {Date} newScheduledTime - New scheduled time
   */
  updateScheduledStream(scheduleId, newScheduledTime) {
    this.cancelScheduledStream(scheduleId);
    this.scheduleTask(scheduleId, newScheduledTime);
  }
}

module.exports = new SchedulerService();