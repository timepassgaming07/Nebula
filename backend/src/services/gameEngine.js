const { nanoid } = require('nanoid');
const { generateQuestion } = require('../services/aiService');
const { moderatePlayerAnswer } = require('../services/aiService');
const { updateUserStats, getUserById } = require('../services/authService');
const { saveGameResult } = require('../services/leaderboardService');
const logger = require('../utils/logger');
const config = require('../config');

// In-memory game rooms store
const rooms = new Map();

// Public rooms available for matchmaking
const publicRooms = new Map();

// Locks to prevent concurrent state mutations per room
const roomLocks = new Map();

const GAME_STATES = {
  LOBBY: 'lobby',
  GENERATING_QUESTION: 'generating_question',
  SUBMITTING_ANSWERS: 'submitting_answers',
  VOTING: 'voting',
  REVEALING: 'revealing',
  ROUND_RESULTS: 'round_results',
  GAME_OVER: 'game_over',
};

function getRoomTimers(gameMode, genre, options = {}) {
  const baseRound = options.roundTimeSeconds || config.game.roundTimeSeconds;
  const baseVote = options.voteTimeSeconds || config.game.voteTimeSeconds;

  // Slightly longer windows for harder/funnier decks that typically need more typing.
  const bonusByGenre = {
    'movie-bluff': { round: 15, vote: 5 },
    'search-history': { round: 10, vote: 5 },
    'adulting-101': { round: 10, vote: 5 },
    'history-hysteria': { round: 8, vote: 3 },
    'tech-talk': { round: 8, vote: 3 },
  };

  const bonusByMode = {
    meme: { round: 5, vote: 0 },
  };

  const genreBonus = bonusByGenre[genre] || { round: 0, vote: 0 };
  const modeBonus = bonusByMode[gameMode] || { round: 0, vote: 0 };

  return {
    round: baseRound + genreBonus.round + modeBonus.round,
    vote: baseVote + genreBonus.vote + modeBonus.vote,
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Simple async lock per room to guard concurrent state mutations
async function withRoomLock(roomCode, fn) {
  while (roomLocks.get(roomCode)) {
    await new Promise(r => setTimeout(r, 10));
  }
  roomLocks.set(roomCode, true);
  try {
    return await fn();
  } finally {
    roomLocks.delete(roomCode);
  }
}

function createRoom(hostPlayer, options = {}) {
  // Room limit check
  if (rooms.size >= config.game.maxRooms) {
    throw new Error('Server room limit reached. Please try again later.');
  }

  let roomCode;
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  const gameMode = options.gameMode || 'classic';
  const genre = options.genre || null;
  const timers = getRoomTimers(gameMode, genre, options);

  const room = {
    roomCode,
    hostId: hostPlayer.uid,
    gameMode,
    genre,
    maxRounds: options.maxRounds || config.game.maxRounds,
    roundTimeSeconds: timers.round,
    voteTimeSeconds: timers.vote,
    isPublic: options.isPublic || false,
    maxPlayers: options.maxPlayers || config.game.maxPlayersPerRoom,
    state: GAME_STATES.LOBBY,
    currentRound: 0,
    players: new Map(),
    currentQuestion: null,
    answers: new Map(),       // playerId -> answer text
    votes: new Map(),         // voterId -> answerId
    roundScores: new Map(),   // playerId -> round score
    totalScores: new Map(),   // playerId -> total score
    roundTimer: null,
    voteTimer: null,
    rounds: [],               // History of rounds
    createdAt: Date.now(),
    disconnectedPlayers: new Map(), // playerId -> timeout
  };

  // Add host to players
  room.players.set(hostPlayer.uid, {
    uid: hostPlayer.uid,
    displayName: hostPlayer.displayName,
    avatarId: hostPlayer.avatarId,
    isHost: true,
    isConnected: true,
    socketId: hostPlayer.socketId,
  });
  room.totalScores.set(hostPlayer.uid, 0);

  rooms.set(roomCode, room);

  if (options.isPublic) {
    publicRooms.set(roomCode, {
      roomCode,
      hostName: hostPlayer.displayName,
      playerCount: 1,
      maxPlayers: room.maxPlayers,
      gameMode: room.gameMode,
      genre: room.genre,
    });
  }

  logger.info(`Room created: ${roomCode} by ${hostPlayer.displayName}`);
  return room;
}

function joinRoom(roomCode, player) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.state !== GAME_STATES.LOBBY) return { error: 'Game already in progress' };
  if (room.players.size >= room.maxPlayers) return { error: 'Room is full' };

  // Check if player is reconnecting
  if (room.players.has(player.uid)) {
    const existing = room.players.get(player.uid);
    existing.isConnected = true;
    existing.socketId = player.socketId;
    if (room.disconnectedPlayers.has(player.uid)) {
      clearTimeout(room.disconnectedPlayers.get(player.uid));
      room.disconnectedPlayers.delete(player.uid);
    }
    return { room, reconnected: true };
  }

  room.players.set(player.uid, {
    uid: player.uid,
    displayName: player.displayName,
    avatarId: player.avatarId,
    isHost: false,
    isConnected: true,
    socketId: player.socketId,
  });
  room.totalScores.set(player.uid, 0);

  // Update public room info
  if (room.isPublic && publicRooms.has(roomCode)) {
    publicRooms.get(roomCode).playerCount = room.players.size;
  }

  logger.info(`Player ${player.displayName} joined room ${roomCode}`);
  return { room };
}

