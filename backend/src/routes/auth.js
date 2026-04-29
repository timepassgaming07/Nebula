const express = require('express');
const { ensureUserProfile, getUserById, updateUserProfile } = require('../services/authService');
const { authMiddleware } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = req.authUser
      ? await ensureUserProfile(req.authUser)
      : await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    logger.error('Get profile failed', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update profile
router.put('/me', authMiddleware, validate(schemas.updateProfile), async (req, res) => {
  try {
    const user = await updateUserProfile(req.userId, req.body);
    res.json({ success: true, user });
  } catch (error) {
    logger.error('Update profile failed', { error: error.message, requestId: req.id });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
