const { db } = require('../../config/firebase');
const { v4: uuidv4 } = require('uuid');

class ChatService {
  /**
   * Create a new chat room for a batch and subject
   */
  async createChatRoom(batchId, subjectId, createdBy, roomName, description = '') {
    try {
      const roomId = uuidv4();
      const now = new Date().toISOString();

      const roomData = {
        id: roomId,
        batchId,
        subjectId,
        name: roomName,
        description,
        createdBy,
        createdAt: now,
        updatedAt: now,
        isActive: true,
        messageCount: 0,
        lastMessage: null,
        lastMessageAt: null,
        participants: [createdBy],
        settings: {
          allowFileSharing: true,
          allowStudentMessages: true,
          moderationEnabled: false
        }
      };

      await db.collection('chatRooms').doc(roomId).set(roomData);
      return { success: true, data: { room: roomData } };
    } catch (error) {
      console.error('Error creating chat room:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get chat rooms for a batch
   */
  async getChatRooms(batchId, subjectId = null, userId) {
    try {
      let query = db.collection('chatRooms')
        .where('batchId', '==', batchId)
        .where('isActive', '==', true);

      if (subjectId) {
        query = query.where('subjectId', '==', subjectId);
      }

      const snapshot = await query.orderBy('updatedAt', 'desc').get();
      const rooms = [];

      for (const doc of snapshot.docs) {
        const roomData = doc.data();
        
        // Check if user has access to this room
        const hasAccess = await this.checkRoomAccess(roomData.id, userId);
        if (hasAccess) {
          rooms.push(roomData);
        }
      }

      return { success: true, data: { rooms } };
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a message to a chat room
   */
  async sendMessage(roomId, senderId, senderName, senderRole, content, messageType = 'text', attachments = []) {
    try {
      // Check if user has access to the room
      const hasAccess = await this.checkRoomAccess(roomId, senderId);
      if (!hasAccess) {
        return { success: false, error: 'Access denied to this chat room' };
      }

      // Check room settings
      const roomDoc = await db.collection('chatRooms').doc(roomId).get();
      if (!roomDoc.exists) {
        return { success: false, error: 'Chat room not found' };
      }

      const roomData = roomDoc.data();
      if (!roomData.isActive) {
        return { success: false, error: 'Chat room is not active' };
      }

      // Check if students can send messages
      if (senderRole === 'student' && !roomData.settings.allowStudentMessages) {
        return { success: false, error: 'Students are not allowed to send messages in this room' };
      }

      const messageId = uuidv4();
      const now = new Date().toISOString();

      const messageData = {
        id: messageId,
        roomId,
        senderId,
        senderName,
        senderRole,
        content,
        messageType,
        attachments,
        timestamp: now,
        edited: false,
        editedAt: null,
        deleted: false,
        deletedAt: null,
        reactions: {},
        replyTo: null,
        mentions: [],
        readBy: [senderId] // Sender has read their own message
      };

      // Save message
      await db.collection('chatMessages').doc(messageId).set(messageData);

      // Update room's last message info
      await db.collection('chatRooms').doc(roomId).update({
        lastMessage: content.substring(0, 100),
        lastMessageAt: now,
        updatedAt: now,
        messageCount: roomData.messageCount + 1,
        participants: roomData.participants.includes(senderId) 
          ? roomData.participants 
          : [...roomData.participants, senderId]
      });

      return { success: true, data: { message: messageData } };
    } catch (error) {
      console.error('Error sending message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get messages for a chat room
   */
  async getMessages(roomId, userId, limit = 50, lastMessageId = null) {
    try {
      // Check if user has access to the room
      const hasAccess = await this.checkRoomAccess(roomId, userId);
      if (!hasAccess) {
        return { success: false, error: 'Access denied to this chat room' };
      }

      let query = db.collection('chatMessages')
        .where('roomId', '==', roomId)
        .where('deleted', '==', false)
        .orderBy('timestamp', 'desc')
        .limit(limit);

      if (lastMessageId) {
        const lastMessageDoc = await db.collection('chatMessages').doc(lastMessageId).get();
        if (lastMessageDoc.exists) {
          query = query.startAfter(lastMessageDoc);
        }
      }

      const snapshot = await query.get();
      const messages = snapshot.docs.map(doc => doc.data()).reverse(); // Reverse to get chronological order

      // Mark messages as read by this user
      const batch = db.batch();
      const unreadMessages = messages.filter(msg => !msg.readBy.includes(userId));
      
      unreadMessages.forEach(msg => {
        const messageRef = db.collection('chatMessages').doc(msg.id);
        batch.update(messageRef, {
          readBy: [...msg.readBy, userId]
        });
      });

      if (unreadMessages.length > 0) {
        await batch.commit();
      }

      return { success: true, data: { messages } };
    } catch (error) {
      console.error('Error fetching messages:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit a message
   */
  async editMessage(messageId, userId, newContent) {
    try {
      const messageDoc = await db.collection('chatMessages').doc(messageId).get();
      if (!messageDoc.exists) {
        return { success: false, error: 'Message not found' };
      }

      const messageData = messageDoc.data();
      if (messageData.senderId !== userId) {
        return { success: false, error: 'You can only edit your own messages' };
      }

      if (messageData.deleted) {
        return { success: false, error: 'Cannot edit deleted message' };
      }

      const now = new Date().toISOString();
      await db.collection('chatMessages').doc(messageId).update({
        content: newContent,
        edited: true,
        editedAt: now
      });

      return { success: true, data: { messageId, content: newContent, editedAt: now } };
    } catch (error) {
      console.error('Error editing message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId, userId, userRole) {
    try {
      const messageDoc = await db.collection('chatMessages').doc(messageId).get();
      if (!messageDoc.exists) {
        return { success: false, error: 'Message not found' };
      }

      const messageData = messageDoc.data();
      
      // Only sender or teacher/admin can delete messages
      if (messageData.senderId !== userId && !['teacher', 'admin'].includes(userRole)) {
        return { success: false, error: 'You do not have permission to delete this message' };
      }

      const now = new Date().toISOString();
      await db.collection('chatMessages').doc(messageId).update({
        deleted: true,
        deletedAt: now,
        content: '[Message deleted]'
      });

      return { success: true, data: { messageId, deletedAt: now } };
    } catch (error) {
      console.error('Error deleting message:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add reaction to a message
   */
  async addReaction(messageId, userId, userName, emoji) {
    try {
      const messageDoc = await db.collection('chatMessages').doc(messageId).get();
      if (!messageDoc.exists) {
        return { success: false, error: 'Message not found' };
      }

      const messageData = messageDoc.data();
      const reactions = messageData.reactions || {};
      
      if (!reactions[emoji]) {
        reactions[emoji] = [];
      }

      // Check if user already reacted with this emoji
      const existingReaction = reactions[emoji].find(r => r.userId === userId);
      if (existingReaction) {
        return { success: false, error: 'You have already reacted with this emoji' };
      }

      reactions[emoji].push({
        userId,
        userName,
        timestamp: new Date().toISOString()
      });

      await db.collection('chatMessages').doc(messageId).update({ reactions });
      return { success: true, data: { messageId, reactions } };
    } catch (error) {
      console.error('Error adding reaction:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove reaction from a message
   */
  async removeReaction(messageId, userId, emoji) {
    try {
      const messageDoc = await db.collection('chatMessages').doc(messageId).get();
      if (!messageDoc.exists) {
        return { success: false, error: 'Message not found' };
      }

      const messageData = messageDoc.data();
      const reactions = messageData.reactions || {};
      
      if (reactions[emoji]) {
        reactions[emoji] = reactions[emoji].filter(r => r.userId !== userId);
        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }
      }

      await db.collection('chatMessages').doc(messageId).update({ reactions });
      return { success: true, data: { messageId, reactions } };
    } catch (error) {
      console.error('Error removing reaction:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get unread message count for a user
   */
  async getUnreadCount(userId, roomId = null) {
    try {
      let query = db.collection('chatMessages')
        .where('deleted', '==', false);

      if (roomId) {
        query = query.where('roomId', '==', roomId);
      }

      const snapshot = await query.get();
      let unreadCount = 0;

      snapshot.docs.forEach(doc => {
        const messageData = doc.data();
        if (!messageData.readBy.includes(userId) && messageData.senderId !== userId) {
          unreadCount++;
        }
      });

      return { success: true, data: { unreadCount } };
    } catch (error) {
      console.error('Error getting unread count:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update chat room settings
   */
  async updateRoomSettings(roomId, userId, userRole, settings) {
    try {
      // Only teachers and admins can update room settings
      if (!['teacher', 'admin'].includes(userRole)) {
        return { success: false, error: 'You do not have permission to update room settings' };
      }

      const roomDoc = await db.collection('chatRooms').doc(roomId).get();
      if (!roomDoc.exists) {
        return { success: false, error: 'Chat room not found' };
      }

      const roomData = roomDoc.data();
      const updatedSettings = { ...roomData.settings, ...settings };

      await db.collection('chatRooms').doc(roomId).update({
        settings: updatedSettings,
        updatedAt: new Date().toISOString()
      });

      return { success: true, data: { settings: updatedSettings } };
    } catch (error) {
      console.error('Error updating room settings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if user has access to a chat room
   */
  async checkRoomAccess(roomId, userId) {
    try {
      const roomDoc = await db.collection('chatRooms').doc(roomId).get();
      if (!roomDoc.exists) {
        return false;
      }

      const roomData = roomDoc.data();
      const batchId = roomData.batchId;

      // Check if user is enrolled in the batch or is a teacher/admin
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        return false;
      }

      const userData = userDoc.data();
      
      // Admins and teachers have access to all rooms
      if (['admin', 'teacher'].includes(userData.role)) {
        return true;
      }

      // Students need to be enrolled in the batch
      if (userData.role === 'student') {
        const enrollmentQuery = await db.collection('enrollments')
          .where('studentId', '==', userId)
          .where('batchId', '==', batchId)
          .where('status', '==', 'active')
          .get();
        
        return !enrollmentQuery.empty;
      }

      return false;
    } catch (error) {
      console.error('Error checking room access:', error);
      return false;
    }
  }

  /**
   * Search messages in a room
   */
  async searchMessages(roomId, userId, searchTerm, limit = 20) {
    try {
      // Check if user has access to the room
      const hasAccess = await this.checkRoomAccess(roomId, userId);
      if (!hasAccess) {
        return { success: false, error: 'Access denied to this chat room' };
      }

      // Note: Firestore doesn't support full-text search natively
      // This is a basic implementation that searches for exact matches
      const snapshot = await db.collection('chatMessages')
        .where('roomId', '==', roomId)
        .where('deleted', '==', false)
        .orderBy('timestamp', 'desc')
        .limit(limit * 5) // Get more messages to filter
        .get();

      const messages = snapshot.docs
        .map(doc => doc.data())
        .filter(msg => msg.content.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, limit);

      return { success: true, data: { messages, searchTerm } };
    } catch (error) {
      console.error('Error searching messages:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new ChatService();