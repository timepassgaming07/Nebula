import { create } from 'zustand';

const GAME_STATES = {
  IDLE: 'idle',
  LOBBY: 'lobby',
  GENERATING_QUESTION: 'generating_question',
  SUBMITTING_ANSWERS: 'submitting_answers',
  VOTING: 'voting',
  REVEALING: 'revealing',
  ROUND_RESULTS: 'round_results',
  GAME_OVER: 'game_over',
};

const useGameStore = create((set, get) => ({
  // Room state
  roomCode: null,
  lastRoomCode: null,     // persisted so rejoin_room can refer to it after reconnect
  hostId: null,
  gameMode: 'classic',
  genre: null,
  state: GAME_STATES.IDLE,
  players: [],
  isHost: false,

  // Connection state
  connectionStatus: 'connected',  // 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'failed' | 'server_shutdown'
  reconnectAttempt: 0,
  roomEndedReason: null,           // 'server_restarted' | null

  // Round state
  currentRound: 0,
  totalRounds: 10,
  question: null,
  timeLimit: 60,
  timeRemaining: 0,
  timerPhase: null, // 'answer' | 'vote'

  // Answer/voting state
  answers: [],
  myAnswer: null,
  hasSubmittedAnswer: false,
  hasVoted: false,
  selectedAnswerId: null,
  answersSubmitted: 0,
  votesSubmitted: 0,

  // Results
  roundResults: null,
  gameResults: null,

  // Reactions
  reactions: [],

  // Actions
  setRoomState: (roomState) => {
    set({
      roomCode: roomState.roomCode,
      hostId: roomState.hostId,
      gameMode: roomState.gameMode,
      genre: roomState.genre || null,
      state: roomState.state === 'lobby' ? GAME_STATES.LOBBY : roomState.state,
      players: roomState.players || [],
      currentRound: roomState.currentRound,
      totalRounds: roomState.maxRounds || roomState.totalRounds || 5,
      roomEndedReason: null,
    });
  },

  setLastRoomCode: (code) => set({ lastRoomCode: code }),

  setIsHost: (isHost) => set({ isHost }),

  updatePlayers: (players) => set({ players }),

  // Connection status
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setReconnectAttempt: (n) => set({ reconnectAttempt: n }),

  setNewRound: (roundData) => {
    set({
      state: GAME_STATES.SUBMITTING_ANSWERS,
      currentRound: roundData.round,
      totalRounds: roundData.totalRounds,
      question: roundData.question,
      timeLimit: roundData.timeLimit,
      timeRemaining: roundData.timeLimit,
      timerPhase: 'answer',
      answers: [],
      myAnswer: null,
      hasSubmittedAnswer: false,
      hasVoted: false,
      selectedAnswerId: null,
      answersSubmitted: 0,
      votesSubmitted: 0,
      roundResults: null,
    });
  },

  setAnswerSubmitted: () => set({ hasSubmittedAnswer: true }),

  updateAnswerCount: (count) => set({ answersSubmitted: count }),

  setVotingStarted: (answers, timeLimit) => {
    set({
      state: GAME_STATES.VOTING,
      answers,
      timeLimit,
      timeRemaining: timeLimit,
      timerPhase: 'vote',
    });
  },

  setVoteSubmitted: (answerId) => set({ hasVoted: true, selectedAnswerId: answerId }),

  updateVoteCount: (count) => set({ votesSubmitted: count }),

  setTimerTick: (remaining, phase) => {
    const current = get().timerPhase;
    // Only accept ticks that match the current phase
    if (phase && current && phase !== current) return;
    set({ timeRemaining: remaining });
  },

  setRoundResults: (results) => {
    set({
      state: GAME_STATES.ROUND_RESULTS,
      roundResults: results,
      timerPhase: null,
    });
  },

  setGameOver: (results) => {
    set({
      state: GAME_STATES.GAME_OVER,
      gameResults: results,
      timerPhase: null,
    });
  },

  addReaction: (reaction) => {
    const id = Date.now() + Math.random();
    const newReaction = { ...reaction, id };
    const reactions = [...get().reactions, newReaction];
    // Keep only last 20 reactions
    set({ reactions: reactions.slice(-20) });
    // Auto-remove after 3 seconds
    setTimeout(() => {
      set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) }));
    }, 3000);
  },

  resetGame: (reason = null) => {
    set({
      roomCode: null,
      // Do NOT clear lastRoomCode — needed for rejoin on reconnect
      hostId: null,
      gameMode: 'classic',
      genre: null,
      state: GAME_STATES.IDLE,
      players: [],
      isHost: false,
      currentRound: 0,
      totalRounds: 10,
      question: null,
      timeLimit: 60,
      timeRemaining: 0,
      timerPhase: null,
      answers: [],
      myAnswer: null,
      hasSubmittedAnswer: false,
      hasVoted: false,
      selectedAnswerId: null,
      answersSubmitted: 0,
      votesSubmitted: 0,
      roundResults: null,
      gameResults: null,
      reactions: [],
      roomEndedReason: reason,
    });
    // Clear lastRoomCode only after a voluntary leave (no reason)
    if (!reason) {
      set({ lastRoomCode: null });
    }
  },
}));

export { GAME_STATES };
export default useGameStore;
