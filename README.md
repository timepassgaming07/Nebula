# NEBULA - Multiplayer Bluffing Trivia Game

A real-time multiplayer bluffing trivia party game (inspired by Psych!) with AI-generated questions, built with React Native (Expo) and Node.js.

## Architecture Overview

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│  React Native    │◄──── Socket.IO ────►│   Node.js Server  │
│  (Expo) Client   │                      │   (Express)       │
│                  │      REST API        │                   │
│  - Game UI       │◄──── HTTP ─────────►│  - Game Engine    │
│  - Animations    │                      │  - Auth           │
│  - State (Zustand)│                     │  - WebSocket Hub  │
└─────────────────┘                      └──────────────────┘
                                                  │
                                          ┌───────┴───────┐
                                          │               │
                                      ┌────▼────┐   ┌──────▼──────┐
                                    │ Supabase │   │   OpenAI    │
                                    │ Postgres │   │   GPT API   │
                                    │ + Auth   │   │ (Questions) │
                                    └─────────┘   └─────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React Native + Expo Router |
| Backend | Node.js + Express |
| Real-time | Socket.IO (WebSockets) |
| Database | Supabase Postgres |
| Auth | Supabase Auth |
| AI | OpenAI GPT-4o-mini |
| State | Zustand |
| Animations | React Native Reanimated |
| Ads | Google AdMob (optional) |

---

## Prerequisites

- **Node.js** >= 18
- **npm** or **yarn**
- **Expo CLI**: `npm install -g expo-cli`
- **EAS CLI**: `npm install -g eas-cli`
- **Supabase Project** (Postgres + Auth enabled)
- **OpenAI API Key** (for AI question generation)
- **Xcode** (for iOS development, macOS only)
- **Android Studio** (for Android development)

---

## Step-by-Step Setup

### 1. Supabase Setup

