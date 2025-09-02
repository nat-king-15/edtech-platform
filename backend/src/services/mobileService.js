const admin = require('firebase-admin');
const db = admin.firestore();
const { logAuditEvent } = require('../../middleware/auditLogger');

class MobileService {
  constructor() {
    this.offlineContentCache = new Map();
    this.syncQueue = new Map();
  }

  // Get mobile-optimized course content
  async getMobileCourseContent(courseId, userId, options = {}) {
    try {
      const {
        includeVideos = true,
        includeAssignments = true,
        includeQuizzes = true,
        compression = 'medium',
        maxVideoQuality = '720p'
      } = options;

      // Get course basic info
      const courseDoc = await db.collection('courses').doc(courseId).get();
      if (!courseDoc.exists) {
        throw new Error('Course not found');
      }

      const courseData = courseDoc.data();
      const mobileContent = {
        id: courseId,
        title: courseData.title,
        description: courseData.description,
        thumbnail: courseData.thumbnail,
        duration: courseData.duration,
        lastUpdated: courseData.updatedAt,
        modules: []
      };

      // Get modules with mobile-optimized content
      const modulesSnapshot = await db.collection('courses')
        .doc(courseId)
        .collection('modules')
        .orderBy('order')
        .get();

      for (const moduleDoc of modulesSnapshot.docs) {
        const moduleData = moduleDoc.data();
        const mobileModule = {
          id: moduleDoc.id,
          title: moduleData.title,
          description: moduleData.description,
          order: moduleData.order,
          estimatedTime: moduleData.estimatedTime,
          content: []
        };

        // Get lessons with mobile optimization
        const lessonsSnapshot = await db.collection('courses')
          .doc(courseId)
          .collection('modules')
          .doc(moduleDoc.id)
          .collection('lessons')
          .orderBy('order')
          .get();

        for (const lessonDoc of lessonsSnapshot.docs) {
          const lessonData = lessonDoc.data();
          const mobileLesson = {
            id: lessonDoc.id,
            title: lessonData.title,
            type: lessonData.type,
            order: lessonData.order,
            duration: lessonData.duration,
            isOfflineAvailable: lessonData.isOfflineAvailable || false
          };

          // Optimize video content for mobile
          if (includeVideos && lessonData.type === 'video') {
            mobileLesson.video = await this.optimizeVideoForMobile(
              lessonData.videoUrl,
              maxVideoQuality,
              compression
            );
          }

          // Include text content with compression
          if (lessonData.content) {
            mobileLesson.content = this.compressTextContent(
              lessonData.content,
              compression
            );
          }

          // Add downloadable resources
          if (lessonData.resources) {
            mobileLesson.resources = lessonData.resources.map(resource => ({
              id: resource.id,
              title: resource.title,
              type: resource.type,
              size: resource.size,
              downloadUrl: resource.downloadUrl,
              isOfflineAvailable: resource.isOfflineAvailable || false
            }));
          }

          mobileModule.content.push(mobileLesson);
        }

        mobileContent.modules.push(mobileModule);
      }

      // Add assignments if requested
      if (includeAssignments) {
        mobileContent.assignments = await this.getMobileAssignments(courseId, userId);
      }

      // Add quizzes if requested
      if (includeQuizzes) {
        mobileContent.quizzes = await this.getMobileQuizzes(courseId, userId);
      }

      // Log mobile content access
      const mockReq = {
        user: { id: userId },
        ip: '127.0.0.1',
        get: () => 'Mobile App'
      };
      await logAuditEvent('MOBILE_CONTENT_ACCESS', mockReq, {
        courseId,
        contentSize: JSON.stringify(mobileContent).length,
        compression,
        includeVideos,
        includeAssignments,
        includeQuizzes
      });

      return mobileContent;
    } catch (error) {
      console.error('Error getting mobile course content:', error);
      throw error;
    }
  }

  // Optimize video content for mobile devices
  async optimizeVideoForMobile(videoUrl, maxQuality = '720p', compression = 'medium') {
    try {
      // In a real implementation, this would integrate with video processing services
      // For now, return optimized video metadata
      const qualityMap = {
        '480p': { width: 854, height: 480, bitrate: '1000k' },
        '720p': { width: 1280, height: 720, bitrate: '2500k' },
        '1080p': { width: 1920, height: 1080, bitrate: '5000k' }
      };

      const selectedQuality = qualityMap[maxQuality] || qualityMap['720p'];

      return {
        originalUrl: videoUrl,
        mobileUrl: videoUrl, // In real implementation, this would be the optimized URL
        quality: maxQuality,
        resolution: `${selectedQuality.width}x${selectedQuality.height}`,
        estimatedSize: this.calculateVideoSize(selectedQuality.bitrate, 600), // 10 minutes average
        isStreamingOptimized: true,
        supportedFormats: ['mp4', 'webm'],
        thumbnails: {
          small: `${videoUrl}_thumb_small.jpg`,
          medium: `${videoUrl}_thumb_medium.jpg`
        }
      };
    } catch (error) {
      console.error('Error optimizing video for mobile:', error);
      return null;
    }
  }

