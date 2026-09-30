import AsyncStorage from '@react-native-async-storage/async-storage';

import { ROUTINES_ENABLED } from '@/constants/features';

import { Fence, FenceKind, loadFences, loadLog, LogEntry, MAX_LOG, refreshWidget, saveFences } from './fences';
import { loadRuns, MAX_RUNS, RoutineRun } from './routines';

// Dev only: backfills enough plausible history to fill the 17-week History
// heatmap (every day has at least one visit), plus Home's charts and Life Score. Entries are tagged
// `simulated` (like Monitor's test arrivals), so "Clear log" removes them.
const DAYS = 17 * 7;
const LOG_KEY = 'sentry-entry-log';
const RUNS_KEY = 'sentry-routine-runs';

const SAMPLE: Record<FenceKind, { name: string; habits?: string[] }> = {
  seek: { name: 'Sample gym', habits: ['Change', 'Warm up', 'Lift', 'Stretch'] },
  avoid: { name: 'Sample bar' },
};

export async function loadSampleHistory(): Promise<{ entries: number; runs: number }> {
  const fences = await ensureFences();
  const seek = fences.filter((f) => f.kind === 'seek');
  const avoid = fences.filter((f) => f.kind === 'avoid');

  const entries: LogEntry[] = [];
  const runs: RoutineRun[] = [];
  for (let age = DAYS; age >= 1; age--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - age);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    // Gets gradually better over the 17 weeks, so trends have a shape.
    const progress = 1 - age / DAYS;

    let nSeek = pick([0, 1, 1, 2, 2, 3]);
    const nAvoid = pick(weekend ? [0, 1, 2, 2] : [0, 0, 1, 1, 2]);
    if (nSeek + nAvoid === 0) nSeek = 1; // no blank days on the heatmap
    for (let i = 0; i < nSeek; i++) {
      const f = seek[Math.floor(Math.random() * seek.length)];
      const ts = at(day, weekend ? 9 : 6, weekend ? 12 : 9);
      entries.push({ ts, fenceId: f.id, name: f.name, kind: 'seek', insidePolygon: true, simulated: true });
      if (ROUTINES_ENABLED && f.habits?.length && Math.random() < 0.8) {
        const done = f.habits.filter(() => Math.random() < 0.55 + 0.4 * progress).map((h) => h.id);
        runs.push({ id: `sample-${ts}`, fenceId: f.id, startedAt: ts, done });
      }
    }
    for (let i = 0; i < nAvoid; i++) {
      const f = avoid[Math.floor(Math.random() * avoid.length)];
      const outcome = Math.random() < 0.3 + 0.4 * progress ? 'skipped' : 'went';
      entries.push({
        ts: at(day, 17, 23),
        fenceId: f.id,
        name: f.name,
        kind: 'avoid',
        insidePolygon: true,
        simulated: true,
        outcome,
      });
    }
  }

  // Merge with what's there (newest first), keeping the storage caps.
  const log = [...(await loadLog()), ...entries].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_LOG);
  const allRuns = [...(await loadRuns()), ...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RUNS);
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log));
  await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(allRuns));
  await refreshWidget();
  return { entries: entries.length, runs: runs.length };
}

// Uses your fences; adds a sample one for any kind you don't have yet, placed
// ~50 km away so it can never actually trigger.
async function ensureFences(): Promise<Fence[]> {
  const fences = await loadFences();
  const base = fences[0]?.center ?? { latitude: 37.7749, longitude: -122.4194 };
  const added = (['seek', 'avoid'] as const)
    .filter((k) => !fences.some((f) => f.kind === k))
    .map((kind, i): Fence => {
      const center = { latitude: base.latitude + 0.45 + i * 0.01, longitude: base.longitude };
      const d = 0.001;
      return {
        id: `sample-${kind}`,
        name: SAMPLE[kind].name,
        kind,
        polygon: [
          { latitude: center.latitude + d, longitude: center.longitude - d },
          { latitude: center.latitude + d, longitude: center.longitude + d },
          { latitude: center.latitude - d, longitude: center.longitude + d },
          { latitude: center.latitude - d, longitude: center.longitude - d },
        ],
        center,
        radius: 150,
        createdAt: new Date().toISOString(),
        habits: SAMPLE[kind].habits?.map((title, j) => ({ id: `sample-${kind}-${j}`, title })),
      };
    });
  if (!added.length) return fences;
  const all = [...fences, ...added];
  await saveFences(all);
  return all;
}

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function at(day: Date, fromHour: number, toHour: number): string {
  const d = new Date(day);
  d.setMinutes(Math.floor((fromHour + Math.random() * (toHour - fromHour)) * 60));
  return d.toISOString();
}
