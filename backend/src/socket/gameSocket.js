const { verifySupabaseToken } = require('../services/authService');
const gameEngine = require('../services/gameEngine');
const { getGenreList, GENRES } = require('../services/aiService');
const logger = require('../utils/logger');
const config = require('../config');

// Map of socketId -> { uid, roomCode }
const socketPlayerMap = new Map();

// Allowed emojis for reactions
const ALLOWED_EMOJIS = new Set(['😂', '🤣', '😮', '🔥', '👏', '💀', '🤔', '😱', '❤️', '👀', '🎉', '💯']);

// Per-socket event rate limiting
const socketEventCounts = new Map();
function checkSocketRate(socketId) {
  const now = Date.now();
  let entry = socketEventCounts.get(socketId);
  if (!entry || now - entry.windowStart > 1000) {
    entry = { windowStart: now, count: 0 };
    socketEventCounts.set(socketId, entry);
  }
  entry.count++;
  return entry.count <= config.socket.maxEventsPerSecond;
}

// Sanitize string inputs
function sanitizeString(str, maxLen = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function setupSocketHandlers(io) {
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication required'));
      }
      if (token.length > 5000) {
        return next(new Error('Invalid token'));
      }

      const user = await verifySupabaseToken(token);
      if (!user) {
        return next(new Error('Invalid token'));
      }

      socket.userId = user.id;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // Rate limit middleware for all events
    socket.use(([event, ...args], next) => {
      if (!checkSocketRate(socket.id)) {
        logger.warn('Socket rate limit exceeded', { socketId: socket.id, userId: socket.userId, event });
        const callback = args.find(a => typeof a === 'function');
        if (callback) callback({ success: false, error: 'Rate limit exceeded' });
        return; // Drop the event
      }
      next();
    });

    // Check if player was in a room (reconnection)
    const existingRoomCode = gameEngine.findRoomByPlayerId(socket.userId);
    if (existingRoomCode) {
      const room = gameEngine.handleReconnect(existingRoomCode, socket.userId, socket.id);
      if (room) {
        socket.join(existingRoomCode);
        socketPlayerMap.set(socket.id, { uid: socket.userId, roomCode: existingRoomCode });
        socket.emit('reconnected', gameEngine.getRoomState(existingRoomCode));
        socket.to(existingRoomCode).emit('player_reconnected', { uid: socket.userId });
        logger.info(`Player ${socket.userId} reconnected to room ${existingRoomCode}`);
      }
    }

    // ==================== ROOM EVENTS ====================

    socket.on('create_room', (options, callback) => {
      try {
        if (typeof callback !== 'function') return;
        if (!options || typeof options !== 'object') return callback({ success: false, error: 'Invalid options' });

        const displayName = sanitizeString(options.displayName || 'Player', 20);
        const avatarId = Math.max(1, Math.min(50, parseInt(options.avatarId, 10) || 1));
        const gameMode = ['classic', 'rapid', 'meme'].includes(options.gameMode) ? options.gameMode : 'classic';
        const genre = (options.genre && GENRES[options.genre]) ? options.genre : null;
        const maxRounds = Math.max(1, Math.min(20, parseInt(options.maxRounds, 10) || config.game.maxRounds));
        const maxPlayers = Math.max(2, Math.min(config.game.maxPlayersPerRoom, parseInt(options.maxPlayers, 10) || config.game.maxPlayersPerRoom));

        const player = {
          uid: socket.userId,
          displayName,
          avatarId,
          socketId: socket.id,
        };

        const room = gameEngine.createRoom(player, {
          gameMode,
          genre,
          maxRounds,
          isPublic: !!options.isPublic,
          maxPlayers,
        });

        socket.join(room.roomCode);
        socketPlayerMap.set(socket.id, { uid: socket.userId, roomCode: room.roomCode });

        callback({ success: true, roomCode: room.roomCode, room: gameEngine.getRoomState(room.roomCode) });
      } catch (error) {
        logger.error('create_room error', { error: error.message });
        callback({ success: false, error: 'Failed to create room' });
      }
    });

    socket.on('join_room', (data, callback) => {
      try {
        if (typeof callback !== 'function') return;
        if (!data || typeof data !== 'object') return callback({ success: false, error: 'Invalid data' });

        const roomCode = sanitizeString(data.roomCode, 10).toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) return callback({ success: false, error: 'Invalid room code' });

        const displayName = sanitizeString(data.displayName || 'Player', 20);
        const avatarId = Math.max(1, Math.min(50, parseInt(data.avatarId, 10) || 1));

        const player = {
          uid: socket.userId,
          displayName,
          avatarId,
          socketId: socket.id,
        };

        const result = gameEngine.joinRoom(roomCode, player);
        if (result.error) {
          return callback({ success: false, error: result.error });
        }

        socket.join(roomCode);
        socketPlayerMap.set(socket.id, { uid: socket.userId, roomCode });

        const roomState = gameEngine.getRoomState(roomCode);
        callback({ success: true, room: roomState });

        // Notify others
        socket.to(roomCode).emit('player_joined', {
          uid: socket.userId,
          displayName: displayName || 'Player',
          avatarId: avatarId || 1,
          room: roomState,
        });
      } catch (error) {
        logger.error('join_room error', { error: error.message });
        callback({ success: false, error: 'Failed to join room' });
      }
    });

    socket.on('leave_room', (callback) => {
      try {
        const playerInfo = socketPlayerMap.get(socket.id);
        if (!playerInfo) return callback?.({ success: false, error: 'Not in a room' });

        const { roomCode } = playerInfo;
        const room = gameEngine.leaveRoom(roomCode, socket.userId);

        socket.leave(roomCode);
        socketPlayerMap.delete(socket.id);

        if (room) {
          const roomState = gameEngine.getRoomState(roomCode);
          io.to(roomCode).emit('player_left', {
            uid: socket.userId,
            room: roomState,
            newHostId: room.hostId,
          });
        }

        callback?.({ success: true });
      } catch (error) {
        logger.error('leave_room error', { error: error.message });
        callback?.({ success: false, error: 'Failed to leave room' });
      }
    });

    socket.on('get_public_rooms', (callback) => {
      try {
        callback({ success: true, rooms: gameEngine.getPublicRooms() });
      } catch (error) {
        callback({ success: false, error: 'Failed to get rooms' });
      }
    });

    socket.on('get_genres', (callback) => {
      try {
        if (typeof callback !== 'function') return;
        callback({ success: true, genres: getGenreList() });
      } catch (error) {
        callback({ success: false, error: 'Failed to get genres' });
      }
    });

    // ==================== GAME EVENTS ====================

    socket.on('start_game', async (callback) => {
      try {
        const playerInfo = socketPlayerMap.get(socket.id);
        if (!playerInfo) return callback({ success: false, error: 'Not in a room' });

        const { roomCode } = playerInfo;
        const room = gameEngine.getRoom(roomCode);
        if (!room) return callback({ success: false, error: 'Room not found' });
        if (room.hostId !== socket.userId) return callback({ success: false, error: 'Only host can start' });

        const result = await gameEngine.startGame(roomCode);
        if (result.error) return callback({ success: false, error: result.error });

        if (result.gameOver) {
          clearRoomTimers(room);
          io.to(roomCode).emit('game_over', result.results);
          callback({ success: true });
          return;
        }

        // Emit new round to all players
        io.to(roomCode).emit('new_round', result);
        callback({ success: true });

        // Start round timer
        startRoundTimer(io, roomCode, room.roundTimeSeconds);
      } catch (error) {
        logger.error('start_game error', { error: error.message });
        callback({ success: false, error: 'Failed to start game' });
      }
    });

    socket.on('submit_answer', async (data, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const playerInfo = socketPlayerMap.get(socket.id);
        if (!playerInfo) return callback({ success: false, error: 'Not in a room' });

        if (!data || typeof data !== 'object' || typeof data.answer !== 'string') {
          return callback({ success: false, error: 'Invalid answer' });
        }

        const answer = sanitizeString(data.answer, 100);
        const { roomCode } = playerInfo;
        const result = await gameEngine.submitAnswer(roomCode, socket.userId, answer);

        if (result.error) return callback({ success: false, error: result.error });

        callback({ success: true });

        // Notify room about submission count
        const roomState = gameEngine.getRoomState(roomCode);
        io.to(roomCode).emit('answer_submitted', {
          uid: socket.userId,
          answersSubmitted: roomState.answersSubmitted,
          totalPlayers: roomState.players.filter(p => p.isConnected).length,
        });

        // If all submitted, move to voting
        if (result.allSubmitted) {
          transitionToVoting(io, roomCode);
        }
      } catch (error) {
        logger.error('submit_answer error', { error: error.message });
        callback({ success: false, error: 'Failed to submit answer' });
      }
    });

    socket.on('submit_vote', (data, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const playerInfo = socketPlayerMap.get(socket.id);
        if (!playerInfo) return callback({ success: false, error: 'Not in a room' });

        if (!data || typeof data !== 'object' || typeof data.answerId !== 'string') {
          return callback({ success: false, error: 'Invalid vote' });
        }

        const answerId = sanitizeString(data.answerId, 100);
        const { roomCode } = playerInfo;
        const result = gameEngine.submitVote(roomCode, socket.userId, answerId);

        if (result.error) return callback({ success: false, error: result.error });

        callback({ success: true });

        // Notify room about vote count
        const roomState = gameEngine.getRoomState(roomCode);
        io.to(roomCode).emit('vote_submitted', {
          uid: socket.userId,
          votesSubmitted: roomState.votesSubmitted,
          totalPlayers: roomState.players.filter(p => p.isConnected).length,
        });

        // If all voted, reveal results
        if (result.allVoted) {
          revealResults(io, roomCode);
        }
      } catch (error) {
        logger.error('submit_vote error', { error: error.message });
        callback({ success: false, error: 'Failed to submit vote' });
      }
    });

    socket.on('next_round', async (callback) => {
      try {
        const playerInfo = socketPlayerMap.get(socket.id);
        if (!playerInfo) return callback?.({ success: false, error: 'Not in a room' });

        const { roomCode } = playerInfo;
        const room = gameEngine.getRoom(roomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found' });
        if (room.hostId !== socket.userId) return callback?.({ success: false, error: 'Only host can advance' });

        const result = await gameEngine.startNextRound(roomCode);
        if (result.error) return callback?.({ success: false, error: result.error });

        if (result.gameOver) {
          clearRoomTimers(room);
          io.to(roomCode).emit('game_over', result.results);
          callback?.({ success: true });
          return;
        }

        io.to(roomCode).emit('new_round', result);
        callback?.({ success: true });

        startRoundTimer(io, roomCode, room.roundTimeSeconds);
      } catch (error) {
        logger.error('next_round error', { error: error.message });
        callback?.({ success: false, error: 'Failed to start next round' });
      }
    });

    // ==================== REJOIN (mid-game reconnect) ====================

    socket.on('rejoin_room', (data, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const roomCode = sanitizeString(data?.roomCode || '', 10).toUpperCase();
        if (!roomCode) return callback({ success: false, error: 'No room code' });

        // Check if engine still has the room
        const room = gameEngine.getRoom(roomCode);
        if (!room) {
          return callback({ success: false, error: 'room_gone' });
        }

        // Check if this player was actually in the room
        if (!room.players.has(socket.userId)) {
          return callback({ success: false, error: 'not_in_room' });
        }

        // Re-attach socket to the room
        const updatedRoom = gameEngine.handleReconnect(roomCode, socket.userId, socket.id);
        if (!updatedRoom) {
          return callback({ success: false, error: 'room_gone' });
        }

        socket.join(roomCode);
        socketPlayerMap.set(socket.id, { uid: socket.userId, roomCode });

        const roomState = gameEngine.getRoomState(roomCode);
        callback({ success: true, room: roomState });

        // Notify others that player is back
        socket.to(roomCode).emit('player_reconnected', { uid: socket.userId });
        logger.info(`Player ${socket.userId} rejoined room ${roomCode} via rejoin_room`);
      } catch (error) {
        logger.error('rejoin_room error', { error: error.message });
        callback({ success: false, error: 'Failed to rejoin' });
      }
    });

    // ==================== CHAT / REACTIONS ====================

    socket.on('emoji_reaction', (data) => {
      const playerInfo = socketPlayerMap.get(socket.id);
      if (!playerInfo) return;
      if (!data || typeof data.emoji !== 'string') return;
      if (!ALLOWED_EMOJIS.has(data.emoji)) return;

      const { roomCode } = playerInfo;
      socket.to(roomCode).emit('emoji_reaction', {
        uid: socket.userId,
        emoji: data.emoji,
      });
    });

    // ==================== DISCONNECT ====================

    socket.on('disconnect', () => {
      const playerInfo = socketPlayerMap.get(socket.id);
      if (playerInfo) {
        const { roomCode } = playerInfo;
        const room = gameEngine.handleDisconnect(roomCode, socket.userId);
        if (room) {
          const roomState = gameEngine.getRoomState(roomCode);
          io.to(roomCode).emit('player_disconnected', {
            uid: socket.userId,
            room: roomState,
          });
        }
        socketPlayerMap.delete(socket.id);
      }
      socketEventCounts.delete(socket.id);
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}

// ==================== TIMER HELPERS ====================

function clearRoomTimers(room) {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
  if (room.roundTickInterval) {
    clearInterval(room.roundTickInterval);
    room.roundTickInterval = null;
  }
  if (room.voteTimer) {
    clearTimeout(room.voteTimer);
    room.voteTimer = null;
  }
  if (room.voteTickInterval) {
    clearInterval(room.voteTickInterval);
    room.voteTickInterval = null;
  }
}

function startRoundTimer(io, roomCode, seconds) {
  const room = gameEngine.getRoom(roomCode);
  if (!room) return;

  // Clear ALL existing timers first
  clearRoomTimers(room);

  // Send timer ticks
  let remaining = seconds;
  room.roundTickInterval = setInterval(() => {
    const currentRoom = gameEngine.getRoom(roomCode);
    if (!currentRoom || currentRoom.state !== gameEngine.GAME_STATES.SUBMITTING_ANSWERS) {
      clearInterval(room.roundTickInterval);
      room.roundTickInterval = null;
      return;
    }
    remaining--;
    if (remaining >= 0) {
      io.to(roomCode).emit('timer_tick', { phase: 'answer', remaining });
    }
    if (remaining <= 0) {
      clearInterval(room.roundTickInterval);
      room.roundTickInterval = null;
    }
  }, 1000);

  room.roundTimer = setTimeout(() => {
    if (room.roundTickInterval) {
      clearInterval(room.roundTickInterval);
      room.roundTickInterval = null;
    }
    room.roundTimer = null;
    transitionToVoting(io, roomCode);
  }, seconds * 1000);
}

function transitionToVoting(io, roomCode) {
  const room = gameEngine.getRoom(roomCode);
  if (!room) return;
  if (room.state !== gameEngine.GAME_STATES.SUBMITTING_ANSWERS) return;

  // Clear round timers
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
  if (room.roundTickInterval) {
    clearInterval(room.roundTickInterval);
    room.roundTickInterval = null;
  }

  const answers = gameEngine.startVoting(roomCode);
  io.to(roomCode).emit('voting_started', {
    answers,
    timeLimit: room.voteTimeSeconds,
  });

  // Start vote timer
  let remaining = room.voteTimeSeconds;
  room.voteTickInterval = setInterval(() => {
    const currentRoom = gameEngine.getRoom(roomCode);
    if (!currentRoom || currentRoom.state !== gameEngine.GAME_STATES.VOTING) {
      clearInterval(room.voteTickInterval);
      room.voteTickInterval = null;
      return;
    }
    remaining--;
    if (remaining >= 0) {
      io.to(roomCode).emit('timer_tick', { phase: 'vote', remaining });
    }
    if (remaining <= 0) {
      clearInterval(room.voteTickInterval);
      room.voteTickInterval = null;
    }
  }, 1000);

  room.voteTimer = setTimeout(() => {
    if (room.voteTickInterval) {
      clearInterval(room.voteTickInterval);
      room.voteTickInterval = null;
    }
    room.voteTimer = null;
    revealResults(io, roomCode);
  }, room.voteTimeSeconds * 1000);
}

function revealResults(io, roomCode) {
  const room = gameEngine.getRoom(roomCode);
  if (!room) return;
  if (room.state !== gameEngine.GAME_STATES.VOTING) return;

  // Clear vote timers
  if (room.voteTimer) {
    clearTimeout(room.voteTimer);
    room.voteTimer = null;
  }
  if (room.voteTickInterval) {
    clearInterval(room.voteTickInterval);
    room.voteTickInterval = null;
  }

  const results = gameEngine.calculateRoundResults(roomCode);
  if (results) {
    io.to(roomCode).emit('round_results', results);
  }
}

module.exports = { setupSocketHandlers };