  // Compress text content for mobile
  compressTextContent(content, compression = 'medium') {
    if (!content) return null;

    const compressionLevels = {
      low: { maxLength: 10000, summarize: false },
      medium: { maxLength: 5000, summarize: true },
      high: { maxLength: 2000, summarize: true }
    };

    const level = compressionLevels[compression] || compressionLevels.medium;

    if (content.length <= level.maxLength) {
      return content;
    }

    if (level.summarize) {
      // Simple text summarization (in real implementation, use AI summarization)
      const sentences = content.split('. ');
      const targetSentences = Math.ceil(sentences.length * 0.6); // Keep 60% of sentences
      return sentences.slice(0, targetSentences).join('. ') + '.';
    }

    return content.substring(0, level.maxLength) + '...';
  }

  // Get mobile-optimized assignments
  async getMobileAssignments(courseId, userId) {
    try {
      const assignmentsSnapshot = await db.collection('assignments')
        .where('courseId', '==', courseId)
        .where('isActive', '==', true)
        .orderBy('dueDate')
        .get();

      const mobileAssignments = [];

      for (const assignmentDoc of assignmentsSnapshot.docs) {
        const assignmentData = assignmentDoc.data();
        
        // Get user's submission status
        const submissionDoc = await db.collection('assignments')
          .doc(assignmentDoc.id)
          .collection('submissions')
          .doc(userId)
          .get();

        const mobileAssignment = {
          id: assignmentDoc.id,
          title: assignmentData.title,
          description: this.compressTextContent(assignmentData.description, 'medium'),
          dueDate: assignmentData.dueDate,
          maxPoints: assignmentData.maxPoints,
          type: assignmentData.type,
          status: submissionDoc.exists ? 'submitted' : 'pending',
          isOfflineAvailable: assignmentData.allowOfflineWork || false,
          estimatedTime: assignmentData.estimatedTime
        };

        if (submissionDoc.exists) {
          const submissionData = submissionDoc.data();
          mobileAssignment.submission = {
            submittedAt: submissionData.submittedAt,
            grade: submissionData.grade,
            feedback: submissionData.feedback
          };
        }

        mobileAssignments.push(mobileAssignment);
      }

      return mobileAssignments;
    } catch (error) {
      console.error('Error getting mobile assignments:', error);
      return [];
    }
  }

  // Get mobile-optimized quizzes
  async getMobileQuizzes(courseId, userId) {
    try {
      const quizzesSnapshot = await db.collection('quizzes')
        .where('courseId', '==', courseId)
        .where('isActive', '==', true)
        .orderBy('createdAt')
        .get();

      const mobileQuizzes = [];

      for (const quizDoc of quizzesSnapshot.docs) {
        const quizData = quizDoc.data();
        
        // Get user's attempt status
        const attemptsSnapshot = await db.collection('quizzes')
          .doc(quizDoc.id)
          .collection('attempts')
          .where('userId', '==', userId)
          .orderBy('attemptedAt', 'desc')
          .limit(1)
          .get();

        const mobileQuiz = {
          id: quizDoc.id,
          title: quizData.title,
          description: this.compressTextContent(quizData.description, 'medium'),
          questionCount: quizData.questions?.length || 0,
          timeLimit: quizData.timeLimit,
          maxAttempts: quizData.maxAttempts,
          passingScore: quizData.passingScore,
          isOfflineAvailable: false, // Quizzes typically require online submission
          estimatedTime: quizData.estimatedTime
        };

        if (!attemptsSnapshot.empty) {
          const latestAttempt = attemptsSnapshot.docs[0].data();
          mobileQuiz.lastAttempt = {
            score: latestAttempt.score,
            attemptedAt: latestAttempt.attemptedAt,
            passed: latestAttempt.score >= quizData.passingScore
          };
        }

        mobileQuizzes.push(mobileQuiz);
      }

      return mobileQuizzes;
    } catch (error) {
      console.error('Error getting mobile quizzes:', error);
      return [];
    }
  }