function leaveRoom(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.players.delete(playerId);
  room.totalScores.delete(playerId);

  if (room.players.size === 0) {
    destroyRoom(roomCode);
    return null;
  }

  // Host migration
  if (room.hostId === playerId) {
    const nextPlayer = room.players.values().next().value;
    if (nextPlayer) {
      room.hostId = nextPlayer.uid;
      nextPlayer.isHost = true;
      logger.info(`Host migrated to ${nextPlayer.displayName} in room ${roomCode}`);
    }
  }

  if (room.isPublic && publicRooms.has(roomCode)) {
    publicRooms.get(roomCode).playerCount = room.players.size;
  }

  return room;
}

function handleDisconnect(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const player = room.players.get(playerId);
  if (!player) return null;

  player.isConnected = false;

  // Give configurable time to reconnect before removing
  const timeout = setTimeout(() => {
    const currentRoom = rooms.get(roomCode);
    if (currentRoom) {
      leaveRoom(roomCode, playerId);
      currentRoom.disconnectedPlayers.delete(playerId);
    }
  }, config.game.disconnectGracePeriodMs);

  room.disconnectedPlayers.set(playerId, timeout);

  return room;
}

function handleReconnect(roomCode, playerId, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const player = room.players.get(playerId);
  if (!player) return null;

  player.isConnected = true;
  player.socketId = socketId;

  if (room.disconnectedPlayers.has(playerId)) {
    clearTimeout(room.disconnectedPlayers.get(playerId));
    room.disconnectedPlayers.delete(playerId);
  }

  return room;
}

async function startGame(roomCode) {
  return withRoomLock(roomCode, async () => {
    const room = rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.state !== GAME_STATES.LOBBY) return { error: 'Game already in progress' };
    if (room.players.size < config.game.minPlayersToStart) {
      return { error: `Need at least ${config.game.minPlayersToStart} players to start` };
    }

    // Remove from public rooms
    publicRooms.delete(roomCode);

    room.currentRound = 0;
    return _startNextRoundInternal(roomCode);
  });
}

// Internal (called while lock is held)
async function _startNextRoundInternal(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };

  room.currentRound++;
  if (room.currentRound > room.maxRounds) {
    return endGame(roomCode);
  }

  room.state = GAME_STATES.GENERATING_QUESTION;
  room.answers.clear();
  room.votes.clear();
  room.roundScores.clear();

  // Generate AI question
  const questionData = await generateQuestion(room.gameMode, room.genre);
  room.currentQuestion = questionData;

  room.state = GAME_STATES.SUBMITTING_ANSWERS;

  logger.info(`Round ${room.currentRound} started in room ${roomCode}: ${questionData.question}`);

  return {
    round: room.currentRound,
    totalRounds: room.maxRounds,
    question: questionData.question,
    gameMode: room.gameMode,
    timeLimit: room.roundTimeSeconds,
  };
}

async function startNextRound(roomCode) {
  return withRoomLock(roomCode, () => _startNextRoundInternal(roomCode));
}

async function submitAnswer(roomCode, playerId, answer) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.state !== GAME_STATES.SUBMITTING_ANSWERS) return { error: 'Not accepting answers' };
  if (!room.players.has(playerId)) return { error: 'Player not in room' };
  if (room.answers.has(playerId)) return { error: 'Already submitted' };

  // Validate and moderate (with timeout so submissions never hang)
  const trimmed = answer.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    return { error: 'Answer must be 1-100 characters' };
  }

  try {
    const modResult = await Promise.race([
      moderatePlayerAnswer(trimmed),
      new Promise(resolve => setTimeout(() => resolve({ flagged: false }), 3000)),
    ]);
    if (modResult.flagged) {
      return { error: 'Answer contains inappropriate content' };
    }
  } catch {
    // Moderation failed - allow through
  }

  room.answers.set(playerId, trimmed);

  // Check if all connected players have submitted
  const connectedPlayers = [...room.players.values()].filter(p => p.isConnected);
  const allSubmitted = connectedPlayers.every(p => room.answers.has(p.uid));

  return { submitted: true, allSubmitted };
}

