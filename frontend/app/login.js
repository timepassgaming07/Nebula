import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import { COLORS, GRADIENTS, SPACING } from '../src/theme';
import { getProfile } from '../src/services/apiService';
import useAuthStore from '../src/stores/authStore';
import { connectSocket } from '../src/services/socketService';
import { getSupabaseClient } from '../src/config/supabaseClient';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = useState(null);

  const finalizeSupabaseLogin = async (session) => {
    if (!session?.access_token) {
      throw new Error('Missing Supabase session token');
    }

    setSession(session, null);

    const profile = await getProfile();
    if (profile?.user) {
      setUser(profile.user, session.access_token);
    }

    connectSocket();
    router.replace('/home');
  };

  const handleGuestLogin = async () => {
    setLoading('guest');
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      await finalizeSupabaseLogin(data?.session);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to login as guest');
    } finally {
      setLoading(null);
    }
  };

  const handleOAuthLogin = async (provider) => {
    setLoading(provider);
    try {
      const supabase = getSupabaseClient();
      const redirectTo = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') {
        return;
      }

      const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
      if (exchangeError) throw exchangeError;

      await finalizeSupabaseLogin(exchangeData?.session);
    } catch (error) {
      Alert.alert('Error', error.message || 'Sign-in failed');
    } finally {
      setLoading(null);
    }
  };

  const handleAppleLogin = async () => {
    setLoading('apple');
    try {
      if (Platform.OS !== 'ios') {
        Alert.alert('Apple Sign-In', 'Apple Sign-In is only available on iOS devices.');
        return;
      }

      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('Apple Sign-In', 'Apple Sign-In is not available on this device.');
        return;
      }

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!appleCredential.identityToken) {
        throw new Error('Apple Sign-In did not provide an identity token.');
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: appleCredential.identityToken,
        nonce: appleCredential.nonce || undefined,
      });

      if (error) throw error;

      await finalizeSupabaseLogin(data?.session);
    } catch (error) {
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In', 'Sign-in was cancelled.');
      } else {
        Alert.alert('Error', error.message || 'Apple sign-in failed');
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Animated.View entering={FadeInUp.duration(800).delay(200)}>
          <Text style={styles.title}>NEBULA</Text>
          <Text style={styles.subtitle}>The Ultimate Bluffing Game</Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(800).delay(400)}
          style={styles.buttonsContainer}
        >
          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>Get Started</Text>
            <Text style={styles.cardSubtitle}>Choose how to sign in</Text>

            <View style={styles.buttons}>
              <GlassButton
                title="Play as Guest"
                onPress={handleGuestLogin}
                gradient={GRADIENTS.neon}
                loading={loading === 'guest'}
                disabled={!!loading}
                icon={<Text style={styles.buttonIcon}>🎮</Text>}
              />

              <GlassButton
                title="Sign in with Google"
                onPress={() => handleOAuthLogin('google')}
                variant="glass"
                loading={loading === 'google'}
                disabled={!!loading}
                icon={<Text style={styles.buttonIcon}>🔵</Text>}
              />

              {Platform.OS === 'ios' && (
                <GlassButton
                  title="Sign in with Apple"
                  onPress={handleAppleLogin}
                  variant="glass"
                  loading={loading === 'apple'}
                  disabled={!!loading}
                  icon={<Text style={styles.buttonIcon}>🍎</Text>}
                />
              )}
            </View>
          </GlassCard>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.duration(800).delay(600)}
          style={styles.footer}
        >
          Free to play · No ads during gameplay
        </Animated.Text>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: 56,
    fontWeight: '900',
    color: COLORS.white,
    textAlign: 'center',
    letterSpacing: 8,
    textShadowColor: COLORS.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
    letterSpacing: 2,
  },
  buttonsContainer: {
    width: '100%',
    marginTop: SPACING.xxl,
  },
  card: {
    padding: SPACING.lg,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.white,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  buttons: {
    gap: SPACING.md,
  },
  buttonIcon: {
    fontSize: 20,
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: SPACING.xl,
    textAlign: 'center',
  },
});
