import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import { COLORS, GRADIENTS, SPACING, BORDER_RADIUS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import { updateProfile } from '../src/services/apiService';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatarId || 1);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 20) {
      Alert.alert('Error', 'Name must be 2-20 characters');
      return;
    }

    setSaving(true);
    try {
      const data = await updateProfile({ displayName: name, avatarId: selectedAvatar });
      if (data?.user) {
        updateUser(data.user);
      } else {
        // Fallback: update locally even if server didn't return user
        updateUser({ displayName: name, avatarId: selectedAvatar });
      }
      Alert.alert('Success', 'Profile updated!');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const xpForNextLevel = (user?.level || 1) * 5000;
  const xpProgress = ((user?.xp || 0) % 5000) / 5000;

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Animated.View entering={FadeInDown.duration(600)} style={styles.avatarSection}>
            <Avatar avatarId={selectedAvatar} size={100} />
            <Text style={styles.profileName}>{user?.displayName}</Text>
            <Text style={styles.profileProvider}>
              {user?.provider === 'guest' ? '🎮 Guest' : `📧 ${user?.email || ''}`}
            </Text>
          </Animated.View>

          {/* Level & XP */}
          <Animated.View entering={FadeInDown.duration(600).delay(100)}>
            <GlassCard style={styles.levelCard}>
              <View style={styles.levelRow}>
                <Text style={styles.levelText}>Level {user?.level || 1}</Text>
                <Text style={styles.xpText}>{user?.xp || 0} / {xpForNextLevel} XP</Text>
              </View>
              <View style={styles.xpBarBg}>
                <View style={[styles.xpBarFill, { width: `${xpProgress * 100}%` }]} />
              </View>
            </GlassCard>
          </Animated.View>

          {/* Stats */}
          <Animated.View entering={FadeInDown.duration(600).delay(200)}>
            <Text style={styles.sectionTitle}>Statistics</Text>
            <View style={styles.statsGrid}>
              <GlassCard style={styles.statCard}>
                <Text style={styles.statValue}>{user?.totalGamesPlayed || 0}</Text>
                <Text style={styles.statLabel}>Games Played</Text>
              </GlassCard>
              <GlassCard style={styles.statCard}>
                <Text style={styles.statValue}>{user?.totalWins || 0}</Text>
                <Text style={styles.statLabel}>Wins</Text>
              </GlassCard>
              <GlassCard style={styles.statCard}>
                <Text style={[styles.statValue, { color: COLORS.neonGreen }]}>
                  {user?.totalScore || 0}
                </Text>
                <Text style={styles.statLabel}>Total Score</Text>
              </GlassCard>
              <GlassCard style={styles.statCard}>
                <Text style={[styles.statValue, { color: COLORS.neonPink }]}>
                  {user?.totalGamesPlayed
                    ? Math.round((user.totalWins / user.totalGamesPlayed) * 100)
                    : 0}%
                </Text>
                <Text style={styles.statLabel}>Win Rate</Text>
              </GlassCard>
            </View>
          </Animated.View>

          {/* Edit Profile */}
          <Animated.View entering={FadeInDown.duration(600).delay(300)}>
            <Text style={styles.sectionTitle}>Edit Profile</Text>
            <GlassCard>
              <Text style={styles.inputLabel}>Display Name</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={20}
                placeholder="Enter name"
                placeholderTextColor={COLORS.textMuted}
              />

              <Text style={[styles.inputLabel, { marginTop: SPACING.md }]}>Avatar</Text>
              <View style={styles.avatarGrid}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((id) => (
                  <TouchableOpacity
                    key={id}
                    onPress={() => setSelectedAvatar(id)}
                    style={[
                      styles.avatarOption,
                      selectedAvatar === id && styles.avatarOptionSelected,
                    ]}
                  >
                    <Avatar avatarId={id} size={40} />
                  </TouchableOpacity>
                ))}
              </View>

              <GlassButton
                title="Save Changes"
                onPress={handleSave}
                gradient={GRADIENTS.primary}
                loading={saving}
                style={{ marginTop: SPACING.lg }}
              />
            </GlassCard>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  backButton: { marginBottom: SPACING.md },
  backText: { color: COLORS.textSecondary, fontSize: 16 },
  avatarSection: { alignItems: 'center', marginBottom: SPACING.xl },
  profileName: { fontSize: 24, fontWeight: '800', color: COLORS.white, marginTop: SPACING.md },
  profileProvider: { fontSize: 14, color: COLORS.textSecondary },
  levelCard: { marginBottom: SPACING.lg },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm },
  levelText: { fontSize: 16, fontWeight: '700', color: COLORS.accent },
  xpText: { fontSize: 14, color: COLORS.textSecondary },
  xpBarBg: { height: 6, backgroundColor: COLORS.bgCardLight, borderRadius: 3, overflow: 'hidden' },
  xpBarFill: { height: '100%', backgroundColor: COLORS.accent, borderRadius: 3 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  statCard: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  statValue: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  inputLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  input: {
    backgroundColor: COLORS.bgCardLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'center',
  },
  avatarOption: {
    padding: 4,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarOptionSelected: {
    borderColor: COLORS.primary,
  },
});
