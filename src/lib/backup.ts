import AsyncStorage from '@react-native-async-storage/async-storage';

import { isMonitoring, loadFences, refreshWidget, startMonitoring } from './fences';

// Moving data between Sentry Dev and Sentry (separate apps, separate storage):
// export everything as JSON, paste it into the other app.

// Per-device geofence state; the other app rebuilds its own.
const SKIP = new Set(['sentry-presence', 'sentry-pending-arrivals', 'sentry-regions-version']);
const TAG = 'sentry-backup';

export async function exportData(): Promise<string> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => !SKIP.has(k));
  const pairs = await AsyncStorage.multiGet(keys);
  const data = Object.fromEntries(pairs.filter(([, v]) => v !== null));
  return JSON.stringify({ [TAG]: 1, data });
}

// Replaces this app's data with the backup. Returns how many keys were written.
export async function importData(json: string): Promise<number> {
  const parsed = JSON.parse(json.trim());
  if (parsed?.[TAG] !== 1 || typeof parsed.data !== 'object') throw new Error('Not a Sentry backup.');
  const pairs = Object.entries(parsed.data as Record<string, string>).filter(
    ([k, v]) => !SKIP.has(k) && typeof v === 'string'
  );
  await AsyncStorage.multiSet(pairs);
  // Hand iOS the imported fences if this app is already watching.
  if (await isMonitoring()) await startMonitoring(await loadFences());
  await refreshWidget();
  return pairs.length;
}
