const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getGlobalLeaderboard } = require('../services/leaderboardService');

const router = express.Router();

router.get('/global', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const leaderboard = await getGlobalLeaderboard(limit);
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

module.exports = router;
