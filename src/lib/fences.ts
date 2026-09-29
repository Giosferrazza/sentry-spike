import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Vibration } from 'react-native';

import { distanceMeters, enclosingCircle, LatLng, pointInPolygon } from './geo';
import { decideEnter, Presence } from './presence';
import { Habit, loadRuns, startRun } from './routines';
import { syncWidget } from './widget';

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
  // Ordered checklist shown on arrival (go-here fences only).
  habits?: Habit[];
};

export type LogEntry = {
  ts: string;
  fenceId: string;
  name: string;
  kind: FenceKind;
  // Was the phone inside the drawn shape (not just the circle) when iOS fired?
  // null = couldn't get a position fix.
  insidePolygon: boolean | null;
  // Made with Monitor's Test > "Arrive at …", not a real geofence event.
  simulated?: boolean;
  // Answer to a stay-out alert's buttons.
  outcome?: 'skipped' | 'went';
};

export const GEOFENCE_TASK = 'sentry-geofence-task';
export const MIN_RADIUS = 100; // iOS region monitoring gets flaky below ~100m
export const MAX_FENCES = 20; // hard iOS limit on monitored regions per app

const FENCES_KEY = 'sentry-fences';
const LOG_KEY = 'sentry-entry-log';
const PRESENCE_KEY = 'sentry-presence';

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
  await refreshWidget();
}

export async function loadLog(): Promise<LogEntry[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function clearLog(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
  await refreshWidget();
}

async function appendLog(entry: LogEntry): Promise<void> {
  const log = await loadLog();
  log.unshift(entry);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));
  await refreshWidget();
}

// Regions registered before exit events existed never report exits, so
// presence tracking can't work for them. Re-register once with the current
// settings; the re-report of fences you're inside is absorbed by presence.
const REGIONS_VERSION_KEY = 'sentry-regions-version';
const REGIONS_VERSION = '2';

export async function migrateRegions(): Promise<void> {
  if ((await AsyncStorage.getItem(REGIONS_VERSION_KEY)) === REGIONS_VERSION) return;
  if (await isMonitoring()) await startMonitoring(await loadFences());
  await AsyncStorage.setItem(REGIONS_VERSION_KEY, REGIONS_VERSION);
}

// Push the current state to the home screen widget.
export async function refreshWidget(): Promise<void> {
  const [log, fences, monitoring, runs] = await Promise.all([
    loadLog(),
    loadFences(),
    isMonitoring(),
    loadRuns(),
  ]);
  syncWidget(log, fences, monitoring, runs);
}

// Mark fences you're standing in right now as "inside" before (re)starting
// monitoring, so iOS's immediate re-report of them isn't logged as an arrival
// (e.g. drawing a fence around home while at home).
async function seedPresence(fences: Fence[]): Promise<void> {
  const pos = await currentPosition();
  if (!pos) return;
  const presence = await loadPresence();
  const now = new Date().toISOString();
  for (const f of fences) {
    const inside = distanceMeters(pos, f.center) <= f.radius;
    if (inside && !presence[f.id]?.inside) presence[f.id] = { inside: true, since: now };
  }
  await savePresence(presence);
}

async function loadPresence(): Promise<Presence> {
  const raw = await AsyncStorage.getItem(PRESENCE_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function savePresence(p: Presence): Promise<void> {
  await AsyncStorage.setItem(PRESENCE_KEY, JSON.stringify(p));
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
  await seedPresence(fences);
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    fences.slice(0, MAX_FENCES).map((f) => ({
      identifier: f.id,
      latitude: f.center.latitude,
      longitude: f.center.longitude,
      radius: f.radius,
      notifyOnEnter: true,
      // Exits let us tell a real arrival from iOS re-reporting a fence
      // you never left (see presence.ts).
      notifyOnExit: true,
    }))
  );
  await refreshWidget();
}

export async function stopMonitoring(): Promise<void> {
  if (await isMonitoring()) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  await refreshWidget();
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

export async function buzz(
  title: string,
  body: string,
  opts: { data?: Record<string, string>; category?: string } = {}
): Promise<void> {
  Vibration.vibrate([0, 400, 200, 400]);
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: opts.data, categoryIdentifier: opts.category },
    trigger: null,
  });
}

// ------------------------------------------------------------
// Stay-out alert buttons. Answering from the notification (no need to open
// the app) records the outcome on that log entry; "Skipping it" counts as a
// win in the Life Score.
// ------------------------------------------------------------
const STAY_OUT_CATEGORY = 'stay-out';
const ACTION_SKIP = 'skip';
const ACTION_WENT = 'went';

