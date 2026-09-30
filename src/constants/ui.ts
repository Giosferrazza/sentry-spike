// Design tokens for the Sentry UI. Every screen is dark; data colors
// (stay out / go here) live in KIND_COLORS and are never used for controls,
// so a colored mark always means data and a white button always means action.

export const C = {
  bg: '#0f1115',
  surface: '#161922',
  raised: '#1d212c',
  line: '#262b38',
  text: '#f3f5f8',
  textSecondary: '#8b93a3',
  textMuted: '#5a6172',
  // Primary actions are white-on-dark, secondary are raised gray.
  action: '#f3f5f8',
  onAction: '#0f1115',
  danger: '#e5484d',
  streak: '#f5a524',
  // Floating controls over the map.
  glass: 'rgba(22,25,34,0.92)',
} as const;

export const R = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const T = {
  largeTitle: { fontSize: 32, fontWeight: '800' as const, color: C.text, letterSpacing: -0.5 },
  title: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  body: { fontSize: 15, color: C.text },
  label: { fontSize: 15, fontWeight: '600' as const, color: C.text },
  caption: { fontSize: 13, color: C.textSecondary },
  overline: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
};
