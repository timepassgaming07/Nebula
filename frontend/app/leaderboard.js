import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import { COLORS, SPACING } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import { getGlobalLeaderboard } from '../src/services/apiService';
import { TouchableOpacity } from 'react-native';

export default function LeaderboardScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const data = await getGlobalLeaderboard(50);
      setLeaderboard(data.leaderboard || []);
    } catch (error) {
      console.log('Failed to fetch leaderboard:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const RANK_EMOJIS = ['🥇', '🥈', '🥉'];

  const renderItem = ({ item, index }) => {
    const isMe = item.uid === user?.id;
    return (
      <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
        <GlassCard style={[styles.leaderCard, isMe && styles.leaderCardMe]}>
          <Text style={styles.rank}>
            {RANK_EMOJIS[index] || `#${item.rank}`}
          </Text>
          <Avatar avatarId={item.avatarId} size={40} />
          <View style={styles.playerInfo}>
            <Text style={[styles.playerName, isMe && styles.playerNameMe]}>
              {item.displayName} {isMe ? '(You)' : ''}
            </Text>
            <Text style={styles.playerLevel}>Level {item.level}</Text>
          </View>
          <View style={styles.scoreColumn}>
            <Text style={styles.scoreValue}>{item.totalScore}</Text>
            <Text style={styles.scoreLabel}>pts</Text>
          </View>
        </GlassCard>
      </Animated.View>
    );
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>🏆 Leaderboard</Text>
            <View style={{ width: 50 }} />
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : leaderboard.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>🏆</Text>
              <Text style={styles.emptyText}>No entries yet</Text>
              <Text style={styles.emptySubtext}>Play games to appear on the leaderboard!</Text>
            </View>
          ) : (
            <FlatList
              data={leaderboard}
              keyExtractor={(item) => item.uid}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            />
          )}
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
  title: { fontSize: 20, fontWeight: '800', color: COLORS.white },
  list: { gap: SPACING.sm },
  leaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  leaderCardMe: { borderColor: COLORS.accent, borderWidth: 1 },
  rank: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
    width: 40,
    textAlign: 'center',
  },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '600', color: COLORS.white },
  playerNameMe: { color: COLORS.accent },
  playerLevel: { fontSize: 12, color: COLORS.textSecondary },
  scoreColumn: { alignItems: 'flex-end' },
  scoreValue: { fontSize: 18, fontWeight: '800', color: COLORS.neonGreen },
  scoreLabel: { fontSize: 10, color: COLORS.textMuted },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyEmoji: { fontSize: 56, marginBottom: SPACING.md },
  emptyText: { fontSize: 18, color: COLORS.white, fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: COLORS.textSecondary, marginTop: SPACING.xs },
});
