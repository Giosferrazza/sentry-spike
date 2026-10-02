import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { syncLiveActivity } from './live-activity';
import { newId } from './routines';

// An intervention session: one stay-out arrival and everything that happened
// while Sentry tried to help you leave. Kept per place (placeId) so it can be
// shown in place history later.

export type InterventionOutcome = 'left' | 'stayed' | 'dismissed' | 'unknown';

export type InterventionAction =
  | 'opened'
  | 'help-leave'
  | 'struggling'
  | 'remind-why'
  | 'timer-start'
  | 'timer-expired'
  | 'contact-buddy'
  | 'find-go-here'
  | 'im-okay'
  | 'crisis-shown'
  | 'crisis-call';

export type ChatMessage = {
  id: string;
  role: 'buddy' | 'user';
  text: string;
  at: string;
  // Buddy messages can offer follow-up actions as buttons.
  suggestions?: SuggestedAction[];
  crisis?: boolean;
};

export type SuggestedAction = 'timer' | 'buddy' | 'go-here' | 'remind-why' | 'okay';

export type InterventionSession = {
  id: string;
  placeId: string; // fence id
  placeName: string;
  // approach: inside the outer warning ring, not at the place yet.
  // arrived: inside the place (a LogEntry exists). Missing = arrived (older data).
  stage?: 'approach' | 'arrived';
  approachedAt?: string;
  entryTs: string; // the LogEntry.ts this session belongs to ('' while approaching)
  enteredAt: string; // arrival time (or approach time while stage is approach)
  exitedAt: string | null;
  durationMs: number | null; // enteredAt -> exitedAt
  messages: ChatMessage[];
  actions: { type: InterventionAction; at: string }[];
  outcome: InterventionOutcome;
  aiStarted: boolean;
  timer: { startedAt: string; endsAt: string; notificationId: string | null } | null;
  // Leaving counted as a win (log entry marked "skipped"), so the streak holds.
  streakKept: boolean;
  // Stay-out days clean before this visit (the streak at stake).
  streakDays?: number;
};

const KEY = 'sentry-interventions';
const MAX_SESSIONS = 300;
export const EXIT_TIMER_MS = 10 * 60_000;
// Leaving this soon after arriving counts as a win even without a timer.
export const QUICK_EXIT_MS = 10 * 60_000;
// A session stays "open" (tracked for exits) at most this long.
const OPEN_MS = 6 * 3_600_000;

export async function loadInterventions(): Promise<InterventionSession[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveAll(all: InterventionSession[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX_SESSIONS)));
}

export async function loadIntervention(id: string): Promise<InterventionSession | null> {
  return (await loadInterventions()).find((s) => s.id === id) ?? null;
}

// For place history later.
export async function interventionsFor(placeId: string): Promise<InterventionSession[]> {
  return (await loadInterventions()).filter((s) => s.placeId === placeId);
}

export async function updateIntervention(
  id: string,
  fn: (s: InterventionSession) => InterventionSession
): Promise<InterventionSession | null> {
  const all = await loadInterventions();
  const i = all.findIndex((s) => s.id === id);
  if (i < 0) return null;
  all[i] = fn(all[i]);
  await saveAll(all);
  await syncLiveActivity(all[i]);
  return all[i];
}

export async function createIntervention(
  placeId: string,
  placeName: string,
  entryTs: string,
  streakDays = 0,
  stage: 'approach' | 'arrived' = 'arrived',
  at = new Date()
): Promise<InterventionSession> {
  const s: InterventionSession = {
    id: newId('iv'),
    placeId,
    placeName,
    stage,
    ...(stage === 'approach' ? { approachedAt: at.toISOString() } : {}),
    entryTs,
    enteredAt: stage === 'approach' ? at.toISOString() : entryTs,
    exitedAt: null,
    durationMs: null,
    messages: [],
    actions: [],
    outcome: 'unknown',
    aiStarted: false,
    timer: null,
    streakKept: false,
    streakDays,
  };
  await saveAll([s, ...(await loadInterventions())]);
  await syncLiveActivity(s); // only lands if the app is in the foreground
  return s;
}

export const isOpen = (s: InterventionSession, now = Date.now()) =>
  !s.exitedAt && now - Date.parse(s.enteredAt) < OPEN_MS;

export const timerActive = (s: InterventionSession, now = Date.now()) =>
  !!s.timer && !s.exitedAt && now < Date.parse(s.timer.endsAt);

