const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const chatService = require('../services/chatService');

class ChatSocketHandler {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> { socketId, userInfo }
    this.roomUsers = new Map(); // roomId -> Set of userIds
  }

  /**
   * Initialize Socket.io server
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.FRONTEND_URL 
          : ['http://localhost:3000', 'http://127.0.0.1:3000'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify Firebase token
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        // Get user data from Firestore
        const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        if (!userDoc.exists) {
          return next(new Error('User not found'));
        }

        const userData = userDoc.data();
        socket.userId = decodedToken.uid;
        socket.userInfo = {
          id: decodedToken.uid,
          name: userData.name,
          email: userData.email,
          role: userData.role,
          avatar: userData.avatar || null
        };

        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('Chat Socket.io server initialized');
    return this.io;
  }

  /**
   * Handle new socket connection
   */
  handleConnection(socket) {
    const userId = socket.userId;
    const userInfo = socket.userInfo;

    console.log(`User ${userInfo.name} (${userId}) connected`);

    // Store connected user
    this.connectedUsers.set(userId, {
      socketId: socket.id,
      userInfo,
      joinedRooms: new Set()
    });

    // Emit user online status
    socket.broadcast.emit('user:online', { userId, userInfo });

    // Join user to their personal room for direct notifications
    socket.join(`user:${userId}`);

    // Handle joining chat rooms
    socket.on('room:join', async (data) => {
      await this.handleJoinRoom(socket, data);
    });

    // Handle leaving chat rooms
    socket.on('room:leave', async (data) => {
      await this.handleLeaveRoom(socket, data);
    });

    // Handle sending messages
    socket.on('message:send', async (data) => {
      await this.handleSendMessage(socket, data);
    });

    // Handle editing messages
    socket.on('message:edit', async (data) => {
      await this.handleEditMessage(socket, data);
    });

    // Handle deleting messages
    socket.on('message:delete', async (data) => {
      await this.handleDeleteMessage(socket, data);
    });

    // Handle message reactions
    socket.on('message:react', async (data) => {
      await this.handleMessageReaction(socket, data);
    });

    // Handle typing indicators
    socket.on('typing:start', (data) => {
      this.handleTypingStart(socket, data);
    });

    socket.on('typing:stop', (data) => {
      this.handleTypingStop(socket, data);
    });

    // Handle getting online users in a room
    socket.on('room:users', async (data) => {
      await this.handleGetRoomUsers(socket, data);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  /**
   * Handle joining a chat room
   */
  async handleJoinRoom(socket, { roomId }) {
    try {
      const userId = socket.userId;
      const userInfo = socket.userInfo;

      // Check if user has access to the room
      const hasAccess = await chatService.checkRoomAccess(roomId, userId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to this chat room' });
        return;
      }

      // Join the socket room
      socket.join(roomId);

      // Update user's joined rooms
      const connectedUser = this.connectedUsers.get(userId);
      if (connectedUser) {
        connectedUser.joinedRooms.add(roomId);
      }

      // Update room users
      if (!this.roomUsers.has(roomId)) {
        this.roomUsers.set(roomId, new Set());
      }
      this.roomUsers.get(roomId).add(userId);

      // Notify other users in the room
      socket.to(roomId).emit('room:user_joined', {
        roomId,
        user: userInfo
      });

      // Send confirmation to the user
      socket.emit('room:joined', {
        roomId,
        message: 'Successfully joined the chat room'
      });

      console.log(`User ${userInfo.name} joined room ${roomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join chat room' });
    }
  }

  /**
   * Handle leaving a chat room
   */
  async handleLeaveRoom(socket, { roomId }) {
    try {
      const userId = socket.userId;
      const userInfo = socket.userInfo;

      // Leave the socket room
      socket.leave(roomId);

      // Update user's joined rooms
      const connectedUser = this.connectedUsers.get(userId);
      if (connectedUser) {
        connectedUser.joinedRooms.delete(roomId);
      }

      // Update room users
      if (this.roomUsers.has(roomId)) {
        this.roomUsers.get(roomId).delete(userId);
        if (this.roomUsers.get(roomId).size === 0) {
          this.roomUsers.delete(roomId);
        }
      }

      // Notify other users in the room
      socket.to(roomId).emit('room:user_left', {
        roomId,
        user: userInfo
      });

      // Send confirmation to the user
      socket.emit('room:left', {
        roomId,
        message: 'Successfully left the chat room'
      });

      console.log(`User ${userInfo.name} left room ${roomId}`);
    } catch (error) {
      console.error('Error leaving room:', error);
      socket.emit('error', { message: 'Failed to leave chat room' });
    }
  }

  /**
   * Handle sending a message
   */
  async handleSendMessage(socket, { roomId, content, messageType = 'text', attachments = [] }) {
    try {
      const userId = socket.userId;
      const userInfo = socket.userInfo;

      // Send message through chat service
      const result = await chatService.sendMessage(
        roomId,
        userId,
        userInfo.name,
        userInfo.role,
        content,
        messageType,
        attachments
      );

      if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
      }

      const message = result.data.message;

      // Broadcast message to all users in the room
      this.io.to(roomId).emit('message:new', {
        roomId,
        message
      });

      // Send delivery confirmation to sender
      socket.emit('message:sent', {
        messageId: message.id,
        timestamp: message.timestamp
      });

      console.log(`Message sent in room ${roomId} by ${userInfo.name}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  /**
   * Handle editing a message
   */
  async handleEditMessage(socket, { messageId, content }) {
    try {
      const userId = socket.userId;

      const result = await chatService.editMessage(messageId, userId, content);
      if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
      }

      // Get the message to find the room
      const messageDoc = await admin.firestore().collection('chatMessages').doc(messageId).get();
      if (messageDoc.exists) {
        const messageData = messageDoc.data();
        const roomId = messageData.roomId;

        // Broadcast the edit to all users in the room
        this.io.to(roomId).emit('message:edited', {
          messageId,
          content,
          editedAt: result.data.editedAt
        });
      }

      console.log(`Message ${messageId} edited by user ${userId}`);
    } catch (error) {
      console.error('Error editing message:', error);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  }

  /**
   * Handle deleting a message
   */
  async handleDeleteMessage(socket, { messageId }) {
    try {
      const userId = socket.userId;
      const userRole = socket.userInfo.role;

      const result = await chatService.deleteMessage(messageId, userId, userRole);
      if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
      }

      // Get the message to find the room
      const messageDoc = await admin.firestore().collection('chatMessages').doc(messageId).get();
      if (messageDoc.exists) {
        const messageData = messageDoc.data();
        const roomId = messageData.roomId;

        // Broadcast the deletion to all users in the room
        this.io.to(roomId).emit('message:deleted', {
          messageId,
          deletedAt: result.data.deletedAt
        });
      }

      console.log(`Message ${messageId} deleted by user ${userId}`);
    } catch (error) {
      console.error('Error deleting message:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  }

  /**
   * Handle message reactions
   */
  async handleMessageReaction(socket, { messageId, emoji, action }) {
    try {
      const userId = socket.userId;
      const userName = socket.userInfo.name;

      let result;
      if (action === 'add') {
        result = await chatService.addReaction(messageId, userId, userName, emoji);
      } else if (action === 'remove') {
        result = await chatService.removeReaction(messageId, userId, emoji);
      } else {
        socket.emit('error', { message: 'Invalid reaction action' });
        return;
      }

      if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
      }

      // Get the message to find the room
      const messageDoc = await admin.firestore().collection('chatMessages').doc(messageId).get();
      if (messageDoc.exists) {
        const messageData = messageDoc.data();
        const roomId = messageData.roomId;

        // Broadcast the reaction update to all users in the room
        this.io.to(roomId).emit('message:reaction_updated', {
          messageId,
          reactions: result.data.reactions
        });
      }

      console.log(`Reaction ${action} for message ${messageId} by user ${userId}`);
    } catch (error) {
      console.error('Error handling message reaction:', error);
      socket.emit('error', { message: 'Failed to update reaction' });
    }
  }

  /**
   * Handle typing start
   */
  handleTypingStart(socket, { roomId }) {
    const userInfo = socket.userInfo;
    socket.to(roomId).emit('typing:user_started', {
      roomId,
      user: userInfo
    });
  }

  /**
   * Handle typing stop
   */
  handleTypingStop(socket, { roomId }) {
    const userInfo = socket.userInfo;
    socket.to(roomId).emit('typing:user_stopped', {
      roomId,
      user: userInfo
    });
  }

  /**
   * Handle getting online users in a room
   */
  async handleGetRoomUsers(socket, { roomId }) {
    try {
      const onlineUsers = [];
      
      if (this.roomUsers.has(roomId)) {
        const userIds = Array.from(this.roomUsers.get(roomId));
        
        for (const userId of userIds) {
          const connectedUser = this.connectedUsers.get(userId);
          if (connectedUser) {
            onlineUsers.push(connectedUser.userInfo);
          }
        }
      }

      socket.emit('room:users_list', {
        roomId,
        users: onlineUsers
      });
    } catch (error) {
      console.error('Error getting room users:', error);
      socket.emit('error', { message: 'Failed to get room users' });
    }
  }

  /**
   * Handle user disconnection
   */
  handleDisconnection(socket) {
    const userId = socket.userId;
    const userInfo = socket.userInfo;

    if (!userId || !userInfo) return;

    console.log(`User ${userInfo.name} (${userId}) disconnected`);

    // Get user's joined rooms
    const connectedUser = this.connectedUsers.get(userId);
    if (connectedUser) {
      // Notify all joined rooms about user leaving
      connectedUser.joinedRooms.forEach(roomId => {
        socket.to(roomId).emit('room:user_left', {
          roomId,
          user: userInfo
        });

        // Update room users
        if (this.roomUsers.has(roomId)) {
          this.roomUsers.get(roomId).delete(userId);
          if (this.roomUsers.get(roomId).size === 0) {
            this.roomUsers.delete(roomId);
          }
        }
      });
    }

    // Remove user from connected users
    this.connectedUsers.delete(userId);

    // Broadcast user offline status
    socket.broadcast.emit('user:offline', { userId, userInfo });
  }

  /**
   * Send notification to a specific user
   */
  sendNotificationToUser(userId, notification) {
    this.io.to(`user:${userId}`).emit('notification', notification);
  }

  /**
   * Send notification to all users in a room
   */
  sendNotificationToRoom(roomId, notification) {
    this.io.to(roomId).emit('notification', notification);
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount() {
    return this.connectedUsers.size;
  }

  /**
   * Get users in a specific room
   */
  getRoomUsers(roomId) {
    if (!this.roomUsers.has(roomId)) {
      return [];
    }

    const userIds = Array.from(this.roomUsers.get(roomId));
    return userIds.map(userId => {
      const connectedUser = this.connectedUsers.get(userId);
      return connectedUser ? connectedUser.userInfo : null;
    }).filter(Boolean);
  }
}

module.exports = new ChatSocketHandler();