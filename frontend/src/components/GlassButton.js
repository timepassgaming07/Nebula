import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { COLORS, GRADIENTS, BORDER_RADIUS, SPACING, SHADOWS } from '../theme';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function GlassButton({
  title,
  onPress,
  gradient = GRADIENTS.primary,
  style,
  textStyle,
  disabled = false,
  loading = false,
  icon,
  size = 'md',
  variant = 'gradient', // 'gradient' | 'glass' | 'outline'
  haptic = 'light',     // 'light' | 'medium' | 'heavy' | 'none'
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const triggerHaptic = () => {
    if (haptic === 'none' || disabled || loading) return;
    try {
      if (haptic === 'heavy') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else if (haptic === 'medium') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      // Haptics not available (simulator) — ignore
    }
  };

  const handlePressIn = () => {
    scale.value = withSpring(0.95, { damping: 15 });
    triggerHaptic();
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15 });
  };

  const sizeStyles = {
    sm: { paddingVertical: 10, paddingHorizontal: 20, fontSize: 14 },
    md: { paddingVertical: 14, paddingHorizontal: 28, fontSize: 16 },
    lg: { paddingVertical: 18, paddingHorizontal: 36, fontSize: 18 },
  };

  const currentSize = sizeStyles[size];

  if (variant === 'gradient') {
    return (
      <AnimatedTouchable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.8}
        style={[animatedStyle, disabled && styles.disabled, style]}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.button,
            { paddingVertical: currentSize.paddingVertical, paddingHorizontal: currentSize.paddingHorizontal },
            SHADOWS.md,
          ]}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              {icon}
              <Text style={[styles.text, { fontSize: currentSize.fontSize }, textStyle]}>
                {title}
              </Text>
            </>
          )}
        </LinearGradient>
      </AnimatedTouchable>
    );
  }

  if (variant === 'glass') {
    return (
      <AnimatedTouchable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.8}
        style={[
          animatedStyle,
          styles.button,
          styles.glassButton,
          { paddingVertical: currentSize.paddingVertical, paddingHorizontal: currentSize.paddingHorizontal },
          disabled && styles.disabled,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            {icon}
            <Text style={[styles.text, { fontSize: currentSize.fontSize }, textStyle]}>
              {title}
            </Text>
          </>
        )}
      </AnimatedTouchable>
    );
  }

  // outline
  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        animatedStyle,
        styles.button,
        styles.outlineButton,
        { paddingVertical: currentSize.paddingVertical, paddingHorizontal: currentSize.paddingHorizontal },
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, styles.outlineText, { fontSize: currentSize.fontSize }, textStyle]}>
            {title}
          </Text>
        </>
      )}
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  text: {
    color: COLORS.white,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  glassButton: {
    backgroundColor: COLORS.bgGlass,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  outlineText: {
    color: COLORS.primary,
  },
  disabled: {
    opacity: 0.5,
  },
});
