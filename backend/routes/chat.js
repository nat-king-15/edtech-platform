const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const admin = require('firebase-admin');
const db = admin.firestore();

// Get chat messages for a specific chat room
router.get('/:chatId/messages', authMiddleware, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, lastMessageId } = req.query;
    
    let query = db.collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit));
    
    if (lastMessageId) {
      const lastDoc = await db.collection('chats')
        .doc(chatId)
        .collection('messages')
        .doc(lastMessageId)
        .get();
      
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }
    
    const snapshot = await query.get();
    const messages = [];
    
    snapshot.forEach(doc => {
      messages.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: messages.reverse(), // Reverse to show oldest first
      message: 'Messages retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_MESSAGES_ERROR',
        message: 'Failed to fetch messages'
      }
    });
  }
});

// Send a message to a chat room
router.post('/:chatId/messages', authMiddleware, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message, type = 'text' } = req.body;
    const userId = req.user.uid;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Message content is required'
        }
      });
    }
    
    const messageData = {
      senderId: userId,
      senderName: req.user.name || req.user.email,
      message: message.trim(),
      type,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString()
    };
    
    const messageRef = await db.collection('chats')
      .doc(chatId)
      .collection('messages')
      .add(messageData);
    
    // Update chat room's last message info
    await db.collection('chats').doc(chatId).update({
      lastMessage: message.trim(),
      lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageSender: userId
    });
    
    res.json({
      success: true,
      data: {
        id: messageRef.id,
        ...messageData
      },
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SEND_MESSAGE_ERROR',
        message: 'Failed to send message'
      }
    });
  }
});

// Get user's chat rooms
router.get('/rooms', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const snapshot = await db.collection('chats')
      .where('participants', 'array-contains', userId)
      .orderBy('lastMessageTime', 'desc')
      .get();
    
    const chatRooms = [];
    snapshot.forEach(doc => {
      chatRooms.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: chatRooms,
      message: 'Chat rooms retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ROOMS_ERROR',
        message: 'Failed to fetch chat rooms'
      }
    });
  }
});

// Create a new chat room
router.post('/rooms', authMiddleware, async (req, res) => {
  try {
    const { name, participants, type = 'group' } = req.body;
    const userId = req.user.uid;
    
    if (!name || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROOM_DATA',
          message: 'Room name and participants are required'
        }
      });
    }
    
    const roomData = {
      name,
      type,
      participants: [...participants, userId], // Include creator
      createdBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: '',
      lastMessageTime: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const roomRef = await db.collection('chats').add(roomData);
    
    res.json({
      success: true,
      data: {
        id: roomRef.id,
        ...roomData
      },
      message: 'Chat room created successfully'
    });
  } catch (error) {
    console.error('Error creating chat room:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ROOM_ERROR',
        message: 'Failed to create chat room'
      }
    });
  }
});

module.exports = router;