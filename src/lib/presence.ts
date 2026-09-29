// Decides whether a geofence "enter" is a real arrival.
//
// iOS re-reports every region you're already inside whenever monitoring
// (re)starts: on app launch and whenever fences are saved. Without this,
// sitting at home and opening the app logs a fresh check-in each time.

export type Presence = Record<string, { inside: boolean; since: string }>;

// GPS drift at a fence edge can produce exit+enter pairs a few minutes apart.
export const REENTRY_COOLDOWN_MS = 30 * 60_000;

export type EnterDecision = 'arrival' | 'already-inside' | 'cooldown';

export function decideEnter(
  presence: Presence,
  fenceId: string,
  lastEntryTs: string | null,
  now: Date
): EnterDecision {
  if (presence[fenceId]?.inside) return 'already-inside';
  if (lastEntryTs && now.getTime() - Date.parse(lastEntryTs) < REENTRY_COOLDOWN_MS) return 'cooldown';
  return 'arrival';
}
