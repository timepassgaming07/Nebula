const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Enforce critical secrets in production
if (isProduction) {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
  }
  // At least one AI provider key is needed
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error('At least one AI provider key required (GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY)');
  }
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv,
  isProduction,

  cors: {
    // Mobile apps don't send an Origin header, so allow all by default.
    // Set CORS_ORIGINS to restrict for a web dashboard later.
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
      : ['*'],
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS, 10) || 15000,
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES, 10) || 2,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 15000,
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY,
    timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS, 10) || 15000,
  },

  aiProvider: process.env.AI_PROVIDER || 'openai', // 'gemini', 'groq', or 'openai'


  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  socket: {
    // Many players on the same wifi/campus network may share one public IP (NAT).
    // Keep a higher default in development so "anyone can play" during demos.
    maxConnectionsPerIp: (() => {
      const fromEnv = parseInt(process.env.MAX_CONNECTIONS_PER_IP, 10);
      if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
      return isProduction ? 5 : 50;
    })(),
    maxEventsPerSecond: parseInt(process.env.MAX_EVENTS_PER_SECOND, 10) || 20,
  },

  game: {
    maxPlayersPerRoom: parseInt(process.env.MAX_PLAYERS_PER_ROOM, 10) || 10,
    minPlayersToStart: parseInt(process.env.MIN_PLAYERS_TO_START, 10) || 2,
    roundTimeSeconds: parseInt(process.env.ROUND_TIME_SECONDS, 10) || 60,
    voteTimeSeconds: parseInt(process.env.VOTE_TIME_SECONDS, 10) || 30,
    maxRounds: parseInt(process.env.MAX_ROUNDS, 10) || 10,
    roomTtlMs: parseInt(process.env.ROOM_TTL_MS, 10) || 3600000, // 1 hour
    maxRooms: parseInt(process.env.MAX_ROOMS, 10) || 500,
    disconnectGracePeriodMs: parseInt(process.env.DISCONNECT_GRACE_PERIOD_MS, 10) || 60000,
  },
};

module.exports = config;
