import { getSupabaseClient } from '../config/supabaseClient';

/**
 * Subscribe to a room's realtime state updates.
 * The callback receives a normalized snapshot with server-synced countdown.
 */
export function subscribeRoomState(roomId, onState) {
  const supabase = getSupabaseClient();

  const channel = supabase
    .channel(`room-state-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'game_room_state',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const row = payload.new;
        const serverNowMs = row.server_now ? new Date(row.server_now).getTime() : Date.now();
        const localNowMs = Date.now();
        const clockOffsetMs = localNowMs - serverNowMs;

        let remainingMs = 0;
        if (row.countdown_ends_at) {
          const endsAtMs = new Date(row.countdown_ends_at).getTime();
          remainingMs = Math.max(0, endsAtMs - (Date.now() - clockOffsetMs));
        }

        onState({
          roomId: row.room_id,
          phase: row.phase,
          version: row.version,
          scoreboard: row.scoreboard,
          payload: row.payload,
          currentQuestionId: row.current_question_id,
          remainingMs,
          serverNow: row.server_now,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
