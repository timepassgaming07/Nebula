import { io } from 'socket.io-client';
import ENV from '../config/env';
import useGameStore from '../stores/gameStore';
import useAuthStore from '../stores/authStore';

let socket = null;
const EMIT_TIMEOUT_MS = 10000;

export function getSocket() {
  return socket;
}

function isTunnelUrl(url) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.lhr.life') ||
      hostname.endsWith('.ngrok.io') ||
      hostname.endsWith('.ngrok-free.app') ||
      hostname.endsWith('.ngrok.app') ||
      hostname.endsWith('.trycloudflare.com')
    );
  } catch {
    return false;
  }
}

function buildTunnelHeaders(url) {
  if (!isTunnelUrl(url)) return undefined;
  return {
    'bypass-tunnel-reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'NebulaApp/1.0',
  };
}

// Helper: emit with timeout to prevent dangling callbacks
function emitWithTimeout(event, data, timeoutMs = EMIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      return reject(new Error('Not connected'));
    }
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event} response`));
    }, timeoutMs);

    const args = data !== undefined ? [data] : [];
    socket.emit(event, ...args, (response) => {
      clearTimeout(timer);
      if (response?.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// Attempt to rejoin an active room after reconnect
async function attemptRejoinRoom() {
  const { lastRoomCode, roomCode, resetGame } = useGameStore.getState();
  if (!lastRoomCode || !socket?.connected) return;
  if (roomCode && roomCode === lastRoomCode) return;

  try {
    const response = await emitWithTimeout('rejoin_room', { roomCode: lastRoomCode }, 8000);
    // Successfully rejoined
    const userId = useAuthStore.getState().user?.id;
    useGameStore.getState().setRoomState(response.room);
    useGameStore.getState().setIsHost(response.room.hostId === userId);
    console.log('[Socket] Rejoined room', lastRoomCode);
  } catch (err) {
    const reason = err?.message || '';
    if (reason === 'room_gone' || reason === 'not_in_room') {
      // Server was restarted or room no longer exists — go back to home
      console.warn('[Socket] Room gone after reconnect, resetting game');
      resetGame('server_restarted');
    } else {
      console.warn('[Socket] Rejoin failed (will retry on next reconnect):', reason);
    }
  }
}

export function connectSocket() {
  const token = useAuthStore.getState().token;
  if (!token) {
    console.warn('Cannot connect socket: no auth token');
    return null;
  }

  if (socket?.connected) {
    return socket;
  }

  // Clean up existing broken socket
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  const tunnelHeaders = buildTunnelHeaders(ENV.WS_URL);
  const isTunnel = isTunnelUrl(ENV.WS_URL);

  socket = io(ENV.WS_URL, {
    auth: { token },
    // Tunnels and restrictive networks are much more reliable with long-polling.
    transports: isTunnel ? ['polling'] : ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 50,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 30000,
    forceNew: true,
    ...(tunnelHeaders ? { transportOptions: { polling: { extraHeaders: tunnelHeaders } } } : {}),
  });

  setupSocketListeners(socket);
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isConnected() {
  return socket?.connected || false;
}

function setupSocketListeners(sk) {
  const manager = sk.io;

  sk.on('connect', () => {
    console.log('Socket connected:', sk.id);
    useGameStore.getState().setConnectionStatus('connected');
    useGameStore.getState().setReconnectAttempt(0);
    // Also try explicit rejoin on connect to recover from process restarts/network flips.
    setTimeout(() => {
      attemptRejoinRoom();
    }, 300);
  });

  sk.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server explicitly kicked us — do not auto-reconnect
      console.warn('[Socket] Server forced disconnect');
      useGameStore.getState().setConnectionStatus('failed');
    } else {
      useGameStore.getState().setConnectionStatus('disconnected');
    }
  });

  sk.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
    useGameStore.getState().setConnectionStatus('error');
  });

  const onReconnectAttempt = (attempt) => {
    console.log(`[Socket] Reconnection attempt ${attempt}`);
    useGameStore.getState().setConnectionStatus('reconnecting');
    useGameStore.getState().setReconnectAttempt(attempt);

    // Refresh auth token before each attempt so a stale JWT doesn't block us
    const freshToken = useAuthStore.getState().token;
    if (freshToken && sk.auth?.token !== freshToken) {
      sk.auth = { token: freshToken };
    }
  };

  const onReconnected = () => {
    console.log('[Socket] Socket reconnected');
    useGameStore.getState().setConnectionStatus('connected');
    useGameStore.getState().setReconnectAttempt(0);
    // Re-join the active room if there is one
    attemptRejoinRoom();
  };

  const onReconnectFailed = () => {
    console.error('[Socket] Reconnection failed permanently');
    useGameStore.getState().setConnectionStatus('failed');
  };

  if (manager) {
    manager.on('reconnect_attempt', onReconnectAttempt);
    manager.on('reconnect', onReconnected);
    manager.on('reconnect_failed', onReconnectFailed);
  }

  sk.on('server_shutdown', (data) => {
    console.warn('[Socket] Server shutting down:', data?.message);
    useGameStore.getState().setConnectionStatus('server_shutdown');
    // Room state will be gone when server comes back — treat as ended
    useGameStore.getState().resetGame('server_restarted');
  });

  // Reconnection to existing room (auto-handled on initial connect)
  sk.on('reconnected', (roomState) => {
    const userId = useAuthStore.getState().user?.id;
    useGameStore.getState().setRoomState(roomState);
    useGameStore.getState().setIsHost(roomState.hostId === userId);
  });

  // Player events
  sk.on('player_joined', (data) => {
    useGameStore.getState().updatePlayers(data.room.players);
  });

  sk.on('player_left', (data) => {
    useGameStore.getState().updatePlayers(data.room.players);
    const userId = useAuthStore.getState().user?.id;
    useGameStore.getState().setIsHost(data.newHostId === userId);
  });

  sk.on('player_disconnected', (data) => {
    useGameStore.getState().updatePlayers(data.room.players);
  });

  sk.on('player_reconnected', () => {
    // Optionally refresh player list — handled via reconnected state
  });

  // Game events
  sk.on('new_round', (roundData) => {
    useGameStore.getState().setNewRound(roundData);
  });

  sk.on('answer_submitted', (data) => {
    useGameStore.getState().updateAnswerCount(
      data.answersSubmitted,
      data.totalPlayers
    );
  });

  sk.on('voting_started', (data) => {
    useGameStore.getState().setVotingStarted(data.answers, data.timeLimit);
  });

  sk.on('vote_submitted', (data) => {
    useGameStore.getState().updateVoteCount(data.votesSubmitted);
  });

  sk.on('timer_tick', (data) => {
    useGameStore.getState().setTimerTick(data.remaining, data.phase);
  });

  sk.on('round_results', (results) => {
    useGameStore.getState().setRoundResults(results);
  });

  sk.on('game_over', (results) => {
    useGameStore.getState().setGameOver(results);
  });

  // Emoji reactions
  sk.on('emoji_reaction', (data) => {
    useGameStore.getState().addReaction(data);
  });
}

// ==================== GAME ACTIONS ====================

export async function createRoom(options) {
  const response = await emitWithTimeout('create_room', options);
  useGameStore.getState().setRoomState(response.room);
  useGameStore.getState().setIsHost(true);
  useGameStore.getState().setLastRoomCode(response.room.roomCode);
  return response;
}

export async function joinRoom(roomCode, displayName, avatarId) {
  const response = await emitWithTimeout('join_room', { roomCode, displayName, avatarId });
  useGameStore.getState().setRoomState(response.room);
  const userId = useAuthStore.getState().user?.id;
  useGameStore.getState().setIsHost(response.room.hostId === userId);
  useGameStore.getState().setLastRoomCode(response.room.roomCode);
  return response;
}

export function leaveRoom() {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      useGameStore.getState().resetGame();
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      useGameStore.getState().resetGame();
      resolve();
    }, 5000);
    socket.emit('leave_room', () => {
      clearTimeout(timer);
      useGameStore.getState().resetGame();
      resolve();
    });
  });
}

export async function startGame() {
  return emitWithTimeout('start_game', undefined, 15000);
}

export async function submitAnswer(answer) {
  const response = await emitWithTimeout('submit_answer', { answer });
  useGameStore.getState().setAnswerSubmitted();
  return response;
}

export async function submitVote(answerId) {
  const response = await emitWithTimeout('submit_vote', { answerId });
  useGameStore.getState().setVoteSubmitted(answerId);
  return response;
}

export async function requestNextRound() {
  return emitWithTimeout('next_round', undefined, 15000);
}

export async function getPublicRooms() {
  const response = await emitWithTimeout('get_public_rooms');
  return response.rooms;
}

export function sendEmojiReaction(emoji) {
  if (socket?.connected) {
    socket.emit('emoji_reaction', { emoji });
  }
}
