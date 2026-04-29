import Constants from 'expo-constants';

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION URL  ← Change this once you deploy to Railway/Render
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTION_BACKEND_URL = 'https://YOUR-RAILWAY-URL.up.railway.app'; // <-- CHANGE THIS
const HAS_CONFIGURED_PRODUCTION_URL = !PRODUCTION_BACKEND_URL.includes('YOUR-RAILWAY-URL');

// ─────────────────────────────────────────────────────────────────────────────
// Tunnel domain helpers
// ─────────────────────────────────────────────────────────────────────────────
function isTunnelHost(host) {
  return (
    host.endsWith('.lhr.life') ||       // localhost.run
    host.endsWith('.loca.lt') ||        // localtunnel
    host.endsWith('.ngrok.io') ||       // ngrok
    host.endsWith('.ngrok-free.app') || // ngrok free
    host.endsWith('.ngrok.app') ||      // ngrok
    host.endsWith('.trycloudflare.com') // cloudflare quick tunnel
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev URL resolution order:
//   1. EXPO_PUBLIC_API_URL  (set by `npm run start:internet` script)
//   2. LAN / localhost      (normal `expo start` on same network)
//   3. Expo tunnel hostUri  (when Expo itself is tunnelled via ngrok)
//   4. Configured production URL (fallback for tunnel mode without explicit URL)
//   5. localhost:3001       (last resort — will only work on the same device)
// ─────────────────────────────────────────────────────────────────────────────
function getDevBackendUrl() {
  // 1. Explicit override — always wins (set by start-internet-dev.js)
  const explicitUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicitUrl) {
    console.log('[ENV] Using explicit backend URL:', explicitUrl);
    return explicitUrl;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    Constants.manifest?.debuggerHost ||
    '';
  const host = hostUri.split(':')[0];

  // 2. LAN IP or localhost — backend runs on the same machine
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isLocalHost || isIpv4) {
    return `http://${host}:3001`;
  }

  // 3. Expo tunnel mode — hostUri is a tunnel hostname (e.g. abc.ngrok.io)
  //    In this case we can't derive the backend URL automatically.
  //    Point users to the correct solution.
  if (isTunnelHost(host)) {
    if (HAS_CONFIGURED_PRODUCTION_URL) {
      console.log('[ENV] Expo tunnel detected — using configured production URL:', PRODUCTION_BACKEND_URL);
      return PRODUCTION_BACKEND_URL;
    }
    console.warn(
      '[ENV] Expo tunnel detected but no backend URL is set!\n' +
      '  → Use `npm run start:internet` for a fully-tunnelled dev session, OR\n' +
      '  → Set EXPO_PUBLIC_API_URL=<your-backend-tunnel-url> before starting Expo, OR\n' +
      '  → Set PRODUCTION_BACKEND_URL in frontend/src/config/env.js'
    );
    return 'http://127.0.0.1:3001'; // will fail for remote devices — expected
  }

  // 4. No tunnel, non-LAN — use production URL if configured
  if (HAS_CONFIGURED_PRODUCTION_URL) {
    return PRODUCTION_BACKEND_URL;
  }

  console.warn(
    '[ENV] Cannot resolve backend URL automatically.\n' +
    '  Run `npm run start:internet` in the frontend folder for cross-internet play.'
  );
  return 'http://127.0.0.1:3001';
}

const backendUrl = __DEV__ ? getDevBackendUrl() : PRODUCTION_BACKEND_URL;
const wsUrl = __DEV__
  ? (process.env.EXPO_PUBLIC_WS_URL?.trim() || backendUrl)
  : PRODUCTION_BACKEND_URL;

const ENV = {
  // Backend server URL — dynamic in dev, PRODUCTION_BACKEND_URL in release builds
  API_URL: backendUrl,
  WS_URL: wsUrl,

  // Supabase
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_PUBLISHABLE_KEY',

  // OAuth client IDs (set for production Supabase social login)
  GOOGLE_EXPO_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || '',
  GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
  GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',

  // AdMob (test IDs — replace with real IDs before publishing)
  ADMOB_BANNER_ID_ANDROID: 'ca-app-pub-3940256099942544/6300978111',
  ADMOB_BANNER_ID_IOS: 'ca-app-pub-3940256099942544/2934735716',
  ADMOB_INTERSTITIAL_ID_ANDROID: 'ca-app-pub-3940256099942544/1033173712',
  ADMOB_INTERSTITIAL_ID_IOS: 'ca-app-pub-3940256099942544/4411468910',
  ADMOB_REWARDED_ID_ANDROID: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID_ANDROID || 'ca-app-pub-3940256099942544/5224354917',
  ADMOB_REWARDED_ID_IOS: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID_IOS || 'ca-app-pub-3940256099942544/1712485313',
};

export default ENV;
