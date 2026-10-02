import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Dot, Icon, Row, Screen } from '@/components/ui';
import { C, S, T } from '@/constants/ui';
import { requestAlarmAuthorization } from '@/lib/alarm';
import { exportData, importData } from '@/lib/backup';
import { resetOnboarding } from '@/lib/onboarding';
import { loadSampleHistory } from '@/lib/sample-data';
import {
  buzz,
  clearLog,
  Fence,
  isMonitoring,
  KIND_COLORS,
  loadFences,
  loadLog,
  LogEntry,
  simulateApproach,
  simulateArrival,
  simulateExit,
  simulateTurnAround,
  startMonitoring,
  stopMonitoring,
} from '@/lib/fences';

const LOG_PREVIEW = 30;
const OUTCOME_TAGS: Record<NonNullable<LogEntry['outcome']>, string> = {
  skipped: 'skipped',
  went: 'went in',
  here: 'here for it',
  passing: 'just passing',
};

export default function MonitorScreen() {
  const [monitoring, setMonitoring] = useState(false);
  const [permission, setPermission] = useState('unknown');
  const [fences, setFences] = useState<Fence[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);

  const refresh = useCallback(async () => {
    const [m, bg, f, l] = await Promise.all([
      isMonitoring(),
      Location.getBackgroundPermissionsAsync(),
      loadFences(),
      loadLog(),
    ]);
    setMonitoring(m);
    setPermission(bg.status);
    setFences(f);
    setLog(l);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const t = setInterval(refresh, 4000);
      return () => clearInterval(t);
    }, [refresh])
  );

  const start = async () => {
    if (fences.length === 0) {
      Alert.alert('No fences yet', 'Draw one on the Map tab first.');
      return;
    }
    const notif = await Notifications.requestPermissionsAsync();
    if (!notif.granted) {
      Alert.alert('Notifications needed', 'Enable notifications so the nudge can fire.');
      return;
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      Alert.alert('Location needed', 'Grant location so Sentry can watch your fences.');
      return;
    }
    await Location.requestBackgroundPermissionsAsync();
    // Full-screen alarm for Stay Out places (iOS 26); fine if declined.
    await requestAlarmAuthorization();
    await startMonitoring(fences);
    refresh();
  };

  const stop = async () => {
    await stopMonitoring();
    refresh();
  };

  const onClear = () =>
    Alert.alert('Clear the entry log?', 'Insights and the widget reset too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearLog();
          refresh();
        },
      },
    ]);

  // Test menu: a plain notification, or a full simulated arrival at a fence
  // (buzz + log entry + routine), so counts and the Life Score move.
  const openTest = () => {
    const sample = __DEV__ ? ['Load sample history', 'Replay onboarding'] : [];
    const actions: [string, () => Promise<void>][] = [
      ['Test notification', () => buzz('Test buzz', 'If you feel/see this, notifications work.')],
      ...fences.map((f): [string, () => Promise<void>] => [
        `Arrive at ${f.name}`,
        async () => {
          await simulateArrival(f);
          refresh();
        },
      ]),
      ...fences
        .filter((f) => f.kind === 'avoid')
        .flatMap((f): [string, () => Promise<void>][] => [
          [`Approach ${f.name}`, () => simulateApproach(f)],
          [`Turn around from ${f.name}`, () => simulateTurnAround(f)],
          [
            `Leave ${f.name}`,
            async () => {
              await simulateExit(f);
              refresh();
            },
          ],
        ]),
      ...(sample.length
        ? ([
            [
              'Load sample history',
              async () => {
                const { entries, runs } = await loadSampleHistory();
                Alert.alert(
                  'Sample history loaded',
                  `${entries} visits${runs ? ` and ${runs} routine runs` : ''} over the last 17 weeks.`
                );
                refresh();
              },
            ],
            [
              'Replay onboarding',
              async () => {
                await resetOnboarding();
                router.push('/onboarding');
              },
            ],
          ] as [string, () => Promise<void>][])
        : []),
      // Move data between Sentry Dev and Sentry: export in one, import in the other.
      ['Export data', async () => void (await Share.share({ message: await exportData() }))],
      ['Import data', async () => promptImport()],
    ];
    const options = [...actions.map(([label]) => label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        title: 'Test',
        message: fences.length
          ? 'Arrivals are logged like real ones, tagged “test”. Clear the log to remove them.'
          : 'Draw a fence on the Map to simulate arriving there.',
      },
      (i) => {
        actions[i]?.[1]().catch((e) => Alert.alert('Failed', String(e?.message ?? e)));
      }
    );
  };

  const promptImport = () => {
    Alert.prompt(
      'Import data',
      'Paste a backup from Export data. This replaces the fences, visits, and name in this app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: async (text?: string) => {
            try {
              const n = await importData(text ?? '');
              Alert.alert('Imported', `${n} items restored.`);
              refresh();
            } catch (e: any) {
              Alert.alert('Import failed', String(e?.message ?? e));
            }
          },
        },
      ],
      'plain-text'
    );
  };

  const always = permission === 'granted';
  const shown = log.slice(0, LOG_PREVIEW);

  return (
    <Screen title="Monitor">
      <Card flush>
        <Row
          leading={<Dot color={monitoring ? C.text : C.textMuted} />}
          title={monitoring ? 'Watching' : 'Not watching'}
          subtitle={
            monitoring
              ? `${fences.length} fence${fences.length === 1 ? '' : 's'} · buzzes when you arrive`
              : `${fences.length} fence${fences.length === 1 ? '' : 's'} ready`
          }
        />
        <Row
          leading={<Icon name={always ? 'location.fill' : 'location.slash'} size={16} color={always ? C.text : C.danger} />}
          title="Location"
          subtitle={always ? 'Always — works in the background' : 'Set to "Always"'}
          trailing={
            always ? null : (
              <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
                <Text style={styles.link}>Open Settings</Text>
              </Pressable>
            )
          }
          last
        />
      </Card>

      <View style={styles.actions}>
        {monitoring ? (
          <Button label="Stop" icon="stop.fill" variant="secondary" onPress={stop} style={{ flex: 1 }} />
        ) : (
          <Button label="Start watching" icon="play.fill" onPress={start} style={{ flex: 1 }} />
        )}
        <Button
          label="Test"
          icon="bell"
          variant="secondary"
          onPress={openTest}
        />
      </View>

      <Card
        flush
        title="Entry log"
        right={
          log.length > 0 ? (
            <Pressable onPress={onClear} hitSlop={8}>
              <Text style={[styles.link, { color: C.danger }]}>Clear</Text>
            </Pressable>
          ) : null
        }>
        {shown.length === 0 ? (
          <Text style={[T.caption, { paddingHorizontal: S.lg, paddingBottom: S.lg }]}>
            No entries yet. Walk or drive into a fence and it shows up here.
          </Text>
        ) : (
          shown.map((e, i) => (
            <Row
              key={`${e.ts}-${i}`}
              leading={<Dot color={KIND_COLORS[e.kind] ?? C.textMuted} />}
              // Entries from the old single-fence spike only have `region`.
              title={e.name ?? (e as any).region}
              subtitle={when(e.ts)}
              trailing={
                e.outcome ? (
                  <Text style={styles.testTag}>{OUTCOME_TAGS[e.outcome]}</Text>
                ) : e.simulated ? (
                  <Text style={styles.testTag}>test</Text>
                ) : e.insidePolygon === false ? (
                  <Text style={T.caption}>circle only</Text>
                ) : e.insidePolygon === true ? (
                  <Icon name="checkmark" size={13} color={C.textMuted} />
                ) : null
              }
              last={i === shown.length - 1}
            />
          ))
        )}
      </Card>
      {log.length > LOG_PREVIEW && (
        <Text style={[T.caption, styles.note]}>Showing the latest {LOG_PREVIEW} of {log.length}.</Text>
      )}

      <Text style={[T.caption, styles.note]}>
        iOS watches each shape as the smallest circle around it. A check means you were already inside the
        shape when it buzzed; "circle only" means it fired a little early.
      </Text>
    </Screen>
  );
}

function when(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: S.sm },
  link: { color: C.text, fontSize: 15, fontWeight: '600' },
  testTag: {
    color: C.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: C.raised,
  },
  note: { color: C.textMuted, lineHeight: 18, paddingHorizontal: S.xs },
});
