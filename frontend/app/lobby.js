import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Share,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import { COLORS, GRADIENTS, SPACING } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import useGameStore, { GAME_STATES } from '../src/stores/gameStore';
import { startGame, leaveRoom } from '../src/services/socketService';

export default function LobbyScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const {
    roomCode,
    players,
    isHost,
    gameMode,
    genre,
    state,
    totalRounds,
    connectionStatus,
    roomEndedReason,
  } = useGameStore();

  // Navigate to game when round starts (for non-host players)
  useEffect(() => {
    if (state === GAME_STATES.SUBMITTING_ANSWERS) {
      router.push('/game');
    }
  }, [state]);

  useEffect(() => {
    if (roomEndedReason === 'server_restarted') {
      Alert.alert('Room Closed', 'Server restarted and your room no longer exists.', [
        {
          text: 'OK',
          onPress: () => router.replace('/home'),
        },
      ]);
    }
  }, [roomEndedReason]);

  const handleStartGame = async () => {
    try {
      await startGame();
      router.push('/game');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to start game');
    }
  };

  const handleLeave = async () => {
    Alert.alert('Leave Room', 'Are you sure you want to leave?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        onPress: async () => {
          await leaveRoom();
          router.replace('/home');
        },
      },
    ]);
  };

  const handleShareCode = async () => {
    try {
      await Share.share({
        message: `Join my Nebula game! Room code: ${roomCode}`,
      });
    } catch (error) {
      // Ignore
    }
  };

  const GAME_MODE_LABELS = {
    classic: '🎯 Classic',
    rapid: '⚡ Rapid',
    meme: '😂 Meme Mode',
  };

  const GENRE_LABELS = {
    'is-that-a-fact': '🤯 Is That a Fact?',
    'word-up': '📖 Word Up!',
    'movie-bluff': '🎬 Movie Bluff',
    'science-friction': '🔬 Science Friction',
    'history-hysteria': '⏳ History Hysteria',
    'animal-planet': '🦎 Animal Planet',
    'around-the-world': '🌍 Around the World',
    'food-for-thought': '🍕 Food for Thought',
    'tech-talk': '💻 Tech Talk',
    'body-of-knowledge': '🧠 Body of Knowledge',
    'music-mayhem': '🎵 Music Mayhem',
    'sports-nuts': '⚽ Sports Nuts',
  };

  const renderPlayer = ({ item, index }) => (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 100)}>
      <GlassCard style={styles.playerCard}>
        <Avatar avatarId={item.avatarId} size={40} />
        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>{item.displayName}</Text>
          <Text style={styles.playerStatus}>
            {item.isHost ? '👑 Host' : item.isConnected ? '🟢 Ready' : '🔴 Disconnected'}
          </Text>
        </View>
        {item.uid === user?.id && (
          <Text style={styles.youBadge}>You</Text>
        )}
      </GlassCard>
    </Animated.View>
  );

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {/* Header */}
          <Animated.View entering={FadeInUp.duration(600)} style={styles.header}>
            <TouchableOpacity onPress={handleLeave}>
              <Text style={styles.backText}>← Leave</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.modeLabel}>{GAME_MODE_LABELS[gameMode] || gameMode}</Text>
              {genre && <Text style={styles.genreLabel}>{GENRE_LABELS[genre] || '🎲 Random Mix'}</Text>}
              <Text style={styles.roundsLabel}>{totalRounds} Rounds</Text>
            </View>
          </Animated.View>

          {/* Room Code */}
          <Animated.View entering={FadeInDown.duration(600).delay(100)}>
            <GlassCard style={styles.codeCard}>
              <Text style={styles.codeLabel}>Room Code</Text>
              <Text style={styles.codeText}>{roomCode}</Text>
              <TouchableOpacity onPress={handleShareCode} style={styles.shareButton}>
                <Text style={styles.shareText}>📤 Share Code</Text>
              </TouchableOpacity>
            </GlassCard>
          </Animated.View>

          {connectionStatus !== 'connected' && (
            <View style={styles.connectionBanner}>
              <Text style={styles.connectionText}>
                {connectionStatus === 'reconnecting'
                  ? 'Reconnecting to game server...'
                  : 'Connection unstable. Waiting for server...'}
              </Text>
            </View>
          )}

          {/* Players */}
          <Animated.View entering={FadeInDown.duration(600).delay(200)} style={styles.playersSection}>
            <Text style={styles.sectionTitle}>
              Players ({players.length}/10)
            </Text>
            <FlatList
              data={players}
              keyExtractor={(item) => item.uid}
              renderItem={renderPlayer}
              contentContainerStyle={styles.playersList}
              showsVerticalScrollIndicator={false}
            />
          </Animated.View>

          {/* Waiting / Start */}
          <Animated.View entering={FadeInDown.duration(600).delay(300)} style={styles.footer}>
            {isHost ? (
              <GlassButton
                title={
                  connectionStatus !== 'connected'
                    ? 'Waiting for connection...'
                    : players.length < 2
                    ? 'Waiting for players...'
                    : 'Start Game'
                }
                onPress={handleStartGame}
                gradient={GRADIENTS.neon}
                size="lg"
                disabled={players.length < 2 || connectionStatus !== 'connected'}
                icon={<Text style={{ fontSize: 20 }}>🎮</Text>}
              />
            ) : (
              <GlassCard style={styles.waitingCard}>
                <Text style={styles.waitingText}>⏳ Waiting for host to start...</Text>
              </GlassCard>
            )}
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: SPACING.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  backText: { color: COLORS.textSecondary, fontSize: 16 },
  modeLabel: { fontSize: 16, color: COLORS.accent, fontWeight: '600' },
  genreLabel: { fontSize: 13, color: COLORS.neonPink || COLORS.primary, fontWeight: '600', marginTop: 2 },
  roundsLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  codeCard: { alignItems: 'center', padding: SPACING.lg, marginBottom: SPACING.lg },
  codeLabel: { fontSize: 14, color: COLORS.textSecondary },
  codeText: {
    fontSize: 42,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 8,
    marginVertical: SPACING.sm,
    textShadowColor: COLORS.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  shareButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.bgGlassLight,
    borderRadius: 20,
  },
  shareText: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  connectionBanner: {
    marginBottom: SPACING.md,
    borderRadius: 10,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: 'rgba(244,114,182,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244,114,182,0.35)',
  },
  connectionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  playersSection: { flex: 1 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  playersList: { gap: SPACING.sm },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 16, fontWeight: '600', color: COLORS.white },
  playerStatus: { fontSize: 12, color: COLORS.textSecondary },
  youBadge: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '700',
    backgroundColor: COLORS.bgGlassLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  footer: { paddingTop: SPACING.md },
  waitingCard: { alignItems: 'center' },
  waitingText: { fontSize: 16, color: COLORS.textSecondary, fontWeight: '500' },
});
