import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';

import type { Fence, LogEntry } from './fences';

// Must match appGroup in targets/widget/widgets.swift and app.json.
const APP_GROUP = 'group.com.giosferrazza.sentryspike';
const WINDOW_MS = 8 * 86_400_000; // widget shows 7 days; 8 covers timezone edges

let storage: ExtensionStorage | null = null;

// Hand the home screen widget a compact snapshot and ask iOS to redraw it.
// The widget buckets entries into days itself so it rolls over at midnight.
export function syncWidget(log: LogEntry[], fences: Fence[], monitoring: boolean): void {
  if (Platform.OS !== 'ios') return;
  try {
    storage ??= new ExtensionStorage(APP_GROUP);
    const cutoff = Date.now() - WINDOW_MS;
    const entries = log
      .filter((e) => (e.kind === 'avoid' || e.kind === 'seek') && Date.parse(e.ts) >= cutoff)
      .map((e) => ({ ts: Date.parse(e.ts), kind: e.kind, name: e.name }));
    storage.set('snapshot', JSON.stringify({ monitoring, fenceCount: fences.length, entries }));
    ExtensionStorage.reloadWidget();
  } catch (e) {
    // Never let the widget break the app (e.g. native module missing in a dev client).
    console.log('widget sync failed', e);
  }
}
