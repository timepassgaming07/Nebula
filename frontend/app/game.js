import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, {
  FadeInDown,
  FadeInUp,
  FadeIn,
  BounceIn,
  ZoomIn,
  SlideInLeft,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import ConfettiCannon from 'react-native-confetti-cannon';
import ScreenBackground from '../src/components/ScreenBackground';
import GlassButton from '../src/components/GlassButton';
import GlassCard from '../src/components/GlassCard';
import Avatar from '../src/components/Avatar';
import CountdownTimer from '../src/components/CountdownTimer';
import EmojiBar from '../src/components/EmojiBar';
import FloatingReactions from '../src/components/FloatingReactions';
import { COLORS, GRADIENTS, SPACING, BORDER_RADIUS, SHADOWS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import useGameStore, { GAME_STATES } from '../src/stores/gameStore';
import { useShallow } from 'zustand/react/shallow';
import {
  submitAnswer,
  submitVote,
  requestNextRound,
  sendEmojiReaction,
  leaveRoom,
} from '../src/services/socketService';

// ─── Reveal splash duration before showing the full scoreboard ───────────────
const REVEAL_SPLASH_MS = 2800;

export default function GameScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const game = useGameStore(useShallow((s) => ({
    state: s.state,
    currentRound: s.currentRound,
    totalRounds: s.totalRounds,
    question: s.question,
    timeLimit: s.timeLimit,
    timerPhase: s.timerPhase,
    hasSubmittedAnswer: s.hasSubmittedAnswer,
    answers: s.answers,
    answersSubmitted: s.answersSubmitted,
    hasVoted: s.hasVoted,
    selectedAnswerId: s.selectedAnswerId,
    votesSubmitted: s.votesSubmitted,
    players: s.players,
    isHost: s.isHost,
    roundResults: s.roundResults,
    connectionStatus: s.connectionStatus,
    roomEndedReason: s.roomEndedReason,
  })));

  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  // Local UI state: 'none' | 'reveal' | 'results'
  const [revealPhase, setRevealPhase] = useState('none');
  const revealTimeoutRef = useRef(null);

  // ── Navigate to final results screen on game over ──────────────────────────
  useEffect(() => {
    if (game.state === GAME_STATES.GAME_OVER) {
      router.replace('/results');
    }
  }, [game.state]);

  useEffect(() => {
    if (game.roomEndedReason === 'server_restarted') {
      Alert.alert('Room Closed', 'Server restarted and this game room was reset.', [
        {
          text: 'OK',
          onPress: () => router.replace('/home'),
        },
      ]);
    }
  }, [game.roomEndedReason]);

  // ── Reset answer text on new round ────────────────────────────────────────
  useEffect(() => {
    if (game.state === GAME_STATES.SUBMITTING_ANSWERS) {
      setAnswerText('');
      setSubmitting(false);
      setRevealPhase('none');
    }
  }, [game.state]);

  // ── Trigger reveal splash when ROUND_RESULTS arrives ──────────────────────
  useEffect(() => {
    if (game.state === GAME_STATES.ROUND_RESULTS || game.state === GAME_STATES.REVEALING) {
      setRevealPhase('reveal');                     // show splash first

      // Fire confetti if player scored
      const myResult = game.roundResults?.playerResults?.find(
        (p) => p.uid === user?.id
      );
      if (myResult?.roundScore > 0) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
      }

      // After REVEAL_SPLASH_MS, switch to full scoreboard
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = setTimeout(() => {
        setRevealPhase('results');
      }, REVEAL_SPLASH_MS);
    }
    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  }, [game.state]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSubmitAnswer = async () => {
    const trimmed = answerText.trim();
    if (trimmed.length === 0) {
      Alert.alert('Error', 'Please enter an answer');
      return;
    }
    setSubmitting(true);
    try {
      await submitAnswer(trimmed);
      setAnswerText('');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (answerId) => {
    try {
      await submitVote(answerId);
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleNextRound = async () => {
    try {
      await requestNextRound();
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleLeaveGame = () => {
    Alert.alert('Leave Game', 'Are you sure? You will lose your progress.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveRoom();
          router.replace('/home');
        },
      },
    ]);
  };

  // ==================== RENDER SUBMITTING ANSWERS ==========================
  const renderAnswerPhase = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.phaseContainer}
    >
      <Reanimated.View entering={FadeInUp.duration(600)} style={styles.questionContainer}>
        <Text style={styles.roundLabel}>
          Round {game.currentRound} of {game.totalRounds}
        </Text>
        <CountdownTimer total={game.timeLimit} phase="answer" />
      </Reanimated.View>

      <Reanimated.View entering={BounceIn.duration(800).delay(200)}>
        <GlassCard style={styles.questionCard}>
          <Text style={styles.questionText}>{game.question}</Text>
        </GlassCard>
      </Reanimated.View>

      {game.hasSubmittedAnswer ? (
        <Reanimated.View entering={ZoomIn.duration(500)} style={styles.waitingContainer}>
          <Text style={styles.waitingEmoji}>✅</Text>
          <Text style={styles.waitingText}>Answer submitted!</Text>
          <Text style={styles.waitingSubtext}>
            Waiting for others… ({game.answersSubmitted}/{game.players.filter(p => p.isConnected).length})
          </Text>
        </Reanimated.View>
      ) : (
        <Reanimated.View entering={FadeInDown.duration(600).delay(400)}>
          <GlassCard style={styles.inputCard}>
            <Text style={styles.inputLabel}>Write a convincing fake answer:</Text>
            <TextInput
              style={styles.answerInput}
              value={answerText}
              onChangeText={setAnswerText}
              placeholder="Type your bluff..."
              placeholderTextColor={COLORS.textMuted}
              maxLength={100}
              multiline={false}
              autoFocus
            />
            <Text style={styles.charCount}>{answerText.length}/100</Text>
            <GlassButton
              title="Submit Answer"
              onPress={handleSubmitAnswer}
              gradient={GRADIENTS.primary}
              loading={submitting}
              disabled={answerText.trim().length === 0}
              haptic="medium"
            />
          </GlassCard>
        </Reanimated.View>
      )}
    </KeyboardAvoidingView>
  );

  // ==================== RENDER VOTING PHASE ================================
  const renderVotingPhase = () => (
    <View style={styles.phaseContainer}>
      <Reanimated.View entering={FadeInUp.duration(600)} style={styles.questionContainer}>
        <Text style={styles.roundLabel}>
          Round {game.currentRound} of {game.totalRounds}
        </Text>
        <CountdownTimer total={game.timeLimit || 30} phase="vote" />
      </Reanimated.View>

      <Reanimated.View entering={BounceIn.duration(600)}>
        <GlassCard style={styles.questionCard}>
          <Text style={styles.questionText}>{game.question}</Text>
        </GlassCard>
      </Reanimated.View>

      <Text style={styles.votePrompt}>
        {game.hasVoted ? '🔒 Vote locked in!' : '🕵️ Which answer is REAL?'}
      </Text>

      <ScrollView style={styles.answersScroll} showsVerticalScrollIndicator={false}>
        {game.answers.map((answer, index) => {
          const isMyAnswer = answer.id === `player_${user?.id}`;
          const isSelected = game.selectedAnswerId === answer.id;
          return (
            <Reanimated.View
              key={answer.id}
              entering={SlideInLeft.duration(400).delay(index * 80)}
            >
              <TouchableOpacity
                onPress={() => !game.hasVoted && !isMyAnswer && handleVote(answer.id)}
                disabled={game.hasVoted || isMyAnswer}
                activeOpacity={0.7}
              >
                <GlassCard
                  style={[
                    styles.answerCard,
                    isSelected && styles.answerCardSelected,
                    isMyAnswer && styles.answerCardOwn,
                  ]}
                >
                  <View style={[styles.answerBadge, isSelected && styles.answerBadgeSelected]}>
                    <Text style={styles.answerLetter}>{String.fromCharCode(65 + index)}</Text>
                  </View>
                  <Text style={styles.answerText}>{answer.text}</Text>
                  {isMyAnswer && <Text style={styles.ownLabel}>Your bluff</Text>}
                  {isSelected && !isMyAnswer && <Text style={styles.selectedLabel}>✓</Text>}
                </GlassCard>
              </TouchableOpacity>
            </Reanimated.View>
          );
        })}
      </ScrollView>

      {game.hasVoted && (
        <Reanimated.View entering={FadeIn.duration(500)}>
          <Text style={styles.waitingSubtext}>
            Waiting for votes… ({game.votesSubmitted}/{game.players.filter(p => p.isConnected).length})
          </Text>
        </Reanimated.View>
      )}
    </View>
  );

  // ==================== RENDER REVEAL SPLASH ================================
  const renderRevealSplash = () => {
    const results = game.roundResults;
    if (!results) return null;

    const myResult = results.playerResults?.find((p) => p.uid === user?.id);
    const votedCorrectly = myResult?.votedCorrectly ?? false;
    const bluffVotes = myResult?.bluffVotes ?? 0;
    const roundScore = myResult?.roundScore ?? 0;

    // Determine the headline
    let headline, subline, emoji, gradientColors;
    if (votedCorrectly && bluffVotes > 0) {
      headline = 'Double win! 🔥';
      subline = `You spotted the truth AND fooled ${bluffVotes} player${bluffVotes > 1 ? 's' : ''}!`;
      emoji = '🔥';
      gradientColors = ['#7C3AED', '#06B6D4'];
    } else if (votedCorrectly) {
      headline = 'You got it! 🎯';
      subline = 'You spotted the real answer!';
      emoji = '🎯';
      gradientColors = ['#34D399', '#06B6D4'];
    } else if (bluffVotes > 0) {
      headline = `You fooled ${bluffVotes > 1 ? 'them' : 'someone'}! 😈`;
      subline = `${bluffVotes} player${bluffVotes > 1 ? 's' : ''} fell for your bluff!`;
      emoji = '😈';
      gradientColors = ['#7C3AED', '#F472B6'];
    } else {
      headline = 'Fooled you! 😂';
      subline = 'You fell for someone\'s bluff!';
      emoji = '😂';
      gradientColors = ['#F87171', '#F472B6'];
    }

    return (
      <View style={styles.revealContainer}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.revealGradient}
        />
        {/* Dark overlay for contrast */}
        <View style={styles.revealOverlay} />

        <Reanimated.View entering={ZoomIn.springify().damping(12)} style={styles.revealContent}>
          {/* Big emoji */}
          <Reanimated.Text entering={BounceIn.duration(600)} style={styles.revealEmoji}>
            {emoji}
          </Reanimated.Text>

          {/* Headline */}
          <Reanimated.Text
            entering={FadeInDown.duration(500).delay(200)}
            style={styles.revealHeadline}
          >
            {headline}
          </Reanimated.Text>

          {/* Sub-line */}
          <Reanimated.Text
            entering={FadeInDown.duration(500).delay(350)}
            style={styles.revealSubline}
          >
            {subline}
          </Reanimated.Text>

          {/* Score earned */}
          {roundScore > 0 && (
            <Reanimated.View
              entering={ZoomIn.duration(600).delay(500)}
              style={styles.revealScorePill}
            >
              <Text style={styles.revealScoreLabel}>+{roundScore} pts</Text>
            </Reanimated.View>
          )}

          {/* Correct answer reveal */}
          <Reanimated.View
            entering={FadeInDown.duration(500).delay(650)}
            style={styles.revealAnswerBox}
          >
            <Text style={styles.revealAnswerLabel}>The real answer was:</Text>
            <Text style={styles.revealAnswerText}>{results.correctAnswer}</Text>
          </Reanimated.View>
        </Reanimated.View>
      </View>
    );
  };

  // ==================== RENDER ROUND RESULTS (scoreboard) ==================
  const renderRoundResults = () => {
    const results = game.roundResults;
    if (!results) return null;

    const myResult = results.playerResults?.find((p) => p.uid === user?.id);
    const myRoundScore = myResult?.roundScore ?? 0;

    return (
      <ScrollView style={styles.phaseContainer} contentContainerStyle={styles.resultsContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <Reanimated.View entering={FadeInDown.duration(500)} style={styles.resultsHeaderRow}>
          <Text style={styles.resultsTitle}>Round {results.round} Scoreboard</Text>
          <Text style={styles.resultsSubtitle}>of {game.totalRounds}</Text>
        </Reanimated.View>

        {/* Correct answer banner */}
        <Reanimated.View entering={FadeInDown.duration(500).delay(100)}>
          <GlassCard style={styles.correctAnswerCard}>
            <Text style={styles.correctLabel}>✅ Real Answer</Text>
            <Text style={styles.correctAnswerText}>{results.correctAnswer}</Text>
          </GlassCard>
        </Reanimated.View>

        {/* Player rows — sorted by total score (server already sorts) */}
        {results.playerResults.map((result, index) => {
          const isMe = result.uid === user?.id;
          const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;

          return (
            <Reanimated.View
              key={result.uid}
              entering={FadeInDown.duration(400).delay(200 + index * 80)}
            >
              <GlassCard style={[styles.resultCard, isMe && styles.resultCardMe]}>
                {/* Rank + Avatar + Name */}
                <View style={styles.resultRow}>
                  <Text style={styles.rankText}>{rankEmoji}</Text>
                  <Avatar avatarId={result.avatarId} size={38} />
                  <View style={styles.resultInfo}>
                    <Text style={[styles.resultName, isMe && styles.resultNameMe]}>
                      {result.displayName}{isMe ? ' (You)' : ''}
                    </Text>
                    {result.submittedAnswer ? (
                      <Text style={styles.resultAnswerText} numberOfLines={1}>
                        Bluffed: "{result.submittedAnswer}"
                      </Text>
                    ) : null}
                  </View>
                  {/* Scores */}
                  <View style={styles.scoreColumn}>
                    {result.roundScore > 0 && (
                      <Text style={styles.roundScoreText}>+{result.roundScore}</Text>
                    )}
                    <Text style={styles.totalScoreText}>{result.totalScore} pts</Text>
                  </View>
                </View>

                {/* Badges row */}
                {(result.votedCorrectly || result.bluffVotes > 0) && (
                  <View style={styles.badgesRow}>
                    {result.votedCorrectly && (
                      <View style={[styles.badge, styles.badgeCorrect]}>
                        <Text style={styles.badgeText}>🎯 Correct guess +1000</Text>
                      </View>
                    )}
                    {result.bluffVotes > 0 && (
                      <View style={[styles.badge, styles.badgeBluff]}>
                        <Text style={styles.badgeText}>
                          😈 Fooled {result.bluffVotes} +{result.bluffVotes * 500}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </GlassCard>
            </Reanimated.View>
          );
        })}

        {/* Next round / waiting */}
        <Reanimated.View
          entering={FadeInDown.duration(400).delay(200 + results.playerResults.length * 80)}
          style={styles.nextRoundContainer}
        >
          {game.isHost ? (
            <GlassButton
              title={game.currentRound >= game.totalRounds ? '🏆 See Final Results' : '▶️  Next Round'}
              onPress={handleNextRound}
              gradient={GRADIENTS.neon}
              size="lg"
              haptic="heavy"
            />
          ) : (
            <View style={styles.waitingHostBox}>
              <Text style={styles.waitingHostText}>⏳ Waiting for host to continue…</Text>
            </View>
          )}
        </Reanimated.View>
      </ScrollView>
    );
  };

  // ==================== MAIN RENDER ========================================
  const renderContent = () => {
    switch (game.state) {
      case GAME_STATES.SUBMITTING_ANSWERS:
      case GAME_STATES.GENERATING_QUESTION:
        return renderAnswerPhase();
      case GAME_STATES.VOTING:
        return renderVotingPhase();
      case GAME_STATES.ROUND_RESULTS:
      case GAME_STATES.REVEALING:
        if (revealPhase === 'reveal') return renderRevealSplash();
        if (revealPhase === 'results') return renderRoundResults();
        return null;
      default:
        return (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        );
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleLeaveGame} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.leaveText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.scoreBar}>
            {game.players.slice(0, 5).map((p) => (
              <View key={p.uid} style={styles.miniPlayer}>
                <Avatar avatarId={p.avatarId} size={26} />
                <Text style={styles.miniScore}>{p.score}</Text>
              </View>
            ))}
          </View>
        </View>

        {game.connectionStatus !== 'connected' && (
          <View style={styles.connectionBanner}>
            <Text style={styles.connectionText}>
              {game.connectionStatus === 'reconnecting'
                ? 'Reconnecting... your game will continue automatically'
                : game.connectionStatus === 'disconnected'
                ? 'Connection lost. Attempting to reconnect...'
                : game.connectionStatus === 'failed'
                ? 'Unable to reconnect. Please return to Home.'
                : 'Syncing game state...'}
            </Text>
          </View>
        )}

        {renderContent()}

        {/* Only show emoji bar during active play phases */}
        {(game.state === GAME_STATES.SUBMITTING_ANSWERS || game.state === GAME_STATES.VOTING) && (
          <EmojiBar onSelect={(emoji) => sendEmojiReaction(emoji)} />
        )}

        <FloatingReactions />

        {showConfetti && (
          <ConfettiCannon
            count={120}
            origin={{ x: -10, y: 0 }}
            autoStart
            fadeOut
          />
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  // ── Top bar ──────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  leaveText: {
    fontSize: 22,
    color: COLORS.textSecondary,
    padding: SPACING.xs,
  },
  scoreBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  miniPlayer: {
    alignItems: 'center',
    gap: 2,
  },
  miniScore: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  connectionBanner: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: 'rgba(6,182,212,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.35)',
  },
  connectionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },

  // ── Shared phase container ────────────────────────────────────────────────
  phaseContainer: { flex: 1, padding: SPACING.md },
  questionContainer: { marginBottom: SPACING.md },
  roundLabel: {
    fontSize: 13,
    color: COLORS.accent,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  questionCard: { padding: SPACING.lg, marginBottom: SPACING.lg },
  questionText: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.white,
    textAlign: 'center',
    lineHeight: 28,
  },

  // ── Answer phase ─────────────────────────────────────────────────────────
  inputCard: { padding: SPACING.lg, gap: SPACING.md },
  inputLabel: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '500' },
  answerInput: {
    backgroundColor: COLORS.bgCardLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: 18,
    color: COLORS.white,
    fontWeight: '600',
  },
  charCount: { fontSize: 12, color: COLORS.textMuted, textAlign: 'right' },
  waitingContainer: { alignItems: 'center', paddingVertical: SPACING.xxl },
  waitingEmoji: { fontSize: 52, marginBottom: SPACING.md },
  waitingText: { fontSize: 18, fontWeight: '700', color: COLORS.white },
  waitingSubtext: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // ── Voting phase ─────────────────────────────────────────────────────────
  votePrompt: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.neonPink,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  answersScroll: { flex: 1 },
  answerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
  },
  answerCardSelected: { borderColor: COLORS.accent, borderWidth: 2 },
  answerCardOwn: { opacity: 0.45 },
  answerBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bgCardLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBadgeSelected: { backgroundColor: COLORS.accent },
  answerLetter: { fontSize: 15, fontWeight: '800', color: COLORS.white },
  answerText: { fontSize: 15, color: COLORS.white, flex: 1, fontWeight: '500' },
  ownLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  selectedLabel: { fontSize: 16, color: COLORS.accent, fontWeight: '800' },

  // ── Reveal splash ─────────────────────────────────────────────────────────
  revealContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  revealGradient: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  revealOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,26,0.55)',
  },
  revealContent: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    zIndex: 2,
  },
  revealEmoji: {
    fontSize: 90,
    marginBottom: SPACING.sm,
  },
  revealHeadline: {
    fontSize: 34,
    fontWeight: '900',
    color: COLORS.white,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  revealSubline: {
    fontSize: 17,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  revealScorePill: {
    backgroundColor: COLORS.neonGreen,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
    ...SHADOWS.neon,
  },
  revealScoreLabel: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.bgDark,
    letterSpacing: 0.5,
  },
  revealAnswerBox: {
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.bgGlass,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    width: '100%',
  },
  revealAnswerLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.xs,
  },
  revealAnswerText: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.neonGreen,
    textAlign: 'center',
  },

  // ── Round results (scoreboard) ────────────────────────────────────────────
  resultsContent: { paddingBottom: SPACING.xxl },
  resultsHeaderRow: { alignItems: 'center', marginBottom: SPACING.md },
  resultsTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: -0.3,
  },
  resultsSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  correctAnswerCard: {
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderColor: COLORS.neonGreen,
    borderWidth: 1,
  },
  correctLabel: {
    fontSize: 11,
    color: COLORS.neonGreen,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  correctAnswerText: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
    textAlign: 'center',
  },
  resultCard: { marginBottom: SPACING.sm, padding: SPACING.md },
  resultCardMe: { borderColor: COLORS.accent, borderWidth: 1.5 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  rankText: {
    fontSize: 18,
    minWidth: 30,
    textAlign: 'center',
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  resultNameMe: { color: COLORS.accent },
  resultAnswerText: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  scoreColumn: { alignItems: 'flex-end' },
  roundScoreText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.neonGreen,
  },
  totalScoreText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.full,
  },
  badgeCorrect: { backgroundColor: 'rgba(52,211,153,0.15)', borderWidth: 1, borderColor: COLORS.neonGreen },
  badgeBluff: { backgroundColor: 'rgba(196,132,252,0.15)', borderWidth: 1, borderColor: COLORS.neonPurple },
  badgeText: { fontSize: 11, color: COLORS.white, fontWeight: '600' },
  nextRoundContainer: {
    marginTop: SPACING.lg,
    alignItems: 'center',
  },
  waitingHostBox: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.bgGlass,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  waitingHostText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },

  // ── Generic ───────────────────────────────────────────────────────────────
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: COLORS.textSecondary },
});
