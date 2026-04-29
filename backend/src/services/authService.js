const { nanoid } = require('nanoid');
const logger = require('../utils/logger');
const { getSupabaseAdmin } = require('../config/supabase');

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    avatarId: row.avatar_id,
    xp: row.xp,
    level: row.level,
    totalGamesPlayed: row.total_games,
    totalWins: row.total_wins,
    totalScore: row.total_score,
    totalCorrectGuesses: row.total_correct_guesses,
    totalBluffsSuccessful: row.total_bluffs_successful,
    email: row.email,
    provider: row.provider,
    createdAt: row.created_at,
    lastLoginAt: row.updated_at,
  };
}

function buildDefaultProfile(uid, overrides = {}) {
  const username = `user_${uid.slice(0, 8)}_${nanoid(4)}`;
  return {
    id: uid,
    username,
    display_name: overrides.display_name || `Player_${uid.slice(0, 6)}`,
    avatar_id: overrides.avatar_id || Math.floor(Math.random() * 20) + 1,
    email: overrides.email || null,
    provider: overrides.provider || 'anonymous',
    xp: 0,
    level: 1,
    total_games: 0,
    total_wins: 0,
    total_score: 0,
    total_correct_guesses: 0,
    total_bluffs_successful: 0,
  };
}

async function verifySupabaseToken(accessToken) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) {
      return null;
    }
    return data.user;
  } catch (error) {
    logger.error('Supabase token verification failed', { error: error.message });
    return null;
  }
}

async function ensureUserProfile(authUser) {
  const supabase = getSupabaseAdmin();
  const uid = authUser.id;

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('*')
    .eq('id', uid)
    .single();

  if (existing) return mapUserRow(existing);
  if (existingError && existingError.code !== 'PGRST116') {
    throw existingError;
  }

  const defaults = buildDefaultProfile(uid, {
    display_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || 'Player',
    email: authUser.email || null,
    provider: authUser.app_metadata?.provider || authUser.user_metadata?.provider || 'supabase',
  });

  const { data, error } = await supabase
    .from('users')
    .insert(defaults)
    .select('*')
    .single();

  if (error) throw error;
  return mapUserRow(data);
}

async function getUserById(uid) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', uid)
    .single();

  if (data) return mapUserRow(data);
  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const defaults = buildDefaultProfile(uid, {});
  const { data: created, error: createError } = await supabase
    .from('users')
    .insert(defaults)
    .select('*')
    .single();

  if (createError) throw createError;
  return mapUserRow(created);
}

async function updateUserStats(uid, stats) {
  const supabase = getSupabaseAdmin();
  const updates = {};

  if (stats.totalGamesPlayed !== undefined) updates.total_games = stats.totalGamesPlayed;
  if (stats.totalWins !== undefined) updates.total_wins = stats.totalWins;
  if (stats.totalScore !== undefined) updates.total_score = stats.totalScore;
  if (stats.totalCorrectGuesses !== undefined) updates.total_correct_guesses = stats.totalCorrectGuesses;
  if (stats.totalBluffsSuccessful !== undefined) updates.total_bluffs_successful = stats.totalBluffsSuccessful;
  if (stats.xp !== undefined) updates.xp = stats.xp;
  if (stats.level !== undefined) updates.level = stats.level;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', uid);

  if (error) throw error;
}

async function updateUserProfile(uid, updates) {
  const supabase = getSupabaseAdmin();
  const sanitized = {};

  if (updates.displayName !== undefined) sanitized.display_name = updates.displayName;
  if (updates.avatarId !== undefined) sanitized.avatar_id = updates.avatarId;

  if (Object.keys(sanitized).length === 0) {
    return getUserById(uid);
  }

  const { data, error } = await supabase
    .from('users')
    .update(sanitized)
    .eq('id', uid)
    .select('*')
    .single();

  if (error) throw error;
  return mapUserRow(data);
}

module.exports = {
  verifySupabaseToken,
  ensureUserProfile,
  getUserById,
  updateUserStats,
  updateUserProfile,
};
