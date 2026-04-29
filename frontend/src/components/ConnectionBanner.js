import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import useGameStore from '../stores/gameStore';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme';

const STATUS_CONFIG = {
  connected: {
    bg: 'rgba(34,197,94,0.92)',   // green
    icon: '✓',
    message: 'Connected',
    autoDismiss: 2200,
  },
  disconnected: {
    bg: 'rgba(245,158,11,0.95)',  // amber
    icon: '⟳',
    message: 'Connection lost…',
    autoDismiss: null,
  },
  reconnecting: {
    bg: 'rgba(245,158,11,0.95)',
    icon: '⟳',
    message: 'Reconnecting…',
    autoDismiss: null,
  },
  error: {
    bg: 'rgba(239,68,68,0.95)',   // red
    icon: '!',
    message: 'Connection error',
    autoDismiss: null,
  },
  failed: {
    bg: 'rgba(239,68,68,0.95)',
    icon: '✕',
    message: 'Unable to connect. Check your internet.',
    autoDismiss: null,
  },
  server_shutdown: {
    bg: 'rgba(139,92,246,0.95)',  // purple
    icon: '↺',
    message: 'Server restarted — room ended.',
    autoDismiss: 4000,
  },
};

export default function ConnectionBanner() {
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const reconnectAttempt = useGameStore((s) => s.reconnectAttempt);

  const slideY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef(null);

  const isVisible =
    connectionStatus === 'disconnected' ||
    connectionStatus === 'reconnecting' ||
    connectionStatus === 'error' ||
    connectionStatus === 'failed' ||
    connectionStatus === 'server_shutdown' ||
    connectionStatus === 'connected';     // flash on first connect / reconnect

  useEffect(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }

    if (!isVisible) return;

    const config = STATUS_CONFIG[connectionStatus];
    if (!config) return;

    // Slide in
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss
    if (config.autoDismiss) {
      dismissTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(slideY, { toValue: -80, duration: 300, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start();
      }, config.autoDismiss);
    }

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [connectionStatus]);

  const config = STATUS_CONFIG[connectionStatus];
  if (!config || !isVisible) return null;

  const label =
    connectionStatus === 'reconnecting' && reconnectAttempt > 0
      ? `Reconnecting… (${reconnectAttempt})`
      : config.message;

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: config.bg, transform: [{ translateY: slideY }], opacity },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={styles.message}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 44,           // below status bar
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  icon: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '800',
  },
  message: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
