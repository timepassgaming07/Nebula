import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '../config/supabaseClient';

const SEEN_QUESTIONS_KEY = 'seen_question_ids_v1';
const MAX_SEEN_QUESTIONS = 500;

export async function getSeenQuestionIds() {
  const raw = await AsyncStorage.getItem(SEEN_QUESTIONS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => Number.isInteger(id));
  } catch {
    return [];
  }
}

export async function pushSeenQuestionIds(newIds) {
  const current = await getSeenQuestionIds();
  const deduped = new Map();

  for (const id of current) {
    deduped.set(id, true);
  }
  for (const id of newIds) {
    if (!Number.isInteger(id)) continue;
    if (deduped.has(id)) deduped.delete(id);
    deduped.set(id, true);
  }

  const merged = Array.from(deduped.keys()).slice(-MAX_SEEN_QUESTIONS);
  await AsyncStorage.setItem(SEEN_QUESTIONS_KEY, JSON.stringify(merged));
}

/**
 * Fetches a randomized batch that excludes the last 500 seen questions,
 * then marks returned IDs as served server-side and caches them locally.
 */
export async function fetchGameQuestions({ categoryId, limit = 10 }) {
  const supabase = getSupabaseClient();
  const seenIds = await getSeenQuestionIds();

  const { data, error } = await supabase.rpc('fetch_live_questions', {
    p_category_id: categoryId,
    p_seen_question_ids: seenIds,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const questionIds = (data || []).map((q) => q.id).filter((id) => Number.isInteger(id));

  if (questionIds.length > 0) {
    const markResult = await supabase.rpc('mark_questions_served', {
      p_question_ids: questionIds,
    });

    if (markResult.error) {
      // Non-fatal for gameplay; keep serving fetched data.
      console.warn('mark_questions_served failed:', markResult.error.message);
    }

    await pushSeenQuestionIds(questionIds);
  }

  return data || [];
}
