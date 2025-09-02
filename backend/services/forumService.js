const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const { logAuditEvent, AUDIT_EVENTS, RISK_LEVELS } = require('../middleware/auditLogger');

/**
 * Forum Service
 * Handles discussion forums, threaded conversations, and voting system
 */

class ForumService {
  constructor() {
    this.db = db;
  }

  /**
   * Create a new forum topic
   */
  async createTopic(topicData, userId, userRole) {
    try {
      const { batchId, subjectId, title, content, category, tags = [], isPinned = false } = topicData;

      // Validate required fields
      if (!batchId || !title || !content) {
        throw new Error('batchId, title, and content are required');
      }

      // Check if user has access to the batch
      if (userRole === 'student') {
        const enrollment = await this.db.collection('enrollments')
          .where('userId', '==', userId)
          .where('batchId', '==', batchId)
          .where('status', '==', 'active')
          .get();
        
        if (enrollment.empty) {
          throw new Error('User not enrolled in this batch');
        }
      }

      const topic = {
        batchId,
        subjectId: subjectId || null,
        title,
        content,
        category: category || 'general',
        tags,
        authorId: userId,
        authorRole: userRole,
        isPinned: userRole === 'admin' || userRole === 'teacher' ? isPinned : false,
        isLocked: false,
        viewCount: 0,
        replyCount: 0,
        lastReplyAt: null,
        lastReplyBy: null,
        votes: {
          upvotes: 0,
          downvotes: 0,
          score: 0
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const topicRef = await this.db.collection('forum_topics').add(topic);
      
      // Create initial vote document for the author
      await this.db.collection('forum_votes').add({
        topicId: topicRef.id,
        replyId: null,
        userId,
        voteType: 'upvote',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Update vote count
      await topicRef.update({
        'votes.upvotes': admin.firestore.FieldValue.increment(1),
        'votes.score': admin.firestore.FieldValue.increment(1)
      });

      return { id: topicRef.id, ...topic };
    } catch (error) {
      console.error('Failed to create forum topic:', error);
      throw error;
    }
  }

  /**
   * Get forum topics with pagination and filtering
   */
  async getTopics(filters = {}) {
    try {
      const { 
        batchId, 
        subjectId, 
        category, 
        tags, 
        sortBy = 'createdAt', 
        sortOrder = 'desc',
        limit = 20, 
        offset = 0,
        search
      } = filters;

      let query = this.db.collection('forum_topics');

      // Apply filters
      if (batchId) {
        query = query.where('batchId', '==', batchId);
      }
      if (subjectId) {
        query = query.where('subjectId', '==', subjectId);
      }
      if (category) {
        query = query.where('category', '==', category);
      }
      if (tags && tags.length > 0) {
        query = query.where('tags', 'array-contains-any', tags);
      }

      // Apply sorting
      const validSortFields = ['createdAt', 'updatedAt', 'votes.score', 'replyCount', 'viewCount'];
      if (validSortFields.includes(sortBy)) {
        query = query.orderBy(sortBy, sortOrder);
      }

      // Apply pagination
      query = query.limit(parseInt(limit)).offset(parseInt(offset));

      const snapshot = await query.get();
      const topics = [];

      for (const doc of snapshot.docs) {
        const topicData = { id: doc.id, ...doc.data() };
        
        // Get author information
        const authorDoc = await this.db.collection('users').doc(topicData.authorId).get();
        if (authorDoc.exists) {
          const authorData = authorDoc.data();
          topicData.author = {
            id: topicData.authorId,
            name: authorData.name,
            email: authorData.email,
            role: topicData.authorRole
          };
        }

        // Filter by search term if provided
        if (search) {
          const searchTerm = search.toLowerCase();
          const titleMatch = topicData.title.toLowerCase().includes(searchTerm);
          const contentMatch = topicData.content.toLowerCase().includes(searchTerm);
          
          if (titleMatch || contentMatch) {
            topics.push(topicData);
          }
        } else {
          topics.push(topicData);
        }
      }

      return topics;
    } catch (error) {
      console.error('Failed to get forum topics:', error);
      throw error;
    }
  }

  /**
   * Get a single topic with replies
   */
  async getTopic(topicId, userId) {
    try {
      const topicDoc = await this.db.collection('forum_topics').doc(topicId).get();
      
      if (!topicDoc.exists) {
        throw new Error('Topic not found');
      }

      const topicData = { id: topicDoc.id, ...topicDoc.data() };

      // Increment view count
      await topicDoc.ref.update({
        viewCount: admin.firestore.FieldValue.increment(1)
      });

      // Get author information
      const authorDoc = await this.db.collection('users').doc(topicData.authorId).get();
      if (authorDoc.exists) {
        const authorData = authorDoc.data();
        topicData.author = {
          id: topicData.authorId,
          name: authorData.name,
          email: authorData.email,
          role: topicData.authorRole
        };
      }

      // Get user's vote on this topic
      if (userId) {
        const userVote = await this.db.collection('forum_votes')
          .where('topicId', '==', topicId)
          .where('replyId', '==', null)
          .where('userId', '==', userId)
          .get();
        
        topicData.userVote = userVote.empty ? null : userVote.docs[0].data().voteType;
      }

      // Get replies
      topicData.replies = await this.getReplies(topicId, userId);

      return topicData;
    } catch (error) {
      console.error('Failed to get forum topic:', error);
      throw error;
    }
  }

  /**
   * Create a reply to a topic or another reply
   */
  async createReply(replyData, userId, userRole) {
    try {
      const { topicId, parentReplyId, content } = replyData;

      if (!topicId || !content) {
        throw new Error('topicId and content are required');
      }

      // Verify topic exists and is not locked
      const topicDoc = await this.db.collection('forum_topics').doc(topicId).get();
      if (!topicDoc.exists) {
        throw new Error('Topic not found');
      }

      const topicData = topicDoc.data();
      if (topicData.isLocked && userRole !== 'admin' && userRole !== 'teacher') {
        throw new Error('Topic is locked');
      }

      // Check user access to batch
      if (userRole === 'student') {
        const enrollment = await this.db.collection('enrollments')
          .where('userId', '==', userId)
          .where('batchId', '==', topicData.batchId)
          .where('status', '==', 'active')
          .get();
        
        if (enrollment.empty) {
          throw new Error('User not enrolled in this batch');
        }
      }

      const reply = {
        topicId,
        parentReplyId: parentReplyId || null,
        content,
        authorId: userId,
        authorRole: userRole,
        votes: {
          upvotes: 0,
          downvotes: 0,
          score: 0
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const replyRef = await this.db.collection('forum_replies').add(reply);

      // Update topic reply count and last reply info
      await topicDoc.ref.update({
        replyCount: admin.firestore.FieldValue.increment(1),
        lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
        lastReplyBy: userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { id: replyRef.id, ...reply };
    } catch (error) {
      console.error('Failed to create forum reply:', error);
      throw error;
    }
  }

  /**
   * Get replies for a topic (threaded)
   */
  async getReplies(topicId, userId) {
    try {
      const repliesSnapshot = await this.db.collection('forum_replies')
        .where('topicId', '==', topicId)
        .orderBy('createdAt', 'asc')
        .get();

      const replies = [];
      const replyMap = new Map();

      // First pass: create reply objects
      for (const doc of repliesSnapshot.docs) {
        const replyData = { id: doc.id, ...doc.data() };
        
        // Get author information
        const authorDoc = await this.db.collection('users').doc(replyData.authorId).get();
        if (authorDoc.exists) {
          const authorData = authorDoc.data();
          replyData.author = {
            id: replyData.authorId,
            name: authorData.name,
            email: authorData.email,
            role: replyData.authorRole
          };
        }

        // Get user's vote on this reply
        if (userId) {
          const userVote = await this.db.collection('forum_votes')
            .where('topicId', '==', topicId)
            .where('replyId', '==', doc.id)
            .where('userId', '==', userId)
            .get();
          
          replyData.userVote = userVote.empty ? null : userVote.docs[0].data().voteType;
        }

        replyData.children = [];
        replyMap.set(doc.id, replyData);

        if (!replyData.parentReplyId) {
          replies.push(replyData);
        }
      }

      // Second pass: build thread structure
      for (const reply of replyMap.values()) {
        if (reply.parentReplyId && replyMap.has(reply.parentReplyId)) {
          replyMap.get(reply.parentReplyId).children.push(reply);
        }
      }

      return replies;
    } catch (error) {
      console.error('Failed to get forum replies:', error);
      throw error;
    }
  }

  /**
   * Vote on a topic or reply
   */
  async vote(voteData, userId) {
    try {
      const { topicId, replyId, voteType } = voteData;

      if (!topicId || !['upvote', 'downvote'].includes(voteType)) {
        throw new Error('Invalid vote data');
      }

      // Check if user already voted
      const existingVote = await this.db.collection('forum_votes')
        .where('topicId', '==', topicId)
        .where('replyId', '==', replyId || null)
        .where('userId', '==', userId)
        .get();

      const targetCollection = replyId ? 'forum_replies' : 'forum_topics';
      const targetId = replyId || topicId;
      const targetRef = this.db.collection(targetCollection).doc(targetId);

      if (!existingVote.empty) {
        // User already voted, update or remove vote
        const existingVoteDoc = existingVote.docs[0];
        const existingVoteData = existingVoteDoc.data();

        if (existingVoteData.voteType === voteType) {
          // Same vote type, remove vote
          await existingVoteDoc.ref.delete();
          
          const increment = voteType === 'upvote' ? -1 : 1;
          await targetRef.update({
            [`votes.${voteType}s`]: admin.firestore.FieldValue.increment(-1),
            'votes.score': admin.firestore.FieldValue.increment(increment)
          });
        } else {
          // Different vote type, update vote
          await existingVoteDoc.ref.update({
            voteType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          const oldIncrement = existingVoteData.voteType === 'upvote' ? -1 : 1;
          const newIncrement = voteType === 'upvote' ? 1 : -1;
          
          await targetRef.update({
            [`votes.${existingVoteData.voteType}s`]: admin.firestore.FieldValue.increment(-1),
            [`votes.${voteType}s`]: admin.firestore.FieldValue.increment(1),
            'votes.score': admin.firestore.FieldValue.increment(oldIncrement + newIncrement)
          });
        }
      } else {
        // New vote
        await this.db.collection('forum_votes').add({
          topicId,
          replyId: replyId || null,
          userId,
          voteType,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const increment = voteType === 'upvote' ? 1 : -1;
        await targetRef.update({
          [`votes.${voteType}s`]: admin.firestore.FieldValue.increment(1),
          'votes.score': admin.firestore.FieldValue.increment(increment)
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to vote:', error);
      throw error;
    }
  }

  /**
   * Pin/unpin a topic (admin/teacher only)
   */
  async pinTopic(topicId, isPinned, userId, userRole) {
    try {
      if (userRole !== 'admin' && userRole !== 'teacher') {
        throw new Error('Insufficient permissions');
      }

      await this.db.collection('forum_topics').doc(topicId).update({
        isPinned,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to pin/unpin topic:', error);
      throw error;
    }
  }

  /**
   * Lock/unlock a topic (admin/teacher only)
   */
  async lockTopic(topicId, isLocked, userId, userRole) {
    try {
      if (userRole !== 'admin' && userRole !== 'teacher') {
        throw new Error('Insufficient permissions');
      }

      await this.db.collection('forum_topics').doc(topicId).update({
        isLocked,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to lock/unlock topic:', error);
      throw error;
    }
  }

  /**
   * Delete a topic or reply (admin/teacher or author)
   */
  async deleteContent(contentType, contentId, userId, userRole) {
    try {
      const collection = contentType === 'topic' ? 'forum_topics' : 'forum_replies';
      const contentDoc = await this.db.collection(collection).doc(contentId).get();
      
      if (!contentDoc.exists) {
        throw new Error(`${contentType} not found`);
      }

      const contentData = contentDoc.data();
      
      // Check permissions
      const canDelete = userRole === 'admin' || 
                       userRole === 'teacher' || 
                       contentData.authorId === userId;
      
      if (!canDelete) {
        throw new Error('Insufficient permissions');
      }

      if (contentType === 'topic') {
        // Delete all replies and votes for the topic
        const repliesSnapshot = await this.db.collection('forum_replies')
          .where('topicId', '==', contentId)
          .get();
        
        const votesSnapshot = await this.db.collection('forum_votes')
          .where('topicId', '==', contentId)
          .get();

        const batch = this.db.batch();
        
        repliesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        votesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(contentDoc.ref);
        
        await batch.commit();
      } else {
        // Delete reply and its votes
        const votesSnapshot = await this.db.collection('forum_votes')
          .where('replyId', '==', contentId)
          .get();

        const batch = this.db.batch();
        
        votesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(contentDoc.ref);
        
        await batch.commit();

        // Update topic reply count
        await this.db.collection('forum_topics').doc(contentData.topicId).update({
          replyCount: admin.firestore.FieldValue.increment(-1)
        });
      }

      return { success: true };
    } catch (error) {
      console.error(`Failed to delete ${contentType}:`, error);
      throw error;
    }
  }

  /**
   * Get forum statistics
   */
  async getForumStats(batchId) {
    try {
      const topicsSnapshot = await this.db.collection('forum_topics')
        .where('batchId', '==', batchId)
        .get();
      
      const repliesSnapshot = await this.db.collection('forum_replies')
        .where('topicId', 'in', topicsSnapshot.docs.map(doc => doc.id))
        .get();

      return {
        totalTopics: topicsSnapshot.size,
        totalReplies: repliesSnapshot.size,
        totalPosts: topicsSnapshot.size + repliesSnapshot.size
      };
    } catch (error) {
      console.error('Failed to get forum stats:', error);
      throw error;
    }
  }
}

module.exports = new ForumService();