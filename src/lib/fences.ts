import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Vibration } from 'react-native';

import { enclosingCircle, LatLng, pointInPolygon } from './geo';

export type FenceKind = 'avoid' | 'seek';

export type Fence = {
  id: string;
  name: string;
  kind: FenceKind;
  polygon: LatLng[];
  // The circle iOS actually monitors (smallest circle around the polygon,
  // clamped to MIN_RADIUS).
  center: LatLng;
  radius: number;
  createdAt: string;
};

export type LogEntry = {
  ts: string;
  fenceId: string;
  name: string;
  kind: FenceKind;
  // Was the phone inside the drawn shape (not just the circle) when iOS fired?
  // null = couldn't get a position fix.
  insidePolygon: boolean | null;
};

export const GEOFENCE_TASK = 'sentry-geofence-task';
export const MIN_RADIUS = 100; // iOS region monitoring gets flaky below ~100m
export const MAX_FENCES = 20; // hard iOS limit on monitored regions per app

const FENCES_KEY = 'sentry-fences';
const LOG_KEY = 'sentry-entry-log';

// Orange/blue, validated for color-vision deficiency on the dark surface
// (the old red/green pair failed: deutan ΔE 7.6).
export const KIND_COLORS: Record<FenceKind, string> = {
  avoid: '#d95926',
  seek: '#3987e5',
};

export const KIND_LABELS: Record<FenceKind, string> = {
  avoid: 'Stay out',
  seek: 'Go here',
};

export function makeFence(polygon: LatLng[], name: string, kind: FenceKind): Fence {
  const { center, radius } = enclosingCircle(polygon);
  return {
    id: `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    kind,
    polygon,
    center,
    radius: Math.max(MIN_RADIUS, Math.ceil(radius)),
    createdAt: new Date().toISOString(),
  };
}

export async function loadFences(): Promise<Fence[]> {
  const raw = await AsyncStorage.getItem(FENCES_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveFences(fences: Fence[]): Promise<void> {
  await AsyncStorage.setItem(FENCES_KEY, JSON.stringify(fences));
  await resyncIfMonitoring(fences);
}

export async function loadLog(): Promise<LogEntry[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function clearLog(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
}

async function appendLog(entry: LogEntry): Promise<void> {
  const log = await loadLog();
  log.unshift(entry);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));
}

export async function isMonitoring(): Promise<boolean> {
  return Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
}

// Hand the current fence set to iOS. Calling startGeofencingAsync again
// replaces the previous region list.
export async function startMonitoring(fences: Fence[]): Promise<void> {
  if (fences.length === 0) {
    await stopMonitoring();
    return;
  }
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    fences.slice(0, MAX_FENCES).map((f) => ({
      identifier: f.id,
      latitude: f.center.latitude,
      longitude: f.center.longitude,
      radius: f.radius,
      notifyOnEnter: true,
      notifyOnExit: false,
    }))
  );
}

export async function stopMonitoring(): Promise<void> {
  if (await isMonitoring()) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

async function resyncIfMonitoring(fences: Fence[]): Promise<void> {
  if (await isMonitoring()) await startMonitoring(fences);
}

async function currentPosition(): Promise<LatLng | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    if (last) return last.coords;
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
    ]);
    return fresh?.coords ?? null;
  } catch {
    return null;
  }
}

export async function buzz(title: string, body: string): Promise<void> {
  Vibration.vibrate([0, 400, 200, 400]);
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  });
}

// ------------------------------------------------------------
// Runs in the background when iOS reports a region event. Must be defined at
// module scope, so this file is imported from the root layout.
// ------------------------------------------------------------
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: { data: any; error: any }) => {
  if (error) {
    console.log('Geofence task error:', error);
    return;
  }
  if (!data || data.eventType !== Location.GeofencingEventType.Enter) return;

  const fences = await loadFences();
  const fence = fences.find((f) => f.id === data.region?.identifier);
  if (!fence) return;

  // Buzz on the circle entry regardless: a missed nudge is worse than an early
  // one for this test. The polygon check is logged so we can see how often the
  // circle fires before you're actually inside the shape.
  if (fence.kind === 'avoid') {
    await buzz(`Hey — you wanted to skip ${fence.name}.`, "There's food at home. Want to pause for a second?");
  } else {
    await buzz(`You made it to ${fence.name}.`, 'Nice. That counts.');
  }

  const pos = await currentPosition();
  await appendLog({
    ts: new Date().toISOString(),
    fenceId: fence.id,
    name: fence.name,
    kind: fence.kind,
    insidePolygon: pos ? pointInPolygon(pos, fence.polygon) : null,
  });
});
