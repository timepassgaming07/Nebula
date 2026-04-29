/**
 * PhaseTransition
 * Wraps game phase content with smooth fade-in animation whenever
 * the `phaseKey` prop changes (e.g. game state string).
 *
 * Usage:
 *   <PhaseTransition phaseKey={gameState}>
 *     {children}
 *   </PhaseTransition>
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

export default function PhaseTransition({ phaseKey, children, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    // Reset
    opacity.setValue(0);
    translateY.setValue(12);

    // Animate in
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 18,
        stiffness: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [phaseKey]);

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