Notifications.setNotificationCategoryAsync(STAY_OUT_CATEGORY, [
  { identifier: ACTION_SKIP, buttonTitle: 'Skipping it', options: { opensAppToForeground: false } },
  {
    identifier: ACTION_WENT,
    buttonTitle: 'Going in anyway',
    options: { opensAppToForeground: false, isDestructive: true },
  },
]).catch(() => {});

async function handleAlertAnswer(r: Notifications.NotificationResponse): Promise<void> {
  const outcome =
    r.actionIdentifier === ACTION_SKIP ? 'skipped' : r.actionIdentifier === ACTION_WENT ? 'went' : null;
  const entryTs = r.notification.request.content.data?.entryTs;
  if (!outcome || typeof entryTs !== 'string') return;
  const log = await loadLog();
  const i = log.findIndex((e) => e.ts === entryTs && e.kind === 'avoid');
  if (i < 0 || log[i].outcome) return; // already answered (e.g. seen again on launch)
  log[i] = { ...log[i], outcome };
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log));
  await refreshWidget();
}

// Module scope so it's registered even when iOS wakes the app in the
// background just to deliver the button tap.
Notifications.addNotificationResponseReceivedListener((r) => {
  handleAlertAnswer(r).catch(() => {});
});
// A tap that launched the app before the listener existed.
Notifications.getLastNotificationResponseAsync()
  .then((r) => r && handleAlertAnswer(r))
  .catch(() => {});

// ------------------------------------------------------------
// Runs in the background when iOS reports a region event. Must be defined at
// module scope, so this file is imported from the root layout.
// ------------------------------------------------------------
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: { data: any; error: any }) => {
  if (error) {
    console.log('Geofence task error:', error);
    return;
  }
  if (!data) return;
  const id: string | undefined = data.region?.identifier;
  if (!id) return;

  const presence = await loadPresence();
  const now = new Date();

  if (data.eventType === Location.GeofencingEventType.Exit) {
    presence[id] = { inside: false, since: now.toISOString() };
    await savePresence(presence);
    return;
  }
  if (data.eventType !== Location.GeofencingEventType.Enter) return;

  const fences = await loadFences();
  const fence = fences.find((f) => f.id === id);
  if (!fence) return;

  const lastEntry = (await loadLog()).find((e) => e.fenceId === id)?.ts ?? null;
  const decision = decideEnter(presence, id, lastEntry, now);
  presence[id] = { inside: true, since: presence[id]?.inside ? presence[id].since : now.toISOString() };
  await savePresence(presence);
  if (decision !== 'arrival') return;

  const pos = await currentPosition();
  await handleArrival(fence, now, pos ? pointInPolygon(pos, fence.polygon) : null);
});

// What a real arrival does: nudge (or open a routine), then log it. Shared
// by the geofence task and Monitor's "Arrive at …" test.
async function handleArrival(fence: Fence, now: Date, insidePolygon: boolean | null, simulated = false) {
  // Buzz on the circle entry regardless: a missed nudge is worse than an early
  // one for this test. The polygon check is logged so we can see how often the
  // circle fires before you're actually inside the shape.
  const entryTs = now.toISOString();
  // Log first so an instant tap on the alert's buttons finds its entry.
  await appendLog({
    ts: entryTs,
    fenceId: fence.id,
    name: fence.name,
    kind: fence.kind,
    insidePolygon,
    ...(simulated ? { simulated: true } : {}),
  });

  if (fence.kind === 'avoid') {
    await buzz(`Hey — you wanted to skip ${fence.name}.`, "There's food at home. Want to pause for a second?", {
      category: STAY_OUT_CATEGORY,
      data: { entryTs },
    });
  } else if (fence.habits?.length) {
    // Tapping opens the checklist (see useNotificationLinks in the root layout).
    await startRun(fence.id, now);
    const n = fence.habits.length;
    await buzz(`${fence.name} routine`, `${n} ${n === 1 ? 'step' : 'steps'}, starting with ${fence.habits[0].title}.`, {
      data: { url: `/routine/${fence.id}` },
    });
  } else {
    await buzz(`You made it to ${fence.name}.`, 'Nice. That counts.');
  }
}

// Test hook: act as if you just arrived at this fence. Skips the presence
// check on purpose so it always counts.
export async function simulateArrival(fence: Fence): Promise<void> {
  await handleArrival(fence, new Date(), true, true);
}
