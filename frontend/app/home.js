import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import { COLORS, GRADIENTS, SPACING, BORDER_RADIUS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import useGameStore from '../src/stores/gameStore';
import { connectSocket, disconnectSocket } from '../src/services/socketService';
import { ensurePlayGateUnlocked, useMonetizationStore } from '../src/stores/monetizationStore';
import { showRewardedAd } from '../src/services/rewardedAdService';

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const resetGame = useGameStore((s) => s.resetGame);
  const gamesPlayedThisSession = useMonetizationStore((s) => s.gamesPlayedThisSession);
  const resetMonetizationSession = useMonetizationStore((s) => s.resetMonetizationSession);
  const canStartNextGame = gamesPlayedThisSession < 3;

  useEffect(() => {
    connectSocket();
  }, []);

  // Refresh profile and reset game state every time screen gains focus
  useFocusEffect(
    useCallback(() => {
      resetGame();
      refreshProfile();
    }, [])
  );

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        onPress: () => {
          resetMonetizationSession();
          disconnectSocket();
          logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const handleProtectedNavigation = async (path) => {
    const unlocked = await ensurePlayGateUnlocked(showRewardedAd);
    if (!unlocked) {
      Alert.alert('Ad Required', 'Watch a rewarded ad to continue playing this session.');
      return;
    }
    router.push(path);
  };

  const xpForNextLevel = (user?.level || 1) * 5000;
  const xpProgress = ((user?.xp || 0) % 5000) / 5000;

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <Animated.View entering={FadeInUp.duration(600)} style={styles.header}>
            <View>
              <Text style={styles.greeting}>Welcome back,</Text>
              <Text style={styles.username}>{user?.displayName || 'Player'}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/profile')}>
              <Avatar avatarId={user?.avatarId || 1} size={50} />
            </TouchableOpacity>
          </Animated.View>

          {/* Level Card */}
          <Animated.View entering={FadeInDown.duration(600).delay(100)}>
            <GlassCard style={styles.levelCard}>
              <View style={styles.levelRow}>
                <Text style={styles.levelText}>Level {user?.level || 1}</Text>
                <Text style={styles.xpText}>{user?.xp || 0} XP</Text>
              </View>
              <View style={styles.xpBarBg}>
                <View style={[styles.xpBarFill, { width: `${xpProgress * 100}%` }]} />
              </View>
            </GlassCard>
          </Animated.View>

          {/* Quick Stats */}
          <Animated.View entering={FadeInDown.duration(600).delay(200)} style={styles.statsRow}>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statValue}>{user?.totalGamesPlayed || 0}</Text>
              <Text style={styles.statLabel}>Games</Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statValue}>{user?.totalWins || 0}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={[styles.statValue, { color: COLORS.neonGreen }]}>
                {user?.totalScore || 0}
              </Text>
              <Text style={styles.statLabel}>Score</Text>
            </GlassCard>
          </Animated.View>

          {/* Main Actions */}
          <Animated.View entering={FadeInDown.duration(600).delay(300)} style={styles.mainActions}>
            <Text style={styles.sectionTitle}>Play Now</Text>

            <GlassCard style={styles.sessionGateCard}>
              <Text style={styles.sessionGateTitle}>Session Access</Text>
              <Text style={styles.sessionGateText}>
                {canStartNextGame
                  ? `${3 - gamesPlayedThisSession} free game${3 - gamesPlayedThisSession === 1 ? '' : 's'} left before a rewarded ad is required.`
                  : 'Next game is locked. Watch one rewarded ad to reset your session gate.'}
              </Text>
            </GlassCard>

            <GlassButton
              title="Create Room"
              onPress={() => handleProtectedNavigation('/create-room')}
              gradient={GRADIENTS.primary}
              size="lg"
              icon={<Text style={styles.actionIcon}>🎯</Text>}
            />

            <GlassButton
              title="Join Room"
              onPress={() => handleProtectedNavigation('/join-room')}
              gradient={GRADIENTS.accent}
              size="lg"
              icon={<Text style={styles.actionIcon}>🚪</Text>}
            />

            <GlassButton
              title="Quick Match"
              onPress={() => handleProtectedNavigation('/matchmaking')}
              gradient={GRADIENTS.sunset}
              size="lg"
              icon={<Text style={styles.actionIcon}>⚡</Text>}
            />
          </Animated.View>

          {/* Secondary Actions */}
          <Animated.View entering={FadeInDown.duration(600).delay(400)} style={styles.secondaryActions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/leaderboard')}
            >
              <Text style={styles.secondaryIcon}>🏆</Text>
              <Text style={styles.secondaryText}>Leaderboard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/profile')}
            >
              <Text style={styles.secondaryIcon}>👤</Text>
              <Text style={styles.secondaryText}>Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleLogout}
            >
              <Text style={styles.secondaryIcon}>🚪</Text>
              <Text style={styles.secondaryText}>Logout</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  username: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.white,
  },
  levelCard: {
    marginBottom: SPACING.md,
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  levelText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.accent,
  },
  xpText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  xpBarBg: {
    height: 6,
    backgroundColor: COLORS.bgCardLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.white,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  mainActions: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.sm,
  },
  sessionGateCard: {
    marginBottom: SPACING.xs,
  },
  sessionGateTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
    marginBottom: 4,
  },
  sessionGateText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  actionIcon: {
    fontSize: 22,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  secondaryButton: {
    alignItems: 'center',
    padding: SPACING.md,
  },
  secondaryIcon: {
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  secondaryText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