  // Sync offline data when device comes online
  async syncOfflineData(userId, offlineData) {
    try {
      const syncResults = {
        successful: [],
        failed: [],
        conflicts: []
      };

      // Process video progress updates
      if (offlineData.videoProgress) {
        for (const progress of offlineData.videoProgress) {
          try {
            await this.syncVideoProgress(userId, progress);
            syncResults.successful.push({
              type: 'video_progress',
              id: progress.videoId,
              timestamp: progress.timestamp
            });
          } catch (error) {
            syncResults.failed.push({
              type: 'video_progress',
              id: progress.videoId,
              error: error.message
            });
          }
        }
      }

      // Process assignment submissions
      if (offlineData.assignments) {
        for (const assignment of offlineData.assignments) {
          try {
            await this.syncAssignmentSubmission(userId, assignment);
            syncResults.successful.push({
              type: 'assignment',
              id: assignment.assignmentId,
              timestamp: assignment.submittedAt
            });
          } catch (error) {
            syncResults.failed.push({
              type: 'assignment',
              id: assignment.assignmentId,
              error: error.message
            });
          }
        }
      }

      // Process forum interactions
      if (offlineData.forumInteractions) {
        for (const interaction of offlineData.forumInteractions) {
          try {
            await this.syncForumInteraction(userId, interaction);
            syncResults.successful.push({
              type: 'forum_interaction',
              id: interaction.id,
              timestamp: interaction.timestamp
            });
          } catch (error) {
            syncResults.failed.push({
              type: 'forum_interaction',
              id: interaction.id,
              error: error.message
            });
          }
        }
      }

      // Log sync activity
      const mockReq = {
        user: { id: userId },
        ip: '127.0.0.1',
        get: () => 'Mobile App'
      };
      await logAuditEvent('OFFLINE_DATA_SYNC', mockReq, {
        totalItems: offlineData.totalItems || 0,
        successful: syncResults.successful.length,
        failed: syncResults.failed.length,
        conflicts: syncResults.conflicts.length
      });

      return syncResults;
    } catch (error) {
      console.error('Error syncing offline data:', error);
      throw error;
    }
  }

  // Sync video progress from offline data
  async syncVideoProgress(userId, progressData) {
    try {
      const { videoId, progress, watchTime, timestamp } = progressData;
      
      // Check for conflicts with existing data
      const existingDoc = await db.collection('videoProgress')
        .where('userId', '==', userId)
        .where('videoId', '==', videoId)
        .limit(1)
        .get();

      if (!existingDoc.empty) {
        const existingData = existingDoc.docs[0].data();
        
        // Use the most recent timestamp
        if (existingData.lastWatched && existingData.lastWatched.toDate() > new Date(timestamp)) {
          return; // Existing data is more recent
        }
      }

      // Update or create progress record
      const progressRef = existingDoc.empty ? 
        db.collection('videoProgress').doc() :
        existingDoc.docs[0].ref;

      await progressRef.set({
        userId,
        videoId,
        progress: Math.max(progress, existingDoc.empty ? 0 : existingDoc.docs[0].data().progress),
        watchTime: (existingDoc.empty ? 0 : existingDoc.docs[0].data().watchTime) + watchTime,
        lastWatched: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
        syncedFromOffline: true
      }, { merge: true });
    } catch (error) {
      console.error('Error syncing video progress:', error);
      throw error;
    }
  }

  // Sync assignment submission from offline data
  async syncAssignmentSubmission(userId, submissionData) {
    try {
      const { assignmentId, content, submittedAt, attachments } = submissionData;
      
      // Check if assignment still accepts submissions
      const assignmentDoc = await db.collection('assignments').doc(assignmentId).get();
      if (!assignmentDoc.exists) {
        throw new Error('Assignment not found');
      }

      const assignmentData = assignmentDoc.data();
      if (assignmentData.dueDate && assignmentData.dueDate.toDate() < new Date(submittedAt)) {
        throw new Error('Assignment submission is past due date');
      }

      // Check for existing submission
      const existingSubmission = await db.collection('assignments')
        .doc(assignmentId)
        .collection('submissions')
        .doc(userId)
        .get();

      if (existingSubmission.exists) {
        const existingData = existingSubmission.data();
        if (existingData.submittedAt && existingData.submittedAt.toDate() > new Date(submittedAt)) {
          return; // Existing submission is more recent
        }
      }

      // Create or update submission
      await db.collection('assignments')
        .doc(assignmentId)
        .collection('submissions')
        .doc(userId)
        .set({
          userId,
          assignmentId,
          content,
          attachments: attachments || [],
          submittedAt: admin.firestore.Timestamp.fromDate(new Date(submittedAt)),
          syncedFromOffline: true,
          status: 'submitted'
        }, { merge: true });
    } catch (error) {
      console.error('Error syncing assignment submission:', error);
      throw error;
    }
  }

