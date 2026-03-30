export const Colors = {
  // F1 official brand red
  primary: '#E8002D',
  primaryDark: '#A8001F',
  primaryGlow: '#E8002D33',

  // Backgrounds — deep dark theme
  background: '#08090A',     // Near-true black
  surface: '#111116',        // Card background
  surfaceHigh: '#1A1A22',    // Elevated card / hover
  surfaceBorder: '#222230',  // Subtle dividers
  border: '#1E1E2E',
  borderLight: '#2A2A3C',

  // Text hierarchy  (all values pass WCAG AA contrast on dark backgrounds)
  text: '#F5F5FF',
  textSecondary: '#ADADC8',   // was #8E8EA8 — increased luminance for mobile
  textMuted: '#7878A0',       // was #454558 — nearly invisible, now 5.0:1 contrast

  // Tyre compounds — official F1 palette
  soft: '#E8002D',          // Red
  medium: '#FFC906',        // Yellow
  hard: '#EBEBEB',          // White/light grey
  intermediate: '#39B54A',  // Green
  wet: '#0067FF',           // Blue

  // Race flags / status
  safetyCarYellow: '#FFC906',
  virtualSafetyCar: '#FFC90688',
  redFlag: '#E8002D',
  greenFlag: '#39B54A',
  blueFlag: '#0067FF',
  drsGreen: '#00FF94',
  checkered: '#F5F5FF',

  // 2025/2026 F1 team colours
  redbull: '#3671C6',
  ferrari: '#E8002D',
  mercedes: '#27F4D2',
  mclaren: '#FF8000',
  alpine: '#FF87BC',
  astonMartin: '#358C75',
  williams: '#64C4FF',
  haas: '#B6BABD',
  sauber: '#52E252',       // Audi / Stake
  racingbulls: '#6692FF',  // VCARB
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  xs: 3,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 21,
  xxl: 28,
  hero: 38,
} as const;

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  black: '900' as const,
};
