# Supabase Trivia Architecture Blueprint

This repository now includes a complete Supabase implementation scaffold for:

1. Strict Postgres schema + Realtime game sync
2. Asynchronous AI batch generation worker
3. Session ad-gating logic (3 games -> rewarded ad)
4. Premium category rewarded unlock
5. Anti-repeat question fetch using native Postgres RPC + local seen list

## Files Added

- SQL migration: `supabase/migrations/001_trivia_core.sql`
- AI worker: `backend/scripts/supabase-ai-agent.js`
- RN Supabase client: `frontend/src/config/supabaseClient.js`
- RN Realtime sync: `frontend/src/services/realtimeRoomStateService.js`
- RN ad state: `frontend/src/stores/monetizationStore.js`
- RN anti-repeat service: `frontend/src/services/questionAntiRepeatService.js`

## Backend Setup

Install backend deps:

```bash
cd backend
npm install
```

Required env vars for worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER=openai|gemini`
- `OPENAI_API_KEY` (if `AI_PROVIDER=openai`)
- `GEMINI_API_KEY` (if `AI_PROVIDER=gemini`)

Optional tuning:

- `AI_THRESHOLD` (default `500`)
- `AI_BATCH_SIZE` (default `50`)
- `AI_POLL_INTERVAL_MS` (default `300000`)
- `AI_RUN_ONCE=true|false` (default `false`)

Run:

```bash
npm run ai:refill
```

## Frontend Setup (React Native / Expo)

Install frontend deps:

```bash
cd frontend
npm install
```

Expo public env vars:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### Realtime usage (RN)

```js
import { subscribeRoomState } from '../src/services/realtimeRoomStateService';

const unsubscribe = subscribeRoomState(roomId, (snapshot) => {
  // snapshot.phase, snapshot.scoreboard, snapshot.remainingMs, etc.
});

// cleanup
unsubscribe();
```

### Ad-gating usage (RN)

```js
import {
  ensurePlayGateUnlocked,
  ensureCategoryUnlockedForSession,
  useMonetizationStore,
} from '../src/stores/monetizationStore';

// after game ends
useMonetizationStore.getState().onGameCompleted();

// before starting a game
const canPlay = await ensurePlayGateUnlocked(showRewardedAd);

// before selecting premium category
const categoryAllowed = await ensureCategoryUnlockedForSession(category, showRewardedAd);
```

### Anti-repeat usage (RN)

```js
import { fetchGameQuestions } from '../src/services/questionAntiRepeatService';

const questions = await fetchGameQuestions({
  categoryId,
  limit: 10,
});
```

## Flutter equivalent snippets

### Realtime subscription (Flutter)

```dart
final channel = supabase.channel('room-state-$roomId')
  ..onPostgresChanges(
    event: PostgresChangeEvent.update,
    schema: 'public',
    table: 'game_room_state',
    filter: PostgresChangeFilter(
      type: PostgresChangeFilterType.eq,
      column: 'room_id',
      value: roomId,
    ),
    callback: (payload) {
      final row = payload.newRecord;
      // Apply row['phase'], row['scoreboard'], timer offset using server_now/countdown_ends_at
    },
  )
  ..subscribe();
```

### Session ad loop (Flutter pseudocode)

```dart
int gamesPlayed = 0;
final Set<String> premiumUnlocked = {};

bool canStartGame() => gamesPlayed < 3;

Future<bool> passGameGate() async {
  if (canStartGame()) return true;
  final rewarded = await showRewardedAd();
  if (!rewarded) return false;
  gamesPlayed = 0;
  return true;
}

Future<bool> unlockPremiumIfNeeded(String categoryId, bool isPremium) async {
  if (!isPremium || premiumUnlocked.contains(categoryId)) return true;
  final rewarded = await showRewardedAd();
  if (!rewarded) return false;
  premiumUnlocked.add(categoryId);
  return true;
}
```
