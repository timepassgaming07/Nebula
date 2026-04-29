import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, BORDER_RADIUS, SPACING } from '../theme';

const AVATAR_COLORS = [
  '#7C3AED', '#06B6D4', '#F472B6', '#34D399', '#FBBF24',
  '#FB923C', '#60A5FA', '#C084FC', '#F87171', '#4ADE80',
  '#E879F9', '#38BDF8', '#FCD34D', '#F97316', '#14B8A6',
  '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#6366F1',
];

const AVATAR_EMOJIS = [
  '😎', '🎮', '🦊', '🐱', '🦁', '🐸', '🐙', '🦄', '🐼', '🐨',
  '🦋', '🌟', '🔥', '💎', '🎯', '🚀', '⚡', '🌈', '🎪', '🧠',
];

export default function Avatar({ avatarId = 1, size = 48, style }) {
  const colorIndex = (avatarId - 1) % AVATAR_COLORS.length;
  const emojiIndex = (avatarId - 1) % AVATAR_EMOJIS.length;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: AVATAR_COLORS[colorIndex],
        },
        style,
      ]}
    >
      <Text style={[styles.emoji, { fontSize: size * 0.5 }]}>
        {AVATAR_EMOJIS[emojiIndex]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  emoji: {},
});
