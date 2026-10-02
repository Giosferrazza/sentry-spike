import * as Notifications from 'expo-notifications';
import { DarkTheme, router, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { C } from '@/constants/ui';
// Also registers the background geofence task at module scope.
import { migrateRegions, refreshWidget } from '@/lib/fences';
import { unseenIntervention } from '@/lib/interventions';
import { openOnce } from '@/lib/nav';
import { needsOnboarding } from '@/lib/onboarding';

// Show nudges as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Every screen is dark-styled regardless of the system theme.
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg } };

export default function RootLayout() {
  // Seed the widget on launch (first install, or after a midnight rollover).
  useEffect(() => {
    migrateRegions().catch(() => {});
    refreshWidget();
    needsOnboarding().then((yes) => yes && router.push('/onboarding'));
  }, []);

  useNotificationLinks();
  useAutoIntervention();

  return (
    <ThemeProvider value={theme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="routine/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="intervention/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
        />
      </Stack>
    </ThemeProvider>
  );
}

// Tapping a notification that carries `data.url` (e.g. a routine) opens that
// screen, including when the tap launched the app from scratch.
function useNotificationLinks() {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    const url = response.notification.request.content.data?.url;
    if (handled.current === id || typeof url !== 'string') return;
    handled.current = id;
    openOnce(url);
  }, [response]);
}

// An intervention you haven't seen opens by itself whenever Sentry comes to
// the foreground, however you opened it.
function useAutoIntervention() {
  useEffect(() => {
    const check = () =>
      unseenIntervention()
        .then((s) => s && openOnce(`/intervention/${s.id}`))
        .catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
  }, []);
}
