import { ExtensionStorage } from '@bacons/apple-targets';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { dailyScores } from './analytics';
import type { Fence, LogEntry } from './fences';
import type { RoutineRun } from './routines';

// "group.<bundle id>", so Sentry and Sentry Dev each get their own (see
// app.config.js). The widget derives the same value from its bundle ID.
const APP_GROUP = `group.${Application.applicationId ?? 'com.giosferrazza.sentryspike'}`;
const DAY_MS = 86_400_000;
const ENTRY_WINDOW_MS = 8 * DAY_MS; // for the "Last: …" line
// Daily tallies for the heatmap (15 weeks) and the score (this + last week).
const HISTORY_DAYS = 15 * 7 + 7;

let storage: ExtensionStorage | null = null;

// Hand the home screen widget a compact snapshot and ask iOS to redraw it.
// The widget buckets entries into days itself so it rolls over at midnight.
export function syncWidget(log: LogEntry[], fences: Fence[], monitoring: boolean, runs: RoutineRun[]): void {
  if (Platform.OS !== 'ios') return;
  try {
    storage ??= new ExtensionStorage(APP_GROUP);
    const valid = log.filter((e) => e.kind === 'avoid' || e.kind === 'seek');
    const cutoff = Date.now() - ENTRY_WINDOW_MS;
    const entries = valid
      .filter((e) => Date.parse(e.ts) >= cutoff)
      .map((e) => ({ ts: Date.parse(e.ts), kind: e.kind, name: e.name }));

    // Keyed by local midnight (epoch ms) so the widget can bucket by day.
    const since = Date.now() - HISTORY_DAYS * DAY_MS;
    // s/a = go-here/stay-out visits (heatmap); w/l = wins/slips (Life Score).
    const byDay = new Map<number, { t: number; s: number; a: number; w: number; l: number }>();
    for (const e of valid) {
      const d = new Date(e.ts);
      if (d.getTime() < since) continue;
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const c = byDay.get(t) ?? { t, s: 0, a: 0, w: 0, l: 0 };
      if (e.kind === 'seek') c.s++;
      else c.a++;
      byDay.set(t, c);
    }

    for (const [t, d] of dailyScores(log, runs, fences)) {
      if (t < since) continue;
      const c = byDay.get(t) ?? { t, s: 0, a: 0, w: 0, l: 0 };
      c.w = d.wins;
      c.l = d.slips;
      byDay.set(t, c);
    }

    storage.set(
      'snapshot',
      JSON.stringify({ monitoring, fenceCount: fences.length, entries, days: [...byDay.values()] })
    );
    ExtensionStorage.reloadWidget();
  } catch (e) {
    // Never let the widget break the app (e.g. native module missing in a dev client).
    console.log('widget sync failed', e);
  }
}
