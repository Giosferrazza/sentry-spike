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
export function byDay(
  log: LogEntry[],
  days = 14,
  now = new Date(),
  labels: 'date' | 'weekday' = 'date'
): Bucket[] {
  const today = startOfDay(now);
  const buckets: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today - i * DAY_MS);
    buckets.push({
      label:
        i === 0
          ? 'Today'
          : labels === 'weekday'
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
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

// ---------------------------------------------------------------------------
// Life score: of this week's fence visits, what share were "go here" places?
// Laplace-smoothed (+1 / +2) so no visits reads as a neutral 50 and one visit
// can't swing it to 0 or 100.

export type LifeScore = {
  score: number; // 0-100
  band: 'Thriving' | 'On track' | 'Mixed' | 'Rough week';
  delta: number | null; // vs the previous 7 days; null if that week had no visits
  seek: number;
  avoid: number;
};

function scoreOf(seek: number, avoid: number): number {
  return Math.round((100 * (seek + 1)) / (seek + avoid + 2));
}

export function bandOf(score: number): LifeScore['band'] {
  return score >= 80 ? 'Thriving' : score >= 60 ? 'On track' : score >= 40 ? 'Mixed' : 'Rough week';
}

export function lifeScore(log: LogEntry[], now = new Date()): LifeScore {
  const today = startOfDay(now);
  const cur = zero();
  const prev = zero();
  for (const e of valid(log)) {
    const age = Math.floor((today - startOfDay(new Date(e.ts))) / DAY_MS);
    if (age >= 0 && age < 7) cur[e.kind]++;
    else if (age >= 7 && age < 14) prev[e.kind]++;
  }
  const score = scoreOf(cur.seek, cur.avoid);
  const prevVisits = prev.seek + prev.avoid;
  return {
    score,
    band: bandOf(score),
    delta: prevVisits ? score - scoreOf(prev.seek, prev.avoid) : null,
    seek: cur.seek,
    avoid: cur.avoid,
  };
}

// The 3-hour window with the most stay-out visits in the last 30 days, e.g.
// "9 PM–12 AM". Null until there are at least 3 visits in one window.
export function peakAvoidWindow(log: LogEntry[], now = new Date()): string | null {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const hours = new Array(24).fill(0);
  for (const e of valid(log)) {
    if (e.kind === 'avoid' && Date.parse(e.ts) >= cutoff) hours[new Date(e.ts).getHours()]++;
  }
  let best = -1;
  let bestCount = 0;
  for (let h = 0; h < 24; h++) {
    const n = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    // On a tie, prefer the window that starts at an actual visit.
    if (n > bestCount || (n === bestCount && n > 0 && hours[h] > 0 && hours[best] === 0)) {
      bestCount = n;
      best = h;
    }
  }
  if (bestCount < 3) return null;
  const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? 'AM' : 'PM'}`;
  return `${fmt(best)}–${fmt((best + 3) % 24)}`;
}

// ---------------------------------------------------------------------------
// GitHub-style history grid: one cell per day, weeks as columns (Sun..Sat),
// ending with the current week. Future days in the current week are flagged.

export type HeatDay = { date: Date; seek: number; avoid: number; future: boolean };

export function heatmap(log: LogEntry[], weeks = 17, now = new Date()): HeatDay[][] {
  const today = startOfDay(now);
  const todayDate = new Date(today);
  // Sunday that starts the first column.
  const start = new Date(todayDate);
  start.setDate(start.getDate() - todayDate.getDay() - (weeks - 1) * 7);

  const counts = new Map<number, KindCounts>();
  for (const e of valid(log)) {
    const k = startOfDay(new Date(e.ts));
    const c = counts.get(k) ?? zero();
    c[e.kind]++;
    counts.set(k, c);
  }

  const grid: HeatDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = date.getTime();
      const c = counts.get(key) ?? zero();
      col.push({ date, seek: c.seek, avoid: c.avoid, future: key > today });
    }
    grid.push(col);
  }
  return grid;
}