function getShuffledAnswers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || !room.currentQuestion) return null;

  const answers = [];

  // Add player answers
  for (const [playerId, answer] of room.answers) {
    answers.push({
      id: `player_${playerId}`,
      text: answer,
      isCorrect: false,
      submittedBy: playerId,
    });
  }

  // Add correct answer
  answers.push({
    id: 'correct_answer',
    text: room.currentQuestion.correct_answer,
    isCorrect: true,
    submittedBy: null,
  });

  // Shuffle using Fisher-Yates
  for (let i = answers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }

  // Return sanitized version (without metadata)
  return answers.map((a, index) => ({
    id: a.id,
    text: a.text,
    index,
  }));
}

function startVoting(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  room.state = GAME_STATES.VOTING;
  return getShuffledAnswers(roomCode);
}

function submitVote(roomCode, playerId, answerId) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };
  if (room.state !== GAME_STATES.VOTING) return { error: 'Not in voting phase' };
  if (!room.players.has(playerId)) return { error: 'Player not in room' };
  if (room.votes.has(playerId)) return { error: 'Already voted' };

  // Players cannot vote for their own answer
  if (answerId === `player_${playerId}`) {
    return { error: 'Cannot vote for your own answer' };
  }

  room.votes.set(playerId, answerId);

  const connectedPlayers = [...room.players.values()].filter(p => p.isConnected);
  const allVoted = connectedPlayers.every(p => room.votes.has(p.uid));

  return { voted: true, allVoted };
}

function calculateRoundResults(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.state = GAME_STATES.REVEALING;
  const results = {
    question: room.currentQuestion.question,
    correctAnswer: room.currentQuestion.correct_answer,
    round: room.currentRound,
    playerResults: [],
  };

  // Calculate scores
  const roundScores = new Map();
  room.players.forEach((_, pid) => roundScores.set(pid, 0));

  // Process votes
  for (const [voterId, answerId] of room.votes) {
    if (answerId === 'correct_answer') {
      // Player guessed correctly: +1000 points
      roundScores.set(voterId, (roundScores.get(voterId) || 0) + 1000);
    } else {
      // Player voted for someone else's bluff
      const blufferId = answerId.replace('player_', '');
      if (room.players.has(blufferId)) {
        // Bluffer gets +500 bonus points
        roundScores.set(blufferId, (roundScores.get(blufferId) || 0) + 500);
      }
    }
  }

  // Build result details
  for (const [playerId, player] of room.players) {
    const roundScore = roundScores.get(playerId) || 0;
    const totalBefore = room.totalScores.get(playerId) || 0;
    const totalAfter = totalBefore + roundScore;
    room.totalScores.set(playerId, totalAfter);
    room.roundScores.set(playerId, roundScore);

    const votedFor = room.votes.get(playerId);
    const votedCorrectly = votedFor === 'correct_answer';
    const submittedAnswer = room.answers.get(playerId) || null;

    // Count how many people voted for this player's bluff
    let bluffVotes = 0;
    for (const [, aid] of room.votes) {
      if (aid === `player_${playerId}`) bluffVotes++;
    }

    results.playerResults.push({
      uid: playerId,
      displayName: player.displayName,
      avatarId: player.avatarId,
      submittedAnswer,
      votedFor,
      votedCorrectly,
      bluffVotes,
      roundScore,
      totalScore: totalAfter,
    });
  }

  // Sort by total score
  results.playerResults.sort((a, b) => b.totalScore - a.totalScore);

  // Save round history
  room.rounds.push({
    round: room.currentRound,
    question: room.currentQuestion.question,
    correctAnswer: room.currentQuestion.correct_answer,
    results: results.playerResults,
  });

  room.state = GAME_STATES.ROUND_RESULTS;
  return results;
}

