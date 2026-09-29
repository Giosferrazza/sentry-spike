import AsyncStorage from '@react-native-async-storage/async-storage';

// Arrival routines: a "go here" fence can carry an ordered habit list
// (Fence.habits). Each real arrival starts a run; checking habits off marks
// them done for that run.

export type Habit = { id: string; title: string };

export type RoutineRun = {
  id: string;
  fenceId: string;
  startedAt: string; // arrival time, or when you first opened it by hand
  done: string[]; // habit ids
};

const RUNS_KEY = 'sentry-routine-runs';
const MAX_RUNS = 200;
// A run stays "current" this long after arrival; later opens start a new one.
export const RUN_WINDOW_MS = 12 * 3_600_000;

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function loadRuns(): Promise<RoutineRun[]> {
  const raw = await AsyncStorage.getItem(RUNS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveRuns(runs: RoutineRun[]): Promise<void> {
  await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
}

export function currentRun(runs: RoutineRun[], fenceId: string, now = new Date()): RoutineRun | null {
  const run = runs.find((r) => r.fenceId === fenceId);
  return run && now.getTime() - Date.parse(run.startedAt) < RUN_WINDOW_MS ? run : null;
}

export async function startRun(fenceId: string, now = new Date()): Promise<RoutineRun> {
  const runs = await loadRuns();
  const existing = currentRun(runs, fenceId, now);
  if (existing) return existing;
  const run: RoutineRun = { id: newId('run'), fenceId, startedAt: now.toISOString(), done: [] };
  await saveRuns([run, ...runs]);
  return run;
}

// Toggle a habit in the fence's current run, starting one if needed.
export async function toggleHabit(fenceId: string, habitId: string): Promise<RoutineRun> {
  const run = await startRun(fenceId);
  const runs = await loadRuns();
  const next = runs.map((r) =>
    r.id !== run.id
      ? r
      : { ...r, done: r.done.includes(habitId) ? r.done.filter((h) => h !== habitId) : [...r.done, habitId] }
  );
  await saveRuns(next);
  return next.find((r) => r.id === run.id)!;
}
