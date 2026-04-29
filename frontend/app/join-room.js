import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import { COLORS, GRADIENTS, SPACING, BORDER_RADIUS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import { joinRoom } from '../src/services/socketService';
import { updateProfile } from '../src/services/apiService';
import { TouchableOpacity } from 'react-native';

export default function JoinRoomScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 4) {
      Alert.alert('Invalid Code', 'Please enter a valid room code');
      return;
    }

    const name = displayName.trim();
    if (name.length < 2 || name.length > 20) {
      Alert.alert('Invalid Name', 'Name must be 2-20 characters');
      return;
    }

    setLoading(true);
    try {
      // Persist name so others see it consistently across screens/sessions.
      try {
        const res = await updateProfile({ displayName: name });
        if (res?.user) updateUser(res.user);
        else updateUser({ displayName: name });
      } catch {
        // If profile update fails (offline), still proceed with local name.
        updateUser({ displayName: name });
      }

      await joinRoom(code, name || 'Player', user?.avatarId || 1);
      router.push('/lobby');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Animated.View entering={FadeInDown.duration(600)}>
            <Text style={styles.title}>Join Room</Text>
            <Text style={styles.subtitle}>Enter the room code to join a game</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(600).delay(200)}>
            <GlassCard style={styles.inputCard}>
              <Text style={styles.inputLabel}>Your Name</Text>
              <TextInput
                style={styles.nameInput}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Player"
                placeholderTextColor={COLORS.textMuted}
                maxLength={20}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="done"
              />

              <View style={{ height: SPACING.md }} />

              <Text style={styles.inputLabel}>Room Code</Text>
              <TextInput
                style={styles.input}
                value={roomCode}
                onChangeText={setRoomCode}
                placeholder="ABCDEF"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                maxLength={6}
                autoCorrect={false}
              />
            </GlassCard>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(600).delay(300)} style={styles.buttonContainer}>
            <GlassButton
              title="Join Game"
              onPress={handleJoin}
              gradient={GRADIENTS.accent}
              size="lg"
              loading={loading}
              disabled={roomCode.trim().length < 4 || displayName.trim().length < 2}
              icon={<Text style={{ fontSize: 20 }}>🚀</Text>}
            />
          </Animated.View>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    padding: SPACING.lg,
  },
  backButton: {
    marginBottom: SPACING.md,
  },
  backText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },
  inputCard: {
    padding: SPACING.lg,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.bgCardLight,
  },
  input: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.white,
    textAlign: 'center',
    letterSpacing: 8,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.bgCardLight,
  },
  buttonContainer: {
    marginTop: SPACING.xl,
  },
});
