import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Dimensions, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import { COLORS, GRADIENTS, SPACING, BORDER_RADIUS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import { createRoom } from '../src/services/socketService';
import { updateProfile } from '../src/services/apiService';
import { TouchableOpacity } from 'react-native';
import { ensureCategoryUnlockedForSession, useMonetizationStore } from '../src/stores/monetizationStore';
import { showRewardedAd } from '../src/services/rewardedAdService';

const GAME_MODES = [
  {
    id: 'classic',
    name: 'Classic',
    emoji: '🎯',
    description: 'Bluff with fake answers to trivia questions',
  },
  {
    id: 'rapid',
    name: 'Rapid',
    emoji: '⚡',
    description: 'Quick rounds with shorter timers',
  },
  {
    id: 'meme',
    name: 'Meme Mode',
    emoji: '😂',
    description: 'AI-generated funny prompts',
  },
];

const GENRE_DECKS = [
  { id: null, name: 'Random Mix', emoji: '🎲', description: 'Questions from all genres', color: '#7C3AED', isPremium: false },
  { id: 'is-that-a-fact', name: 'Is That a Fact?', emoji: '🤯', description: 'Mind-blowing true facts', color: '#EC4899', isPremium: false },
  { id: 'word-up', name: 'Word Up!', emoji: '📖', description: 'Bizarre real word definitions', color: '#8B5CF6', isPremium: false },
  { id: 'movie-bluff', name: 'Movie Bluff', emoji: '🎬', description: 'Insanely obscure film trivia', color: '#F59E0B', isPremium: true },
  { id: 'search-history', name: 'Search History', emoji: '🕵️', description: 'Chaotic internet and meme rabbit holes', color: '#14B8A6', isPremium: false },
  { id: 'adulting-101', name: 'Adulting 101', emoji: '🧾', description: 'Funny real-world life-skill chaos', color: '#F43F5E', isPremium: false },
  { id: 'science-friction', name: 'Science Friction', emoji: '🔬', description: 'Wild science facts', color: '#10B981', isPremium: false },
  { id: 'history-hysteria', name: 'History Hysteria', emoji: '⏳', description: 'Absurd true history', color: '#EF4444', isPremium: false },
  { id: 'animal-planet', name: 'Animal Planet', emoji: '🦎', description: 'Insane animal facts', color: '#06B6D4', isPremium: false },
  { id: 'around-the-world', name: 'Around the World', emoji: '🌍', description: 'Bizarre geography & culture', color: '#3B82F6', isPremium: false },
  { id: 'food-for-thought', name: 'Food for Thought', emoji: '🍕', description: 'Weird food origins', color: '#F97316', isPremium: false },
  { id: 'tech-talk', name: 'Tech Talk', emoji: '💻', description: 'Mind-blowing tech history', color: '#6366F1', isPremium: true },
  { id: 'body-of-knowledge', name: 'Body of Knowledge', emoji: '🧠', description: 'Bizarre human body facts', color: '#EC4899', isPremium: false },
  { id: 'music-mayhem', name: 'Music Mayhem', emoji: '🎵', description: 'Deep-cut music trivia', color: '#A855F7', isPremium: true },
  { id: 'sports-nuts', name: 'Sports Nuts', emoji: '⚽', description: 'Obscure sports trivia', color: '#22C55E', isPremium: true },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DECK_CARD_WIDTH = (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2;

export default function CreateRoomScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const premiumUnlockedThisSession = useMonetizationStore((s) => s.premiumUnlockedThisSession);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [selectedMode, setSelectedMode] = useState('classic');
  const [selectedGenre, setSelectedGenre] = useState(null); // null = Random Mix
  const [isPublic, setIsPublic] = useState(false);
  const [maxRounds, setMaxRounds] = useState(5);
  const [loading, setLoading] = useState(false);

  const handleSelectGenre = async (genre) => {
    if (!genre.isPremium) {
      setSelectedGenre(genre.id);
      return;
    }

    const unlocked = await ensureCategoryUnlockedForSession(
      { id: genre.id, is_premium: true },
      showRewardedAd
    );

    if (!unlocked) {
      Alert.alert('Premium Deck', 'Watch a rewarded ad to unlock this premium deck for this session.');
      return;
    }

    setSelectedGenre(genre.id);
  };

  const handleCreate = async () => {
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
        updateUser({ displayName: name });
      }

      const result = await createRoom({
        displayName: name || 'Player',
        avatarId: user?.avatarId || 1,
        gameMode: selectedMode,
        genre: selectedGenre,
        isPublic,
        maxRounds,
      });
      router.push('/lobby');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Animated.View entering={FadeInDown.duration(600)}>
            <Text style={styles.title}>Create Room</Text>
          </Animated.View>

          {/* Your Name */}
          <Animated.View entering={FadeInDown.duration(600).delay(50)}>
            <Text style={styles.sectionTitle}>Your Name</Text>
            <GlassCard style={{ padding: SPACING.lg, marginBottom: SPACING.lg }}>
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
            </GlassCard>
          </Animated.View>

          {/* Genre / Deck Selection */}
          <Animated.View entering={FadeInDown.duration(600).delay(100)}>
            <Text style={styles.sectionTitle}>Choose Your Deck</Text>
            <Text style={styles.sectionSubtitle}>Pick a genre — every question will be insanely tough!</Text>
            <View style={styles.genreGrid}>
              {GENRE_DECKS.map((genre) => {
                const isSelected = selectedGenre === genre.id;
                const isLocked = genre.isPremium && !premiumUnlockedThisSession[genre.id];
                return (
                  <TouchableOpacity
                    key={genre.id || 'random'}
                    onPress={() => handleSelectGenre(genre)}
                    activeOpacity={0.7}
                    style={[
                      styles.genreCard,
                      isSelected && { borderColor: genre.color, borderWidth: 2.5, shadowColor: genre.color, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
                    ]}
                  >
                    <Text style={styles.genreEmoji}>{genre.emoji}</Text>
                    <Text style={styles.genreName} numberOfLines={1}>{genre.name}</Text>
                    <Text style={styles.genreDesc} numberOfLines={2}>{genre.description}</Text>
                    {genre.isPremium && (
                      <View style={styles.premiumBadge}>
                        <Text style={styles.premiumBadgeText}>PRO</Text>
                      </View>
                    )}
                    {isLocked && (
                      <View style={styles.lockedOverlay}>
                        <Text style={styles.lockedIcon}>🔒</Text>
                        <Text style={styles.lockedText}>Watch ad</Text>
                      </View>
                    )}
                    {isSelected && (
                      <View style={[styles.selectedBadge, { backgroundColor: genre.color }]}>
                        <Text style={styles.selectedBadgeText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          {/* Game Mode Selection */}
          <Animated.View entering={FadeInDown.duration(600).delay(200)}>
            <Text style={styles.sectionTitle}>Game Mode</Text>
            <View style={styles.modesContainer}>
              {GAME_MODES.map((mode) => (
                <TouchableOpacity
                  key={mode.id}
                  onPress={() => setSelectedMode(mode.id)}
                  activeOpacity={0.7}
                >
                  <GlassCard
                    style={[
                      styles.modeCard,
                      selectedMode === mode.id && styles.modeCardSelected,
                    ]}
                  >
                    <Text style={styles.modeEmoji}>{mode.emoji}</Text>
                    <View style={styles.modeTextContainer}>
                      <Text style={styles.modeName}>{mode.name}</Text>
                      <Text style={styles.modeDesc}>{mode.description}</Text>
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* Options */}
          <Animated.View entering={FadeInDown.duration(600).delay(300)}>
            <Text style={styles.sectionTitle}>Options</Text>
            <GlassCard>
              <View style={styles.optionRow}>
                <Text style={styles.optionLabel}>Rounds</Text>
                <View style={styles.roundSelector}>
                  {[3, 5, 7, 10].map((num) => (
                    <TouchableOpacity
                      key={num}
                      onPress={() => setMaxRounds(num)}
                      style={[
                        styles.roundButton,
                        maxRounds === num && styles.roundButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roundButtonText,
                          maxRounds === num && styles.roundButtonTextActive,
                        ]}
                      >
                        {num}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.optionRow}>
                <Text style={styles.optionLabel}>Public Room</Text>
                <TouchableOpacity
                  onPress={() => setIsPublic(!isPublic)}
                  style={[styles.toggle, isPublic && styles.toggleActive]}
                >
                  <View style={[styles.toggleDot, isPublic && styles.toggleDotActive]} />
                </TouchableOpacity>
              </View>
            </GlassCard>
          </Animated.View>

          <View style={{ height: SPACING.lg }} />

          <Animated.View entering={FadeInDown.duration(600).delay(400)}>
            <GlassButton
              title="Create Room"
              onPress={handleCreate}
              gradient={GRADIENTS.neon}
              size="lg"
              loading={loading}
              disabled={displayName.trim().length < 2}
              icon={<Text style={{ fontSize: 20 }}>🚀</Text>}
            />
          </Animated.View>

          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: {
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
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  nameInput: {
    backgroundColor: COLORS.bgCardLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '700',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  genreCard: {
    width: DECK_CARD_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    position: 'relative',
    minHeight: 100,
  },
  genreEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  genreName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 2,
  },
  genreDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 15,
  },
  selectedBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
  },
  premiumBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 195, 0, 0.9)',
  },
  premiumBadgeText: {
    color: '#231200',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 10, 25, 0.75)',
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  lockedIcon: {
    fontSize: 18,
  },
  lockedText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  modesContainer: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
    marginTop: SPACING.sm,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  modeCardSelected: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  modeEmoji: {
    fontSize: 28,
  },
  modeTextContainer: {
    flex: 1,
  },
  modeName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  modeDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  optionLabel: {
    fontSize: 16,
    color: COLORS.white,
  },
  roundSelector: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgCardLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonActive: {
    backgroundColor: COLORS.primary,
  },
  roundButtonText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  roundButtonTextActive: {
    color: COLORS.white,
  },
  toggle: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.bgCardLight,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleActive: {
    backgroundColor: COLORS.primary,
  },
  toggleDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.textSecondary,
  },
  toggleDotActive: {
    backgroundColor: COLORS.white,
    alignSelf: 'flex-end',
  },
});