async function endGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.state = GAME_STATES.GAME_OVER;

  // Clear all timers including tick intervals
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.roundTickInterval) { clearInterval(room.roundTickInterval); room.roundTickInterval = null; }
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
  if (room.voteTickInterval) { clearInterval(room.voteTickInterval); room.voteTickInterval = null; }

  // Determine winner
  let maxScore = 0;
  let winnerId = null;
  for (const [playerId, score] of room.totalScores) {
    if (score > maxScore) {
      maxScore = score;
      winnerId = playerId;
    }
  }

  const finalResults = {
    roomCode,
    gameMode: room.gameMode,
    totalRounds: room.currentRound - 1,
    winner: winnerId ? {
      uid: winnerId,
      displayName: room.players.get(winnerId)?.displayName,
      avatarId: room.players.get(winnerId)?.avatarId,
      score: maxScore,
    } : null,
    standings: [],
    rounds: room.rounds,
  };

  // Build standings
  const standings = [];
  for (const [playerId, player] of room.players) {
    standings.push({
      uid: playerId,
      displayName: player.displayName,
      avatarId: player.avatarId,
      totalScore: room.totalScores.get(playerId) || 0,
    });
  }
  standings.sort((a, b) => b.totalScore - a.totalScore);
  finalResults.standings = standings.map((s, i) => ({ ...s, rank: i + 1 }));

  // Update player stats in database
  try {
    for (const standing of finalResults.standings) {
      const xpGained = standing.totalScore;
      const user = await getUserById(standing.uid);
      if (user) {
        const newXp = (user.xp || 0) + xpGained;
        const newLevel = Math.floor(newXp / 5000) + 1;
        await updateUserStats(standing.uid, {
          totalGamesPlayed: (user.totalGamesPlayed || 0) + 1,
          totalWins: (user.totalWins || 0) + (standing.uid === winnerId ? 1 : 0),
          totalScore: (user.totalScore || 0) + standing.totalScore,
          xp: newXp,
          level: newLevel,
        });
      }
    }

    // Save game result
    await saveGameResult({
      roomCode,
      gameMode: room.gameMode,
      players: finalResults.standings,
      rounds: room.rounds,
      winnerId,
    });
  } catch (error) {
    logger.error('Failed to save game stats', { error: error.message });
  }

  // Clean up room after delay
  setTimeout(() => destroyRoom(roomCode), 300000); // 5 minutes

  return { gameOver: true, results: finalResults };
}

function destroyRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.roundTickInterval) clearInterval(room.roundTickInterval);
    if (room.voteTimer) clearTimeout(room.voteTimer);
    if (room.voteTickInterval) clearInterval(room.voteTickInterval);
    for (const [, timeout] of room.disconnectedPlayers) {
      clearTimeout(timeout);
    }
    rooms.delete(roomCode);
    publicRooms.delete(roomCode);
    roomLocks.delete(roomCode);
    logger.info(`Room destroyed: ${roomCode}`);
  }
}

function getRoom(roomCode) {
  return rooms.get(roomCode);
}

function getRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    gameMode: room.gameMode,
    genre: room.genre,
    state: room.state,
    currentRound: room.currentRound,
    maxRounds: room.maxRounds,
    players: [...room.players.values()].map(p => ({
      uid: p.uid,
      displayName: p.displayName,
      avatarId: p.avatarId,
      isHost: p.isHost,
      isConnected: p.isConnected,
      score: room.totalScores.get(p.uid) || 0,
    })),
    answersSubmitted: room.answers.size,
    votesSubmitted: room.votes.size,
  };
}

function getPublicRooms() {
  return [...publicRooms.values()].filter(r => {
    const room = rooms.get(r.roomCode);
    return room && room.state === GAME_STATES.LOBBY && room.players.size < room.maxPlayers;
  });
}

function findRoomByPlayerId(playerId) {
  for (const [roomCode, room] of rooms) {
    if (room.players.has(playerId)) return roomCode;
  }
  return null;
}

function getRoomCount() {
  return rooms.size;
}

// Periodic stale room cleanup
const CLEANUP_INTERVAL_MS = 60000; // Every minute
let cleanupTimer = null;

function startRoomCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const ttl = config.game.roomTtlMs;
    let cleaned = 0;
    for (const [roomCode, room] of rooms) {
      const age = now - room.createdAt;
      const isEmpty = room.players.size === 0;
      const isStale = age > ttl;
      const isFinished = room.state === GAME_STATES.GAME_OVER && age > 300000;
      if (isEmpty || isStale || isFinished) {
        destroyRoom(roomCode);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`Room cleanup: destroyed ${cleaned} stale rooms, ${rooms.size} remaining`);
    }
  }, CLEANUP_INTERVAL_MS);
}

function shutdownCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  // Clear all timers in all rooms
  for (const [roomCode, room] of rooms) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.voteTimer) clearTimeout(room.voteTimer);
    for (const [, timeout] of room.disconnectedPlayers) {
      clearTimeout(timeout);
    }
  }
  logger.info(`Shutdown cleanup: cleared ${rooms.size} rooms`);
  rooms.clear();
  publicRooms.clear();
  roomLocks.clear();
}

// Start cleanup on module load
startRoomCleanup();

module.exports = {
  GAME_STATES,
  createRoom,
  joinRoom,
  leaveRoom,
  handleDisconnect,
  handleReconnect,
  startGame,
  startNextRound,
  submitAnswer,
  startVoting,
  submitVote,
  calculateRoundResults,
  endGame,
  getRoom,
  getRoomState,
  getPublicRooms,
  findRoomByPlayerId,
  destroyRoom,
  getRoomCount,
  shutdownCleanup,
};
