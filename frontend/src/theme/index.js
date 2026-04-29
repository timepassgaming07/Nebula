export const COLORS = {
  // Primary palette
  primary: '#7C3AED',
  primaryLight: '#A78BFA',
  primaryDark: '#5B21B6',

  // Secondary / Accent
  accent: '#06B6D4',
  accentLight: '#67E8F9',
  accentDark: '#0891B2',

  // Neon highlights
  neonPink: '#F472B6',
  neonGreen: '#34D399',
  neonYellow: '#FBBF24',
  neonBlue: '#60A5FA',
  neonPurple: '#C084FC',
  neonOrange: '#FB923C',

  // Backgrounds
  bgDark: '#0A0A1A',
  bgCard: '#1A1A2E',
  bgCardLight: '#252542',
  bgGlass: 'rgba(255, 255, 255, 0.08)',
  bgGlassLight: 'rgba(255, 255, 255, 0.12)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0C0',
  textMuted: '#6B6B8A',

  // Status
  success: '#34D399',
  error: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',

  // Misc
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const GRADIENTS = {
  primary: ['#7C3AED', '#A78BFA'],
  accent: ['#06B6D4', '#67E8F9'],
  dark: ['#0A0A1A', '#1A1A2E'],
  card: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.05)'],
  neon: ['#7C3AED', '#06B6D4'],
  sunset: ['#F472B6', '#FBBF24'],
  correct: ['#34D399', '#06B6D4'],
  wrong: ['#F87171', '#F472B6'],
};

export const FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const SHADOWS = {
  sm: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  neon: {
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
};
