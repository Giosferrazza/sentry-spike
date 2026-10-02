import * as Linking from 'expo-linking';

import LiveActivity, { type LiveActivityState } from '../../modules/live-activity/src/LiveActivityModule';
import type { InterventionSession } from './interventions';

// Mirrors an intervention session onto the Lock Screen / Dynamic Island.
// UI: targets/widget/live-activity.swift. Native bridge: modules/live-activity.

const LEFT_LINGER_S = 15 * 60; // keep "Boundary kept" up for a bit
const OPEN_MS = 6 * 3_600_000;

// Deep links carry the right scheme for Sentry vs Sentry Dev.
const link = (id: string, action?: 'timer' | 'okay') =>
  Linking.createURL(`intervention/${id}`, action ? { queryParams: { action } } : undefined);

function stateOf(s: InterventionSession): LiveActivityState {
  const approaching = (s.stage ?? 'arrived') === 'approach';
  const phase = s.exitedAt
    ? 'left'
    : s.outcome === 'stayed'
      ? 'stayed'
      : s.timer
        ? 'timer'
        : approaching
          ? 'approach'
          : 'arrived';
  const lastBuddy = [...s.messages].reverse().find((m) => m.role === 'buddy' && !m.crisis)?.text;
  const message =
    phase === 'left'
      ? approaching
        ? 'You turned around. That counts as a win.'
        : 'You left. Boundary kept, and your streak holds.'
      : phase === 'stayed'
        ? "Time's up and you're still here. No judgment. What's next?"
        : phase === 'timer'
          ? 'Head for the door. Leave before the timer ends to keep your streak.'
          : (lastBuddy ?? 'You chose to avoid this place. Want help getting out?');
  return {
    phase,
    enteredAt: Date.parse(s.enteredAt),
    timerStartedAt: s.timer ? Date.parse(s.timer.startedAt) : undefined,
    timerEndsAt: s.timer ? Date.parse(s.timer.endsAt) : undefined,
    message: message.length > 120 ? `${message.slice(0, 117)}…` : message,
    streakDays: s.streakDays ?? 0,
  };
}

export async function syncLiveActivity(s: InterventionSession): Promise<void> {
  if (!LiveActivity) return; // build without the native module
  try {
    if (s.outcome === 'dismissed' || (s.exitedAt && !s.streakKept)) {
      await LiveActivity.end(s.id, null, 0);
    } else if (s.exitedAt) {
      await LiveActivity.end(s.id, stateOf(s), LEFT_LINGER_S);
    } else if (Date.now() - Date.parse(s.enteredAt) > OPEN_MS) {
      await LiveActivity.end(s.id, null, 0);
    } else {
      await LiveActivity.start(
        {
          interventionId: s.id,
          placeName: s.placeName,
          openUrl: link(s.id),
          timerUrl: link(s.id, 'timer'),
          okayUrl: link(s.id, 'okay'),
        },
        stateOf(s)
      );
    }
  } catch {
    // iOS only starts Live Activities while the app is in the foreground; the
    // Intervention screen syncs again when it opens.
  }
}
