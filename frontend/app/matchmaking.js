import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import { COLORS, GRADIENTS, SPACING } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import { getPublicRooms, joinRoom } from '../src/services/socketService';
import { TouchableOpacity } from 'react-native';

export default function MatchmakingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(null);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const publicRooms = await getPublicRooms();
      setRooms(publicRooms);
    } catch (error) {
      console.log('Failed to fetch rooms:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoin = async (roomCode) => {
    setJoining(roomCode);
    try {
      await joinRoom(roomCode, user?.displayName || 'Player', user?.avatarId || 1);
      router.push('/lobby');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to join room');
    } finally {
      setJoining(null);
    }
  };

  const GAME_MODE_EMOJIS = { classic: '🎯', rapid: '⚡', meme: '😂' };

  const renderRoom = ({ item, index }) => (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 100)}>
      <GlassCard style={styles.roomCard}>
        <View style={styles.roomInfo}>
          <Text style={styles.roomEmoji}>
            {GAME_MODE_EMOJIS[item.gameMode] || '🎮'}
          </Text>
          <View style={styles.roomDetails}>
            <Text style={styles.roomCode}>{item.roomCode}</Text>
            <Text style={styles.roomHost}>Host: {item.hostName}</Text>
            <Text style={styles.roomPlayers}>
              {item.playerCount}/{item.maxPlayers} players · {item.gameMode}
            </Text>
          </View>
        </View>
        <GlassButton
          title="Join"
          onPress={() => handleJoin(item.roomCode)}
          size="sm"
          gradient={GRADIENTS.accent}
          loading={joining === item.roomCode}
        />
      </GlassCard>
    </Animated.View>
  );

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Quick Match</Text>
          <Text style={styles.subtitle}>Join a public room</Text>

          {rooms.length === 0 && !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyText}>No public rooms available</Text>
              <Text style={styles.emptySubtext}>Create your own room or try again later</Text>
              <GlassButton
                title="Create Room"
                onPress={() => router.push('/create-room')}
                gradient={GRADIENTS.primary}
                style={{ marginTop: SPACING.lg }}
              />
            </View>
          ) : (
            <FlatList
              data={rooms}
              keyExtractor={(item) => item.roomCode}
              renderItem={renderRoom}
              refreshControl={
                <RefreshControl
                  refreshing={loading}
                  onRefresh={fetchRooms}
                  tintColor={COLORS.primary}
                />
              }
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
  backButton: { marginBottom: SPACING.md },
  backText: { color: COLORS.textSecondary, fontSize: 16 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  list: { gap: SPACING.sm },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomInfo: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  roomEmoji: { fontSize: 32 },
  roomDetails: { flex: 1 },
  roomCode: { fontSize: 18, fontWeight: '700', color: COLORS.white, letterSpacing: 2 },
  roomHost: { fontSize: 13, color: COLORS.textSecondary },
  roomPlayers: { fontSize: 12, color: COLORS.textMuted },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyEmoji: { fontSize: 56, marginBottom: SPACING.md },
  emptyText: { fontSize: 18, color: COLORS.textPrimary, fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: COLORS.textSecondary, marginTop: SPACING.xs },
});
