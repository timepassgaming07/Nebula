import ENV from '../config/env';
import useAuthStore from '../stores/authStore';

const API_BASE = ENV.API_URL + '/api';

// Some tunnel services show an interstitial "click to continue" page for
// non-browser clients. Sending these headers bypasses those pages.
function buildTunnelHeaders(url) {
  const isTunnel =
    url.includes('.loca.lt') ||        // localtunnel
    url.includes('.lhr.life') ||       // localhost.run
    url.includes('.ngrok.io') ||       // ngrok
    url.includes('.ngrok-free.app') || // ngrok free tier
    url.includes('.ngrok.app') ||      // ngrok
    url.includes('.trycloudflare.com'); // cloudflare quick tunnel
  if (!isTunnel) return {};
  return {
    'bypass-tunnel-reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'NebulaApp/1.0',
  };
}

const TUNNEL_HEADERS = buildTunnelHeaders(ENV.API_URL);
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

async function fetchWithAuth(url, options = {}, retries = 0) {
  const token = useAuthStore.getState().token;
  const headers = {
    'Content-Type': 'application/json',
    ...TUNNEL_HEADERS,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Parse response
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Invalid response from server (${response.status})`);
    }

    if (!response.ok) {
      // Don't retry auth errors
      if (response.status === 401 || response.status === 403) {
        throw new Error(data.error || 'Unauthorized');
      }
      // Retry server errors
      if (response.status >= 500 && retries < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (retries + 1)));
        return fetchWithAuth(url, options, retries + 1);
      }
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    // Retry on network errors
    if (error.name === 'AbortError') {
      if (retries < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (retries + 1)));
        return fetchWithAuth(url, options, retries + 1);
      }
      throw new Error('Request timed out');
    }

    if (error.message === 'Network request failed' && retries < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (retries + 1)));
      return fetchWithAuth(url, options, retries + 1);
    }

    throw error;
  }
}

export async function getProfile() {
  return fetchWithAuth(`${API_BASE}/auth/me`);
}

export async function updateProfile(updates) {
  return fetchWithAuth(`${API_BASE}/auth/me`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function getGlobalLeaderboard(limit = 50) {
  return fetchWithAuth(`${API_BASE}/leaderboard/global?limit=${limit}`);
}