1. Go to [Supabase](https://supabase.com/) and create a new project
2. Run the migrations in `supabase/migrations/` (already applied if you used the connected MCP)
3. Grab your project URL + anon key:
  - Project Settings → API → `Project URL` + `anon public` key
4. Grab the service role key for the backend:
  - Project Settings → API → `service_role` key
5. Add env vars:
  - Frontend: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### 2. OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create an API key
3. Ensure you have credits/billing enabled
4. The app uses `gpt-4o-mini` (very cost-effective: ~$0.15 per 1M tokens)

### 3. Backend Setup

```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env with your values:
# - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# - OPENAI_API_KEY

# Install dependencies
npm install

# Start development server
npm run dev

# For production
NODE_ENV=production npm start
```

The backend will start on `http://localhost:3001`.

Test it: `curl http://localhost:3001/health`

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Update configuration:
# Edit src/config/env.js with your values:
# - SUPABASE_URL / SUPABASE_ANON_KEY (Expo public env vars preferred)
# - API_URL / WS_URL (backend URL)

# Start Expo dev server
npx expo start

# Run on iOS simulator
npx expo start --ios

# Run on Android emulator
npx expo start --android

# Run on physical device
# Scan QR code with Expo Go app
# NOTE: Update API_URL to your computer's local IP (not localhost)
```

**Important**: When testing on a physical device, change `API_URL` and `WS_URL` in `src/config/env.js` from `localhost` to your computer's local IP address (e.g., `http://192.168.1.100:3001`).

---

## Supabase Schema (high level)

- `public.users` — player profiles + lifetime stats (mirrors auth.users)
- `public.categories` — trivia decks
- `public.questions` — generated questions
- `public.game_rooms` / `public.game_room_state` — live multiplayer state
- `public.game_results` — completed match archives

---

## Game Flow

```
1. LOGIN → Guest / Google / Apple
2. HOME → Create Room / Join Room / Quick Match
3. LOBBY → Wait for players, share code, host starts
4. GAME LOOP (repeats for N rounds):
   a. AI generates question → shown to all players
   b. Players write fake answers (timer: 60s)
   c. Correct answer mixed in, shuffled
   d. Players vote on which is real (timer: 30s)
   e. Results revealed:
      - +1000 pts for correct guess
      - +500 pts per player fooled by your bluff
5. RESULTS → Final standings, XP earned, winner crowned
6. BACK TO HOME
```

---

## Multiplayer Testing

### Local Testing (2+ devices)

1. Start backend: `cd backend && npm run dev`
2. Start frontend: `cd frontend && npx expo start`
3. On Device 1:
   - Open app, login as Guest
   - Create a room, note the room code
4. On Device 2 (or simulator):
   - Open app, login as Guest (different account)
   - Join room using the room code
5. Host starts the game from the lobby

### Same Machine Testing

- Open two iOS simulators or two Android emulators
- Or use one simulator + one physical device
- Both connect to the same backend

### Edge Cases Handled

- **Player disconnects**: 60-second grace period to reconnect
- **Host leaves**: Automatic host migration to next player
- **All answers timeout**: Voting starts with submitted answers only
- **All votes timeout**: Results calculated with submitted votes only
- **AI API failure**: Fallback to pre-loaded questions
- **Content moderation**: Inappropriate answers rejected
- **Room cleanup**: Rooms destroyed 5 minutes after game ends

---

## Deployment

### Backend Deployment (e.g., Railway, Render, Fly.io)

#### Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
cd backend
railway init
railway up

# Set environment variables in Railway dashboard
```

#### Render
1. Push code to GitHub
2. Create new Web Service on Render
3. Point to `backend/` directory
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Add all environment variables from `.env`

#### Docker (any cloud)
```dockerfile
# backend/Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

### Android Deployment

```bash
cd frontend

# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure EAS
eas build:configure

# Build APK (for testing)
eas build --platform android --profile preview

# Build AAB (for Play Store)
eas build --platform android --profile production

# Submit to Play Store
eas submit --platform android
```

**Play Store Checklist:**
- [ ] Update `app.json` with production values
- [ ] Update `ADMOB_BANNER_ID` with production ad unit IDs
- [ ] Set `API_URL` / `WS_URL` to production server URL
- [ ] Create app listing in Google Play Console
- [ ] Upload AAB from EAS build
- [ ] Add screenshots, description, privacy policy
- [ ] Content rating questionnaire
- [ ] Submit for review

### iOS Deployment

```bash
cd frontend

# Build for iOS
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios
```

**App Store Checklist:**
- [ ] Apple Developer Account ($99/year)
- [ ] Configure App Store Connect listing
- [ ] Enable Apple Sign-In capability
- [ ] Add App Privacy details
- [ ] Upload build from EAS
- [ ] Add screenshots for all device sizes
- [ ] Submit for review

### EAS Build Profiles

Create `eas.json` in the frontend directory:

```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "android": {
        "buildType": "apk"
      },
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

---

## Environment Variables Reference

### Backend (`.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `production` |
| `SUPABASE_URL` | Supabase project URL | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `sbp_...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `GEMINI_API_KEY` | Gemini API key (optional) | `AIza...` |
| `GROQ_API_KEY` | Groq API key (optional) | `gsk_...` |

### Frontend (`src/config/env.js`)

| Variable | Description |
|----------|-------------|
| `API_URL` | Backend HTTP URL |
| `WS_URL` | Backend WebSocket URL |
| `SUPABASE_URL` | Supabase project URL (or EXPO_PUBLIC_SUPABASE_URL) |
| `SUPABASE_ANON_KEY` | Supabase anon key (or EXPO_PUBLIC_SUPABASE_ANON_KEY) |
| `ADMOB_*` | AdMob unit IDs |

---

## Project Structure

```
Nebula/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.js          # App configuration
│   │   │   └── supabase.js       # Supabase admin client
│   │   ├── middleware/
│   │   │   ├── auth.js           # Authentication middleware
│   │   │   └── validation.js     # Input validation
│   │   ├── routes/
│   │   │   ├── auth.js           # Auth endpoints
│   │   │   └── leaderboard.js    # Leaderboard endpoints
│   │   ├── services/
│   │   │   ├── aiService.js      # OpenAI integration
│   │   │   ├── authService.js    # User management
│   │   │   ├── gameEngine.js     # Core game logic
│   │   │   └── leaderboardService.js
│   │   ├── socket/
│   │   │   └── gameSocket.js     # Socket.IO handlers
│   │   ├── utils/
│   │   │   └── logger.js         # Winston logger
│   │   └── index.js              # Entry point
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── _layout.js            # Root layout
│   │   ├── index.js              # Splash screen
│   │   ├── login.js              # Login screen
│   │   ├── home.js               # Home screen
│   │   ├── create-room.js        # Create room
│   │   ├── join-room.js          # Join room
│   │   ├── matchmaking.js        # Public rooms
│   │   ├── lobby.js              # Game lobby
│   │   ├── game.js               # Main game screen
│   │   ├── results.js            # Game results
│   │   ├── leaderboard.js        # Leaderboard
│   │   └── profile.js            # Player profile
│   ├── src/
│   │   ├── components/           # Reusable components
│   │   ├── config/               # App configuration
│   │   ├── services/             # API & Socket services
│   │   ├── stores/               # Zustand state stores
│   │   └── theme/                # Colors, fonts, spacing
│   ├── assets/
│   ├── app.json
│   └── package.json
│
└── README.md                     # This file
```

---

## Security

- All player inputs validated server-side (Joi schemas)
- Content moderation via OpenAI Moderation API
- Supabase JWT authentication for API + Socket.IO
- Socket.IO authentication middleware
- Rate limiting on all HTTP endpoints
- Players cannot vote for their own answers
- Answer length limited (1-100 characters)
- Room codes use safe character set (no ambiguous chars)
- Supabase RLS policies restrict data access
- No sensitive data exposed to clients

---

## Scalability

For 10,000+ concurrent users:

1. **Horizontal scaling**: Deploy multiple backend instances behind a load balancer
2. **Redis adapter**: Add Socket.IO Redis adapter for multi-instance WebSocket support:
   ```bash
   npm install @socket.io/redis-adapter redis
   ```
3. **Connection pooling**: Use Supabase PgBouncer/pooled connection URL for high CCU
4. **Rate limiting**: Per-IP and per-user rate limits
5. **CDN**: Serve static assets via CDN
6. **Monitoring**: Add health checks and metrics (Prometheus/Grafana)

---

## Cost Estimates

| Service | Free Tier | Estimated Cost |
|---------|-----------|----------------|
| Supabase Postgres | Depends on tier | ~$0 (small scale) |
| Supabase Auth | Included | ~$0 |
| OpenAI GPT-4o-mini | N/A | ~$0.15/1M tokens (~$5-10/month for active game) |
| Backend hosting | Varies | $5-20/month (Railway/Render) |
| AdMob revenue | N/A | Varies by impressions |

---

## License

MIT
