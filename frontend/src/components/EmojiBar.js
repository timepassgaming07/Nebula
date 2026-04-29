import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING } from '../theme';

const EMOJIS = ['😂', '🤯', '🔥', '👏', '💀', '😱', '🎉', '👀'];

export default function EmojiBar({ onSelect }) {
  return (
    <View style={styles.container}>
      {EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.emojiButton}
          onPress={() => onSelect(emoji)}
          activeOpacity={0.7}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.bgGlass,
    borderRadius: 20,
  },
  emojiButton: {
    padding: 4,
  },
  emoji: {
    fontSize: 24,
  },
});
