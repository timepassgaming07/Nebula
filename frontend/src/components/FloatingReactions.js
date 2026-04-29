import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import useGameStore from '../stores/gameStore';

/**
 * Each reaction floats up from a random horizontal position.
 * Uses React Native's built-in Animated API so it works on all platforms.
 */
function FloatingEmoji({ reaction }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.5)).current;
  const translateX = useRef(new Animated.Value((Math.random() - 0.5) * 80)).current;

  useEffect(() => {
    Animated.parallel([
      // Scale pop in
      Animated.spring(scale, {
        toValue: 1.1,
        speed: 30,
        bounciness: 10,
        useNativeDriver: true,
      }),
      // Float upward
      Animated.timing(translateY, {
        toValue: -160,
        duration: 2800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Drift sideways slightly
      Animated.timing(translateX, {
        toValue: translateX._value + (Math.random() - 0.5) * 40,
        duration: 2800,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      // Fade out in second half
      Animated.sequence([
        Animated.delay(1600),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.reactionItem,
        { transform: [{ translateY }, { translateX }, { scale }], opacity },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.emoji}>{reaction.emoji}</Text>
    </Animated.View>
  );
}

export default function FloatingReactions() {
  const reactions = useGameStore((s) => s.reactions);

  return (
    <View style={styles.container} pointerEvents="none">
      {reactions.map((reaction) => (
        <FloatingEmoji key={reaction.id} reaction={reaction} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
    pointerEvents: 'none',
  },
  reactionItem: {
    position: 'absolute',
  },
  emoji: {
    fontSize: 38,
  },
});
