const { getSupabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

async function getGlobalLeaderboard(limit = 50) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('users')
    .select('id, display_name, avatar_id, total_score, level, total_wins, total_games')
    .order('total_score', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((row, index) => ({
    rank: index + 1,
    uid: row.id,
    displayName: row.display_name,
    avatarId: row.avatar_id,
    totalScore: row.total_score,
    level: row.level,
    totalWins: row.total_wins,
    totalGamesPlayed: row.total_games,
  }));
}

async function getFriendsLeaderboard(uid, friendIds = []) {
  if (friendIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const allIds = [...new Set([uid, ...friendIds])];
  const chunks = [];
  for (let i = 0; i < allIds.length; i += 100) {
    chunks.push(allIds.slice(i, i + 100));
  }

  const results = [];
  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('users')
      .select('id, display_name, avatar_id, total_score, level, total_wins')
      .in('id', chunk);
    if (error) throw error;
    (data || []).forEach((row) => {
      results.push({
        uid: row.id,
        displayName: row.display_name,
        avatarId: row.avatar_id,
        totalScore: row.total_score,
        level: row.level,
        totalWins: row.total_wins,
      });
    });
  }

  results.sort((a, b) => b.totalScore - a.totalScore);
  return results.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function saveGameResult(gameData) {
  const supabase = getSupabaseAdmin();
  const payload = {
    room_code: gameData.roomCode,
    game_mode: gameData.gameMode,
    players: gameData.players,
    rounds: gameData.rounds,
    winner_id: gameData.winnerId,
    completed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('game_results')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    logger.error('Failed to save game result', { error: error.message });
    throw error;
  }

  return data?.id;
}

module.exports = {
  getGlobalLeaderboard,
  getFriendsLeaderboard,
  saveGameResult,
};
