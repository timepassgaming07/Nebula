import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { COLORS } from '../src/theme';
import useAuthStore from '../src/stores/authStore';
import ConnectionBanner from '../src/components/ConnectionBanner';

export default function RootLayout() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const initAuthListener = useAuthStore((s) => s.initAuthListener);

  useEffect(() => {
    initAuthListener();
    restoreSession();
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.bgDark },
          animation: 'slide_from_right',
        }}
      />
      {/* Global connection status banner — sits above all screens */}
      <ConnectionBanner />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
});
