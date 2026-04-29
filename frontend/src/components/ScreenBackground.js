import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, GRADIENTS } from '../theme';

export default function ScreenBackground({ children, style }) {
  return (
    <LinearGradient
      colors={[COLORS.bgDark, '#0F0F2D', COLORS.bgDark]}
      style={[styles.container, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