export const withAction = (s: InterventionSession, type: InterventionAction): InterventionSession => ({
  ...s,
  actions: [...s.actions, { type, at: new Date().toISOString() }],
});

// The newest intervention you haven't looked at yet, if it's recent and you're
// still there. Opening Sentry any way (icon, widget) jumps straight to it.
const AUTO_OPEN_MS = 30 * 60_000;
export async function unseenIntervention(): Promise<InterventionSession | null> {
  const s = (await loadInterventions())[0];
  if (!s || s.exitedAt || s.outcome !== 'unknown') return null;
  if (Date.now() - Date.parse(s.enteredAt) > AUTO_OPEN_MS) return null;
  return s.actions.some((a) => a.type === 'opened') ? null : s;
}

// Sessions whose exit timer is running: the verifier keeps precise GPS on for these.
export async function activeTimers(): Promise<InterventionSession[]> {
  const now = Date.now();
  return (await loadInterventions()).filter((s) => timerActive(s, now));
}

export async function startExitTimer(id: string): Promise<InterventionSession | null> {
  const s = await loadIntervention(id);
  if (!s || s.exitedAt) return s;
  if (s.timer?.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(s.timer.notificationId).catch(() => {});
  }
  const now = new Date();
  const endsAt = new Date(now.getTime() + EXIT_TIMER_MS);
  // If you're still there when it ends, this brings you back to the screen.
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      interruptionLevel: 'timeSensitive',
      title: `Still at ${s.placeName}?`,
      body: "Your 10 minutes are up. Let's figure out the next step.",
      sound: true,
      data: { url: `/intervention/${s.id}` },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt },
  }).catch(() => null);
  return updateIntervention(id, (x) =>
    withAction(
      { ...x, timer: { startedAt: now.toISOString(), endsAt: endsAt.toISOString(), notificationId } },
      'timer-start'
    )
  );
}

// The timer ran out while you were still inside.
export async function markStayed(id: string): Promise<InterventionSession | null> {
  return updateIntervention(id, (s) =>
    s.outcome === 'unknown' && !s.exitedAt ? withAction({ ...s, outcome: 'stayed' }, 'timer-expired') : s
  );
}

export async function dismissIntervention(id: string): Promise<InterventionSession | null> {
  return updateIntervention(id, (s) =>
    withAction({ ...s, outcome: s.outcome === 'unknown' ? 'dismissed' : s.outcome }, 'im-okay')
  );
}

export const stageOf = (s: InterventionSession) => s.stage ?? 'arrived';

// The open approach session for a place, so arriving continues it instead of
// starting over.
export async function openApproach(placeId: string): Promise<InterventionSession | null> {
  const now = Date.now();
  return (
    (await loadInterventions()).find(
      (s) => s.placeId === placeId && stageOf(s) === 'approach' && isOpen(s, now) && s.outcome !== 'dismissed'
    ) ?? null
  );
}

// You kept going and arrived: the approach session becomes the visit.
export async function promoteToArrival(id: string, entryTs: string): Promise<InterventionSession | null> {
  return updateIntervention(id, (s) => ({ ...s, stage: 'arrived', entryTs, enteredAt: entryTs }));
}

// You left the place (stage 'arrived'), or turned around inside the warning
// ring before reaching it (stage 'approach'). Returns the sessions that ended
// and whether each counts as a win: turning around always does; leaving does
// if it was before the timer ran out, or soon after arriving.
export async function recordExit(
  placeId: string,
  at = new Date(),
  stage: 'approach' | 'arrived' = 'arrived'
): Promise<{ session: InterventionSession; win: boolean }[]> {
  const all = await loadInterventions();
  const ended: { session: InterventionSession; win: boolean }[] = [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (s.placeId !== placeId || stageOf(s) !== stage || !isOpen(s, at.getTime())) continue;
    const t = at.getTime();
    const win =
      stage === 'approach' ||
      (s.timer ? t <= Date.parse(s.timer.endsAt) : t - Date.parse(s.enteredAt) <= QUICK_EXIT_MS);
    if (s.timer?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(s.timer.notificationId).catch(() => {});
    }
    all[i] = {
      ...s,
      exitedAt: at.toISOString(),
      durationMs: t - Date.parse(s.enteredAt),
      // "I'm okay" and a timer that ran out are kept; otherwise you left.
      outcome: s.outcome === 'unknown' ? 'left' : s.outcome,
      streakKept: win,
    };
    ended.push({ session: all[i], win });
  }
  if (ended.length) await saveAll(all);
  for (const { session } of ended) await syncLiveActivity(session);
  return ended;
}
