import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import {
  buzz,
  clearLog,
  Fence,
  isMonitoring,
  KIND_COLORS,
  loadFences,
  loadLog,
  LogEntry,
  startMonitoring,
  stopMonitoring,
} from '@/lib/fences';

export default function MonitorScreen() {
  const insets = useSafeAreaInsets();
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
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      Alert.alert(
        'Set location to "Always"',
        'Open Settings > Sentry Spike > Location and choose "Always". ' +
          'Fences will not fire in the background without it.'
      );
    }
    await startMonitoring(fences);
    refresh();
  };

  const stop = async () => {
    await stopMonitoring();
    refresh();
  };

  const onClear = async () => {
    await clearLog();
    refresh();
  };

  const hits = log.filter((e) => e.insidePolygon === true).length;
  const misses = log.filter((e) => e.insidePolygon === false).length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + BottomTabInset + 24 },
      ]}>
      <Text style={styles.h1}>Monitor</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, monitoring && { color: KIND_COLORS.seek }]}>
          {monitoring ? `Watching ${fences.length} fence${fences.length === 1 ? '' : 's'}` : 'Stopped'}
        </Text>
        <Text style={styles.label}>Background location</Text>
        <Text style={[styles.value, permission !== 'granted' && { color: KIND_COLORS.avoid }]}>
          {permission === 'granted' ? 'Always ✓' : permission}
        </Text>
        {log.length > 0 && (
          <>
            <Text style={styles.label}>Inside the drawn shape when it fired</Text>
            <Text style={styles.value}>
              {hits} yes · {misses} not yet (circle only)
            </Text>
          </>
        )}
      </View>

      {monitoring ? (
        <Pressable style={[styles.btn, styles.btnAlt]} onPress={stop}>
          <Text style={styles.btnText}>Stop monitoring</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.btn} onPress={start}>
          <Text style={styles.btnText}>Start monitoring</Text>
        </Pressable>
      )}
      <Pressable
        style={[styles.btn, styles.btnGhost]}
        onPress={() => buzz('Test buzz', 'If you feel/see this, notifications work.')}>
        <Text style={styles.btnGhostText}>Test buzz now</Text>
      </Pressable>

      <View style={styles.logHeader}>
        <Text style={styles.h2}>Entry log ({log.length})</Text>
        <Pressable onPress={onClear}>
          <Text style={styles.clear}>clear</Text>
        </Pressable>
      </View>
      {log.length === 0 ? (
        <Text style={styles.empty}>No entries yet. Go walk or drive into one of your fences.</Text>
      ) : (
        log.map((e, i) => (
          <View key={i} style={styles.logRow}>
            <View style={[styles.dot, { backgroundColor: KIND_COLORS[e.kind] ?? '#8b93a3' }]} />
            <View style={{ flex: 1 }}>
              {/* Entries from the old single-fence spike only have `region`. */}
              <Text style={styles.logName}>{e.name ?? (e as any).region}</Text>
              <Text style={styles.logMeta}>
                {new Date(e.ts).toLocaleString()}
                {e.insidePolygon === true && ' · inside shape'}
                {e.insidePolygon === false && ' · circle only'}
              </Text>
            </View>
          </View>
        ))
      )}

      <Text style={styles.note}>
        iOS can only watch circles, so each shape you draw is watched as the smallest circle around
        it. You get buzzed when you cross the circle; the log records whether you were already inside
        the shape itself.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  container: { paddingHorizontal: 20 },
  h1: { fontSize: 30, fontWeight: '800', color: '#f3f5f8', marginBottom: 16 },
  h2: { fontSize: 18, fontWeight: '700', color: '#f3f5f8' },
  card: { backgroundColor: '#161922', borderRadius: 14, padding: 16, marginBottom: 20 },
  label: { fontSize: 12, color: '#5a6172', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 16, color: '#f3f5f8', fontWeight: '600' },
  btn: { backgroundColor: '#5b7fff', padding: 16, borderRadius: 12, marginBottom: 10, alignItems: 'center' },
  btnAlt: { backgroundColor: '#374151' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#262b38' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnGhostText: { color: '#8b93a3', fontWeight: '600', fontSize: 15 },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  clear: { color: '#e0564f', fontSize: 14 },
  empty: { color: '#5a6172', fontStyle: 'italic' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#161922',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  logName: { color: '#f3f5f8', fontSize: 15, fontWeight: '600' },
  logMeta: { color: '#8b93a3', fontSize: 12, marginTop: 2 },
  note: { color: '#5a6172', fontSize: 12, marginTop: 28, lineHeight: 18 },
});
