import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import ScreenBackground from '../src/components/ScreenBackground';
import { COLORS, SPACING } from '../src/theme';
import useAuthStore from '../src/stores/authStore';

export default function SplashScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  const titleOpacity = useSharedValue(0);
  const titleScale = useSharedValue(0.5);
  const subtitleOpacity = useSharedValue(0);
  const glowIntensity = useSharedValue(0);

  useEffect(() => {
    // Animate splash
    titleOpacity.value = withTiming(1, { duration: 800 });
    titleScale.value = withSequence(
      withTiming(1.2, { duration: 600, easing: Easing.out(Easing.back) }),
      withTiming(1, { duration: 300 })
    );
    subtitleOpacity.value = withDelay(600, withTiming(1, { duration: 500 }));
    glowIntensity.value = withDelay(300, withTiming(1, { duration: 1000 }));

    // Navigate after splash
    const timer = setTimeout(() => {
      if (!isLoading) {
        if (isAuthenticated) {
          router.replace('/home');
        } else {
          router.replace('/login');
        }
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [isLoading, isAuthenticated]);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));

  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowIntensity.value * 0.3,
    transform: [{ scale: 1 + glowIntensity.value * 0.5 }],
  }));

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Animated.View style={[styles.glowCircle, glowStyle]} />
        <Animated.Text style={[styles.title, titleStyle]}>NEBULA</Animated.Text>
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          Bluff. Guess. Win.
        </Animated.Text>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowCircle: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: COLORS.primary,
  },
  title: {
    fontSize: 72,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 12,
    textShadowColor: COLORS.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textSecondary,
    letterSpacing: 4,
    marginTop: SPACING.md,
    fontWeight: '500',
  },
});
