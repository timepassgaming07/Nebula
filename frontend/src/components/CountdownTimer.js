import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { COLORS, BORDER_RADIUS, SPACING } from '../theme';
import useGameStore from '../stores/gameStore';

export default function CountdownTimer({ total, phase }) {
  const remaining = useGameStore((s) => s.timeRemaining);
  const progress = useSharedValue(1);
  const pulse = useSharedValue(1);

  // Smooth bar progress
  useEffect(() => {
    progress.value = withTiming(remaining / total, {
      duration: 900,
      easing: Easing.linear,
    });
  }, [remaining, total]);

  // Pulse scale effect when <= 10 seconds
  useEffect(() => {
    if (remaining <= 10 && remaining > 0) {
      pulse.value = withSequence(
        withSpring(1.18, { damping: 6, stiffness: 300 }),
        withSpring(1.0, { damping: 10, stiffness: 300 })
      );
    } else if (remaining > 10) {
      pulse.value = withSpring(1.0, { damping: 10 });
    }
  }, [remaining]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(100, progress.value * 100))}%`,
  }));

  const textPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const isLow = remaining <= 10;
  const isVeryLow = remaining <= 5;

  const barColor = isVeryLow
    ? COLORS.error
    : isLow
    ? '#f97316'   // orange
    : phase === 'answer'
    ? COLORS.accent
    : COLORS.neonPink;

  return (
    <View style={styles.container}>
      <View style={styles.barBg}>
        <Animated.View style={[styles.barFill, barStyle, { backgroundColor: barColor }]} />
      </View>
      <Animated.Text style={[styles.text, isLow && styles.textLow, textPulseStyle]}>
        {remaining}s
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  barBg: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.bgCardLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  text: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 18,
    minWidth: 40,
    textAlign: 'right',
  },
  textLow: {
    color: COLORS.error,
  },
});