  // Sync forum interaction from offline data
  async syncForumInteraction(userId, interactionData) {
    try {
      const { type, topicId, replyId, content, timestamp } = interactionData;
      
      switch (type) {
        case 'topic_vote':
          await this.syncTopicVote(userId, topicId, interactionData.voteType, timestamp);
          break;
        case 'reply_vote':
          await this.syncReplyVote(userId, replyId, interactionData.voteType, timestamp);
          break;
        case 'reply_create':
          await this.syncReplyCreation(userId, topicId, content, timestamp);
          break;
        default:
          throw new Error(`Unknown interaction type: ${type}`);
      }
    } catch (error) {
      console.error('Error syncing forum interaction:', error);
      throw error;
    }
  }

  // Get offline content package for download
  async getOfflineContentPackage(userId, courseId, options = {}) {
    try {
      const {
        includeVideos = false, // Videos are large, opt-in only
        includeResources = true,
        maxPackageSize = 100 * 1024 * 1024 // 100MB default limit
      } = options;

      const offlinePackage = {
        courseId,
        userId,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        content: {},
        estimatedSize: 0
      };

      // Get course content optimized for offline use
      const courseContent = await this.getMobileCourseContent(courseId, userId, {
        includeVideos: false, // Text content only for offline
        compression: 'high'
      });

      offlinePackage.content.course = courseContent;
      offlinePackage.estimatedSize += JSON.stringify(courseContent).length;

      // Add downloadable resources if requested
      if (includeResources) {
        const resources = await this.getOfflineResources(courseId, maxPackageSize - offlinePackage.estimatedSize);
        offlinePackage.content.resources = resources;
        offlinePackage.estimatedSize += resources.totalSize || 0;
      }

      // Log offline package generation
      const mockReq = {
        user: { id: userId },
        ip: '127.0.0.1',
        get: () => 'Mobile App'
      };
      await logAuditEvent('OFFLINE_PACKAGE_GENERATED', mockReq, {
        courseId,
        packageSize: offlinePackage.estimatedSize,
        includeVideos,
        includeResources
      });

      return offlinePackage;
    } catch (error) {
      console.error('Error generating offline content package:', error);
      throw error;
    }
  }

  // Get resources suitable for offline download
  async getOfflineResources(courseId, maxSize) {
    try {
      const resourcesSnapshot = await db.collection('courses')
        .doc(courseId)
        .collection('resources')
        .where('isOfflineAvailable', '==', true)
        .orderBy('size')
        .get();

      const resources = [];
      let totalSize = 0;

      for (const resourceDoc of resourcesSnapshot.docs) {
        const resourceData = resourceDoc.data();
        
        if (totalSize + resourceData.size <= maxSize) {
          resources.push({
            id: resourceDoc.id,
            title: resourceData.title,
            type: resourceData.type,
            size: resourceData.size,
            downloadUrl: resourceData.downloadUrl,
            checksum: resourceData.checksum
          });
          totalSize += resourceData.size;
        }
      }

      return {
        resources,
        totalSize,
        totalCount: resources.length
      };
    } catch (error) {
      console.error('Error getting offline resources:', error);
      return { resources: [], totalSize: 0, totalCount: 0 };
    }
  }

  // Calculate estimated video size
  calculateVideoSize(bitrate, durationSeconds) {
    // Convert bitrate (e.g., '2500k') to bytes per second
    const bitrateNum = parseInt(bitrate.replace('k', '')) * 1000;
    const bytesPerSecond = bitrateNum / 8; // Convert bits to bytes
    return Math.round(bytesPerSecond * durationSeconds);
  }

  // Sync topic vote
  async syncTopicVote(userId, topicId, voteType, timestamp) {
    const voteRef = db.collection('forumTopics')
      .doc(topicId)
      .collection('votes')
      .doc(userId);

    await voteRef.set({
      userId,
      topicId,
      voteType,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
      syncedFromOffline: true
    }, { merge: true });
  }

  // Sync reply vote
  async syncReplyVote(userId, replyId, voteType, timestamp) {
    const voteRef = db.collection('forumReplies')
      .doc(replyId)
      .collection('votes')
      .doc(userId);

    await voteRef.set({
      userId,
      replyId,
      voteType,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
      syncedFromOffline: true
    }, { merge: true });
  }

  // Sync reply creation
  async syncReplyCreation(userId, topicId, content, timestamp) {
    const replyRef = db.collection('forumReplies').doc();
    
    await replyRef.set({
      id: replyRef.id,
      topicId,
      userId,
      content,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
      updatedAt: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
      syncedFromOffline: true,
      upvotes: 0,
      downvotes: 0,
      isEdited: false
    });
  }
}

module.exports = new MobileService();