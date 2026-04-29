import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ENV from '../config/env';
import { getSupabaseClient } from '../config/supabaseClient';

function buildTunnelHeaders(url) {
  const isTunnel =
    url.includes('.loca.lt') ||
    url.includes('.lhr.life') ||
    url.includes('.ngrok.io') ||
    url.includes('.ngrok-free.app') ||
    url.includes('.ngrok.app') ||
    url.includes('.trycloudflare.com');
  if (!isTunnel) return {};
  return {
    'bypass-tunnel-reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'NebulaApp/1.0',
  };
}

const TUNNEL_HEADERS = buildTunnelHeaders(ENV.API_URL);

let authListener = null;

const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  initAuthListener: () => {
    if (authListener) return;
    const supabase = getSupabaseClient();
    authListener = supabase.auth.onAuthStateChange((_event, session) => {
      const accessToken = session?.access_token || null;
      set((state) => ({
        token: accessToken,
        isAuthenticated: !!accessToken,
        user: state.user,
      }));
    }).data.subscription;
  },

  setSession: (session, user) => {
    const accessToken = session?.access_token || null;
    set({ user: user || null, token: accessToken, isAuthenticated: !!accessToken, isLoading: false });
    if (accessToken) AsyncStorage.setItem('auth_token', accessToken);
    if (user) AsyncStorage.setItem('user_data', JSON.stringify(user));
  },

  refreshProfile: async () => {
    try {
      const { token } = get();
      if (!token) return;
      const res = await fetch(`${ENV.API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...TUNNEL_HEADERS,
        },
      });
      const data = await res.json();
      if (data?.user) {
        const updated = { ...get().user, ...data.user };
        set({ user: updated });
        AsyncStorage.setItem('user_data', JSON.stringify(updated));
      } else if (res.status === 401 || res.status === 403) {
        const supabase = getSupabaseClient();
        await supabase.auth.signOut();
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        AsyncStorage.removeItem('auth_token');
        AsyncStorage.removeItem('user_data');
      }
    } catch (e) {
      console.log('Profile refresh failed:', e);
    }
  },

  setUser: (user, token) => {
    set({ user, token, isAuthenticated: !!token, isLoading: false });
    if (token) AsyncStorage.setItem('auth_token', token);
    if (user) AsyncStorage.setItem('user_data', JSON.stringify(user));
  },

  updateUser: (updates) => {
    const current = get().user;
    if (current) {
      const updated = { ...current, ...updates };
      set({ user: updated });
      AsyncStorage.setItem('user_data', JSON.stringify(updated));
    }
  },

  logout: async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    set({ user: null, token: null, isAuthenticated: false });
    AsyncStorage.removeItem('auth_token');
    AsyncStorage.removeItem('user_data');
  },

  restoreSession: async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const session = data?.session || null;
      if (session?.access_token) {
        const userData = await AsyncStorage.getItem('user_data');
        const user = userData ? JSON.parse(userData) : null;
        set({ user, token: session.access_token, isAuthenticated: true, isLoading: false });
        return true;
      }
    } catch (e) {
      console.log('Session restore failed:', e);
    }
    set({ isLoading: false });
    return false;
  },
}));

export default useAuthStore;
