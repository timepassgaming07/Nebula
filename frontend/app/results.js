import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  FadeInUp,
  BounceIn,
  ZoomIn,
} from 'react-native-reanimated';
import ConfettiCannon from 'react-native-confetti-cannon';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import { COLORS, GRADIENTS, SPACING } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import useGameStore from '../src/stores/gameStore';
import { leaveRoom } from '../src/services/socketService';
import { useMonetizationStore } from '../src/stores/monetizationStore';

export default function ResultsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const { gameResults } = useGameStore();
  const resetGame = useGameStore((s) => s.resetGame);
  const onGameCompleted = useMonetizationStore((s) => s.onGameCompleted);
  const confettiRef = useRef(null);
  const hasCountedSessionGameRef = useRef(false);

  // Refresh user stats after game ends
  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    if (!gameResults || hasCountedSessionGameRef.current) return;
    onGameCompleted();
    hasCountedSessionGameRef.current = true;
  }, [gameResults, onGameCompleted]);


  if (!gameResults) {
    return (
      <ScreenBackground>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <Text style={styles.loadingText}>Loading results...</Text>
          </View>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  const { winner, standings } = gameResults;
  const isWinner = winner?.uid === user?.id;
  const myStanding = standings?.find((s) => s.uid === user?.id);

  const RANK_EMOJIS = ['🥇', '🥈', '🥉'];

  const handlePlayAgain = () => {
    resetGame();
    router.replace('/home');
  };

  const handleGoHome = async () => {
    await leaveRoom();
    resetGame();
    router.replace('/home');
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {/* Hero section */}
          <Animated.View entering={BounceIn.duration(1000)} style={styles.heroSection}>
            <Text style={styles.gameOverText}>Game Over!</Text>
            {winner && (
              <View style={styles.winnerSection}>
                <Animated.View entering={ZoomIn.duration(800).delay(300)}>
                  <Text style={styles.crownEmoji}>👑</Text>
                  <Avatar avatarId={winner.avatarId} size={80} style={styles.winnerAvatar} />
                </Animated.View>
                <Animated.View entering={FadeInUp.duration(600).delay(600)}>
                  <Text style={styles.winnerName}>
                    {isWinner ? 'You Won!' : `${winner.displayName} Wins!`}
                  </Text>
                  <Text style={styles.winnerScore}>{winner.score} pts</Text>
                </Animated.View>
              </View>
            )}
          </Animated.View>

          {/* Your stats */}
          {myStanding && (
            <Animated.View entering={FadeInDown.duration(600).delay(800)}>
              <GlassCard style={styles.myStatsCard}>
                <Text style={styles.myRank}>
                  #{myStanding.rank} {RANK_EMOJIS[myStanding.rank - 1] || ''}
                </Text>
                <Text style={styles.myScore}>{myStanding.totalScore} pts</Text>
              </GlassCard>
            </Animated.View>
          )}

          {/* Standings */}
          <Animated.View entering={FadeInDown.duration(600).delay(1000)} style={styles.standingsSection}>
            <Text style={styles.standingsTitle}>Final Standings</Text>
            <FlatList
              data={standings}
              keyExtractor={(item) => item.uid}
              renderItem={({ item, index }) => {
                const isMe = item.uid === user?.id;
                return (
                  <Animated.View entering={FadeInDown.duration(400).delay(1200 + index * 100)}>
                    <GlassCard style={[styles.standingCard, isMe && styles.standingCardMe]}>
                      <Text style={styles.standingRank}>
                        {RANK_EMOJIS[index] || `#${item.rank}`}
                      </Text>
                      <Avatar avatarId={item.avatarId} size={36} />
                      <Text style={[styles.standingName, isMe && styles.standingNameMe]}>
                        {item.displayName} {isMe ? '(You)' : ''}
                      </Text>
                      <Text style={styles.standingScore}>{item.totalScore}</Text>
                    </GlassCard>
                  </Animated.View>
                );
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.standingsList}
            />
          </Animated.View>

          {/* Buttons */}
          <Animated.View entering={FadeInDown.duration(600).delay(1400)} style={styles.buttonsContainer}>
            <GlassButton
              title="Play Again"
              onPress={handlePlayAgain}
              gradient={GRADIENTS.neon}
              size="lg"
              icon={<Text style={{ fontSize: 20 }}>🎮</Text>}
            />
            <GlassButton
              title="Home"
              onPress={handleGoHome}
              variant="glass"
              icon={<Text style={{ fontSize: 20 }}>🏠</Text>}
            />
          </Animated.View>
        </View>

        {/* Confetti for winner */}
        {isWinner && (
          <ConfettiCannon
            count={200}
            origin={{ x: -10, y: 0 }}
            autoStart={true}
            fadeOut={true}
            ref={confettiRef}
          />
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: SPACING.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: 16 },
  heroSection: { alignItems: 'center', marginBottom: SPACING.lg },
  gameOverText: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.white,
    textShadowColor: COLORS.primary,
    textShadowRadius: 15,
  },
  winnerSection: { alignItems: 'center', marginTop: SPACING.md },
  crownEmoji: { fontSize: 36, textAlign: 'center' },
  winnerAvatar: { marginTop: -8 },
  winnerName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.neonYellow,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  winnerScore: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  myStatsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderColor: COLORS.accent,
    borderWidth: 1,
  },
  myRank: { fontSize: 24, fontWeight: '800', color: COLORS.white },
  myScore: { fontSize: 24, fontWeight: '800', color: COLORS.neonGreen },
  standingsSection: { flex: 1 },
  standingsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  standingsList: { gap: SPACING.sm },
  standingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  standingCardMe: { borderColor: COLORS.accent, borderWidth: 1 },
  standingRank: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
    width: 40,
    textAlign: 'center',
  },
  standingName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    flex: 1,
  },
  standingNameMe: { color: COLORS.accent },
  standingScore: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.neonGreen,
  },
  buttonsContainer: {
    gap: SPACING.md,
    paddingTop: SPACING.md,
  },
});
