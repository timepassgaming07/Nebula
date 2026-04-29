const { verifySupabaseToken } = require('../services/authService');
const logger = require('../utils/logger');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.split(' ')[1];
    if (!token || token.length > 5000) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const supabaseUser = await verifySupabaseToken(token);
    if (supabaseUser) {
      req.userId = supabaseUser.id;
      req.authUser = supabaseUser;
      return next();
    }

    return res.status(401).json({ error: 'Invalid token' });
  } catch (error) {
    logger.error('Auth middleware error', { error: error.message, requestId: req.id });
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = { authMiddleware };
