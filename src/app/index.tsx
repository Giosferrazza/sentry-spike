import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Vibration, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================
// SENTRY SPIKE — one question: does the buzz reliably fire,
// and does it make me pause? Carry this for ~3 days.
// ============================================================

// 1. EDIT THIS: pick a fast food spot near you, grab lat/long
//    from Google Maps (right-click the pin -> copy coordinates).
const TEST_FENCE = {
  identifier: 'test-fence',
  latitude: 39.51822003717834,    // <-- REPLACE , 
  longitude: -119.89658381878138,  // <-- REPLACE
  radius: 120,          // meters. 100-150 is a good starting point.
  notifyOnEnter: true,
  notifyOnExit: false,
};

const GEOFENCE_TASK = 'sentry-geofence-task';
const LOG_KEY = 'sentry-entry-log';

// How notifications behave when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ------------------------------------------------------------
// THE TASK: runs in the background when iOS reports a fence event.
// Defined at module scope (required).
// ------------------------------------------------------------
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: { data: any; error: any }) => {
  if (error) {
    console.log('Geofence task error:', error);
    return;
  }
  if (!data) return;

  const { eventType, region } = data;

  if (eventType === Location.GeofencingEventType.Enter) {
    Vibration.vibrate([0, 400, 200, 400]);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hey — you wanted to skip this.',
        body: "There's food at home. Want to pause for a second?",
        sound: true,
      },
      trigger: null,
    });

    try {
      const raw = await AsyncStorage.getItem(LOG_KEY);
      const log = raw ? JSON.parse(raw) : [];
      log.unshift({ ts: new Date().toISOString(), region: region?.identifier });
      await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
    } catch (e) {
      console.log('log write failed', e);
    }
  }
});

export default function Index() {
  const [status, setStatus] = useState('Not started');
  const [permission, setPermission] = useState('unknown');
  const [log, setLog] = useState<any[]>([]);

  const loadLog = useCallback(async () => {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    setLog(raw ? JSON.parse(raw) : []);
  }, []);

  useEffect(() => {
    loadLog();
    const sub = setInterval(loadLog, 4000);
    return () => clearInterval(sub);
  }, [loadLog]);

  const start = async () => {
    const notif = await Notifications.requestPermissionsAsync();
    if (!notif.granted) {
      Alert.alert('Notifications needed', 'Enable notifications so the nudge can fire.');
      return;
    }

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      setPermission('foreground denied');
      Alert.alert('Location needed', 'Grant location to test the fence.');
      return;
    }

    const bg = await Location.requestBackgroundPermissionsAsync();
    setPermission(bg.status);
    if (bg.status !== 'granted') {
      Alert.alert(
        'Set location to "Always"',
        'Open Settings > Sentry Spike > Location and choose "Always". ' +
        'The fence will not fire in the background without it.'
      );
    }

    await Location.startGeofencingAsync(GEOFENCE_TASK, [TEST_FENCE]);
    setStatus('Monitoring fence ✅');
  };

  const stop = async () => {
    const started = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    setStatus('Stopped');
  };

  const clearLog = async () => {
    await AsyncStorage.removeItem(LOG_KEY);
    loadLog();
  };

  const testBuzz = async () => {
    Vibration.vibrate([0, 400, 200, 400]);
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Test buzz', body: 'If you feel/see this, notifications work.' },
      trigger: null,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Sentry Spike</Text>
      <Text style={styles.sub}>Does the buzz fire when I arrive? Does it make me pause?</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Status</Text>
        <Text style={styles.value}>{status}</Text>
        <Text style={styles.label}>Background permission</Text>
        <Text style={styles.value}>{permission}</Text>
        <Text style={styles.label}>Fence</Text>
        <Text style={styles.value}>
          {TEST_FENCE.latitude}, {TEST_FENCE.longitude} · {TEST_FENCE.radius}m
        </Text>
      </View>

      <TouchableOpacity style={styles.btn} onPress={start}>
        <Text style={styles.btnText}>Start monitoring</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnAlt]} onPress={stop}>
        <Text style={styles.btnText}>Stop</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={testBuzz}>
        <Text style={styles.btnGhostText}>Test buzz now</Text>
      </TouchableOpacity>

      <View style={styles.logHeader}>
        <Text style={styles.h2}>Entry log ({log.length})</Text>
        <TouchableOpacity onPress={clearLog}>
          <Text style={styles.clear}>clear</Text>
        </TouchableOpacity>
      </View>
      {log.length === 0 ? (
        <Text style={styles.empty}>No entries yet. Go drive past your fence.</Text>
      ) : (
        log.map((e: any, i: number) => (
          <Text key={i} style={styles.logRow}>
            {new Date(e.ts).toLocaleString()} — {e.region}
          </Text>
        ))
      )}

      <Text style={styles.note}>
        Tip: after granting permission, go to Settings → Sentry Spike → Location
        and confirm it says "Always". Then carry the phone past the fence a few
        times. Check whether every pass shows up here.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 72, backgroundColor: '#0f1115', minHeight: '100%' },
  h1: { fontSize: 30, fontWeight: '800', color: '#fff' },
  h2: { fontSize: 18, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 14, color: '#9aa3b2', marginTop: 6, marginBottom: 20 },
  card: { backgroundColor: '#1a1d24', borderRadius: 14, padding: 16, marginBottom: 20 },
  label: { fontSize: 12, color: '#6b7280', marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 16, color: '#e5e7eb', fontWeight: '600' },
  btn: { backgroundColor: '#3b82f6', padding: 16, borderRadius: 12, marginBottom: 10, alignItems: 'center' },
  btnAlt: { backgroundColor: '#374151' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnGhostText: { color: '#9aa3b2', fontWeight: '600', fontSize: 15 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 8 },
  clear: { color: '#ef4444', fontSize: 14 },
  empty: { color: '#6b7280', fontStyle: 'italic' },
  logRow: { color: '#cbd5e1', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1d24', fontSize: 13 },
  note: { color: '#6b7280', fontSize: 12, marginTop: 28, lineHeight: 18 },
});