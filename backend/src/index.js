const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const config = require('./config');
const logger = require('./utils/logger');
const { setupSocketHandlers } = require('./socket/gameSocket');
const gameEngine = require('./services/gameEngine');

// Routes
const authRoutes = require('./routes/auth');
const leaderboardRoutes = require('./routes/leaderboard');

// Initialize Express
const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
  origin: config.cors.origins.includes('*')
    ? true
    : config.cors.origins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  maxAge: 86400,
};

// Initialize Socket.IO
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 90000,       // 90 s — tunnels have higher RTT
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,   // 1 MB max message
  connectTimeout: 45000,    // 45 s — tunnel initial handshake needs extra time
});

// Per-IP connection tracking for Socket.IO
const ipConnectionCount = new Map();
io.use((socket, next) => {
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.address;
  const count = ipConnectionCount.get(ip) || 0;
  if (count >= config.socket.maxConnectionsPerIp) {
    return next(new Error('Too many connections from this IP'));
  }
  ipConnectionCount.set(ip, count + 1);
  socket.on('disconnect', () => {
    const current = ipConnectionCount.get(ip) || 1;
    if (current <= 1) ipConnectionCount.delete(ip);
    else ipConnectionCount.set(ip, current - 1);
  });
  next();
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: config.isProduction ? undefined : false,
}));
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '256kb' }));

// Request ID
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow request', { method: req.method, url: req.originalUrl, status: res.statusCode, duration, requestId: req.id });
    }
  });
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
});
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.floor(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    connections: io.engine?.clientsCount || 0,
    rooms: gameEngine.getRoomCount(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// Genre list endpoint (no auth needed)
const { getGenreList } = require('./services/aiService');
app.get('/api/genres', (req, res) => {
  res.json({ success: true, genres: getGenreList() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, requestId: req.id });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: config.isProduction ? 'Internal server error' : err.message,
    ...(req.id ? { requestId: req.id } : {}),
  });
});

// Setup Socket handlers
setupSocketHandlers(io);

// Start server
server.listen(config.port, () => {
  logger.info(`Nebula backend running on port ${config.port} (${config.nodeEnv})`);
  logger.info(`WebSocket server ready`);
});

// Graceful shutdown
let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Notify connected clients
  io.emit('server_shutdown', { message: 'Server is restarting, please reconnect shortly' });

  // Close socket connections
  io.close(() => {
    logger.info('Socket.IO server closed');
  });

  // Cleanup game rooms
  gameEngine.shutdownCleanup();

  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);

  setTimeout(() => {
    logger.info('Graceful shutdown complete');
    process.exit(0);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

module.exports = { app, server, io };
