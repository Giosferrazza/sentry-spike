import type { Fence, FenceKind, LogEntry } from './fences';

export type KindCounts = Record<FenceKind, number>;
export type Bucket = { label: string; counts: KindCounts };

export type PlaceStat = {
  fenceId: string;
  name: string;
  kind: FenceKind;
  entries: number;
  inside: number; // fired while inside the drawn shape
  outside: number; // fired on the circle only
  last: string | null;
  deleted: boolean;
};

export type Summary = {
  last7: number;
  prior7: number;
  avoid7: number;
  seek7: number;
  // Share of fires where the phone was already inside the drawn shape.
  // null until at least one fire has a position fix.
  shapeHitRate: number | null;
};

const DAY_MS = 86_400_000;
const zero = (): KindCounts => ({ avoid: 0, seek: 0 });

// Entries from the old single-fence spike have no kind; skip them.
const valid = (log: LogEntry[]) => log.filter((e) => e.kind === 'avoid' || e.kind === 'seek');

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function summarize(log: LogEntry[], now = new Date()): Summary {
  const today = startOfDay(now);
  const s: Summary = { last7: 0, prior7: 0, avoid7: 0, seek7: 0, shapeHitRate: null };
  let fixes = 0;
  let hits = 0;
  for (const e of valid(log)) {
    const age = Math.floor((today - startOfDay(new Date(e.ts))) / DAY_MS);
    if (age < 7) {
      s.last7++;
      if (e.kind === 'avoid') s.avoid7++;
      else s.seek7++;
    } else if (age < 14) {
      s.prior7++;
    }
    if (e.insidePolygon !== null && e.insidePolygon !== undefined) {
      fixes++;
      if (e.insidePolygon) hits++;
    }
  }
  s.shapeHitRate = fixes ? hits / fixes : null;
  return s;
}

// One bucket per calendar day, oldest first, ending today.
export function byDay(log: LogEntry[], days = 14, now = new Date()): Bucket[] {
  const today = startOfDay(now);
  const buckets: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today - i * DAY_MS);
    buckets.push({
      label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      counts: zero(),
    });
  }
  for (const e of valid(log)) {
    const age = Math.round((today - startOfDay(new Date(e.ts))) / DAY_MS);
    if (age >= 0 && age < days) buckets[days - 1 - age].counts[e.kind]++;
  }
  return buckets;
}

export function byHour(log: LogEntry[]): Bucket[] {
  const buckets: Bucket[] = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), counts: zero() }));
  for (const e of valid(log)) buckets[new Date(e.ts).getHours()].counts[e.kind]++;
  return buckets;
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

// Every current fence (even with zero entries) plus any deleted fence that
// still has log history. Busiest first.
export function byPlace(log: LogEntry[], fences: Fence[]): PlaceStat[] {
  const map = new Map<string, PlaceStat>();
  for (const f of fences) {
    map.set(f.id, {
      fenceId: f.id, name: f.name, kind: f.kind,
      entries: 0, inside: 0, outside: 0, last: null, deleted: false,
    });
  }
  for (const e of valid(log)) {
    let p = map.get(e.fenceId);
    if (!p) {
      p = {
        fenceId: e.fenceId, name: e.name, kind: e.kind,
        entries: 0, inside: 0, outside: 0, last: null, deleted: true,
      };
      map.set(e.fenceId, p);
    }
    p.entries++;
    if (e.insidePolygon === true) p.inside++;
    if (e.insidePolygon === false) p.outside++;
    if (!p.last || e.ts > p.last) p.last = e.ts;
  }
  return [...map.values()].sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
}

// Clean axis max for small integer counts: 1, 2, 4, 5, 10, 20, 25, 50...
export function niceMax(n: number): number {
  if (n <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 4, 5, 10]) {
    const v = m * pow;
    if (v >= n && Number.isInteger(v)) return v;
  }
  return 10 * pow;
}
