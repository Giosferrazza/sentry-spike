// Small native chart kit for the Insights tab. Plain Views, no chart library.
// Specs follow the dataviz rules: marks <= 24px, 4px rounded data-end and
// square at the baseline, 2px surface gap between stacked segments, hairline
// solid gridlines, text in text tokens (never the series color).

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C } from '@/constants/ui';
import type { Bucket, HeatDay, PlaceStat } from '@/lib/analytics';
import { niceMax } from '@/lib/analytics';
import { FenceKind, KIND_COLORS, KIND_LABELS } from '@/lib/fences';

const Ink = {
  surface: C.surface,
  primary: C.text,
  secondary: C.textSecondary,
  muted: C.textMuted,
  grid: C.line,
};

// Stack order bottom -> top.
const STACK: FenceKind[] = ['seek', 'avoid'];

export function Legend() {
  return (
    <View style={s.legend}>
      {STACK.map((k) => (
        <View key={k} style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: KIND_COLORS[k] }]} />
          <Text style={s.legendText}>{KIND_LABELS[k]}</Text>
        </View>
      ))}
    </View>
  );
}

// Stacked columns with tap-to-inspect (the touch version of a hover tooltip).
// The readout sits in a fixed row above the plot so it can never clip.
export function StackedColumns({
  buckets,
  height = 140,
  ticks,
  idle,
}: {
  buckets: Bucket[];
  height?: number;
  ticks: number[]; // bucket indices that get an x-axis label
  idle: string; // readout text when nothing is selected
}) {
  const [sel, setSel] = useState<number | null>(null);
  const totals = buckets.map((b) => b.counts.avoid + b.counts.seek);
  const max = niceMax(Math.max(...totals));
  const b = sel !== null ? buckets[sel] : null;

  return (
    <View>
      <View style={s.readout}>
        {b ? (
          <>
            <Text style={s.readoutTitle}>{b.label}</Text>
            {STACK.slice()
              .reverse()
              .map((k) => (
                <View key={k} style={s.legendItem}>
                  <View style={[s.swatch, { backgroundColor: KIND_COLORS[k] }]} />
                  <Text style={s.readoutText}>
                    {b.counts[k]} {KIND_LABELS[k].toLowerCase()}
                  </Text>
                </View>
              ))}
          </>
        ) : (
          <Text style={s.readoutIdle}>{idle}</Text>
        )}
      </View>

      <View style={s.plotRow}>
        <View style={[s.yAxis, { height }]}>
          <Text style={s.tick}>{max}</Text>
          <Text style={s.tick}>{max / 2 === Math.floor(max / 2) ? max / 2 : ''}</Text>
          <Text style={s.tick}>0</Text>
        </View>

        <View style={{ flex: 1, height }}>
          {[0, 0.5, 1].map((f) => (
            <View key={f} style={[s.gridline, { top: f * (height - 1) }]} />
          ))}
          <View style={s.columns}>
            {buckets.map((bk, i) => (
              <Pressable
                key={i}
                style={s.slot}
                onPress={() => setSel(sel === i ? null : i)}
                accessibilityLabel={`${bk.label}: ${bk.counts.avoid} stay out, ${bk.counts.seek} go here`}>
                <View style={[s.column, sel !== null && sel !== i && s.dimmed]}>
                  {/* Views lay out top-down, so render the stack top segment first. */}
                  {STACK.map((k, si) => {
                    const n = bk.counts[k];
                    if (!n) return null;
                    const isTop = STACK.slice(si + 1).every((kk) => !bk.counts[kk]);
                    return { k, n, isTop };
                  })
                    .reverse()
                    .map((seg) => {
                      if (!seg) return null;
                      const { k, n, isTop } = seg;
                      return (
                        <View
                          key={k}
                          style={{
                            height: Math.max(2, (n / max) * height - (isTop ? 0 : 2)),
                            marginTop: isTop ? 0 : 2,
                            backgroundColor: KIND_COLORS[k],
                            borderTopLeftRadius: isTop ? 4 : 0,
                            borderTopRightRadius: isTop ? 4 : 0,
                          }}
                        />
                      );
                    })}
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <XAxis labels={buckets.map((bk) => bk.label)} ticks={ticks} />
    </View>
  );
}

// Labels are wider than a slot, so each is centered on its slot and allowed to
// overhang; the first and last hug the plot edges.
function XAxis({ labels, ticks }: { labels: string[]; ticks: number[] }) {
  const n = labels.length;
  return (
    <View style={s.xAxis}>
      {ticks.map((i) => {
        const last = i === n - 1;
        const edge = i === 0 ? { left: 0 } : last ? { right: 0 } : null;
        return (
          <View key={i} style={[s.xTickBox, edge ?? { left: `${((i + 0.5) / n) * 100}%`, marginLeft: -30 }]}>
            <Text style={[s.xTick, { textAlign: i === 0 ? 'left' : last ? 'right' : 'center' }]}>
              {labels[i]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// A week of daily go-here vs stay-out visit counts as two lines.
// Lines are drawn from rotated Views (no SVG).

export function WeekTrends({ buckets, ticks, idle }: { buckets: Bucket[]; ticks: number[]; idle: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const [w, setW] = useState(0);
  const n = buckets.length;
  const max = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.counts.seek, b.counts.avoid))));
  const x = (i: number) => ((i + 0.5) / n) * w;
  const b = sel !== null ? buckets[sel] : null;

  const panel = (
    height: number,
    top: number,
    series: { color: string; values: number[] }[],
    gridLabels: string[]
  ) => (
    <View style={s.plotRow}>
      <View style={[s.yAxis, { height }]}>
        {gridLabels.map((t, i) => (
          <Text key={i} style={s.tick}>
            {t}
          </Text>
        ))}
      </View>
      <View style={{ flex: 1, height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {[0, 0.5, 1].map((f) => (
          <View key={f} style={[s.gridline, { top: f * (height - 1) }]} />
        ))}
        {sel !== null && w > 0 && <View style={[s.crosshair, { left: x(sel) - 0.5 }]} />}
        {w > 0 &&
          series.map(({ color, values }) => {
            const pts = values.map((v, i) => ({
              x: x(i),
              y: PAD + (1 - v / top) * (height - 2 * PAD),
            }));
            return (
              <React.Fragment key={color}>
                {pts.slice(1).map((p, i) => (
                  <Segment key={i} from={pts[i]} to={p} color={color} />
                ))}
                {pts.map((p, i) => (
                  <View
                    key={`d${i}`}
                    style={[
                      s.marker,
                      { left: p.x - 5, top: p.y - 5, backgroundColor: color },
                      sel === i && s.markerOn,
                    ]}
                  />
                ))}
              </React.Fragment>
            );
          })}
        <View style={s.columns}>
          {buckets.map((bk, i) => (
            <Pressable
              key={i}
              style={{ flex: 1 }}
              onPress={() => setSel(sel === i ? null : i)}
              accessibilityLabel={`${bk.label}: ${bk.counts.seek} go here, ${bk.counts.avoid} stay out`}
            />
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <View>
      <View style={s.readout}>
        {b ? (
          <>
            <Text style={s.readoutTitle}>{b.label}</Text>
            {STACK.map((k) => (
              <View key={k} style={s.legendItem}>
                <View style={[s.swatch, { backgroundColor: KIND_COLORS[k] }]} />
                <Text style={s.readoutText}>
                  {b.counts[k]} {KIND_LABELS[k].toLowerCase()}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={s.readoutIdle}>{idle}</Text>
        )}
      </View>

      {panel(
        90,
        max,
        STACK.map((k) => ({
          color: KIND_COLORS[k],
          values: buckets.map((bk) => bk.counts[k]),
        })),
        [String(max), max % 2 === 0 ? String(max / 2) : '', '0']
      )}
      <XAxis labels={buckets.map((bk) => bk.label)} ticks={ticks} />
    </View>
  );
}

const PAD = 5; // keeps markers at the extremes inside the plot

function Segment({
  from,
  to,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return (
    <View
      style={{
        position: 'absolute',
        left: (from.x + to.x) / 2 - len / 2,
        top: (from.y + to.y) / 2 - 1,
        width: len,
        height: 2,
        borderRadius: 1,
        backgroundColor: color,
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

// GitHub-style history. Diverging by the day's balance: blue = more go-here
// visits, orange = more stay-out, neutral gray = even, empty = no visits.
// Two steps per arm, the lighter one mixed halfway toward the surface.
// Shared diverging scale (stay-out orange-red -> neutral gray -> go-here blue);
// the Life Score dial uses it too.
export const HEAT = {
  seek2: KIND_COLORS.seek,
  seek1: '#275083',
  even: '#454b5a',
  avoid1: '#773924',
  avoid2: KIND_COLORS.avoid,
  empty: '#1d212c',
};

function heatColor(d: HeatDay): string {
  if (d.seek + d.avoid === 0) return HEAT.empty;
  const net = d.seek - d.avoid;
  if (net === 0) return HEAT.even;
  if (net > 0) return net >= 2 ? HEAT.seek2 : HEAT.seek1;
  return -net >= 2 ? HEAT.avoid2 : HEAT.avoid1;
}

const GAP = 3;
const DAY_LABEL_W = 18;

export function Heatmap({
  grid,
  idle,
  onSelect,
}: {
  grid: HeatDay[][];
  idle: string;
  // Called with the tapped day, or null when the selection is cleared.
  onSelect?: (day: Date | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<HeatDay | null>(null);
  const weeks = grid.length;
  const cell = width ? Math.floor((width - DAY_LABEL_W - GAP * (weeks - 1)) / weeks) : 0;

  // Month label at each column where the month changes (skip one crammed
  // against the next).
  const months: { col: number; label: string }[] = [];
  grid.forEach((col, w) => {
    const m = col[0].date.getMonth();
    if (w === 0 || m !== grid[w - 1][0].date.getMonth()) {
      months.push({
        col: w,
        label: col[0].date.toLocaleDateString(undefined, { month: 'short' }),
      });
    }
  });
  const monthLabels = months.filter((m, i) => !(i === 0 && months[1] && months[1].col - m.col < 3));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={s.readout}>
        {sel ? (
          <>
            <Text style={s.readoutTitle}>
              {sel.date.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
            <Text style={s.readoutText}>
              {sel.seek + sel.avoid === 0 ? 'No visits' : `${sel.seek} go here · ${sel.avoid} stay out`}
            </Text>
          </>
        ) : (
          <Text style={s.readoutIdle}>{idle}</Text>
        )}
      </View>

      {cell > 0 && (
        <>
          <View style={{ height: 14, marginLeft: DAY_LABEL_W }}>
            {monthLabels.map((m) => (
              <Text key={m.col} style={[s.heatMonth, { left: m.col * (cell + GAP) }]}>
                {m.label}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <View style={{ width: DAY_LABEL_W, gap: GAP }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => (
                <Text key={i} style={[s.heatDay, { height: cell, lineHeight: cell }]}>
                  {l}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: GAP }}>
              {grid.map((col, w) => (
                <View key={w} style={{ gap: GAP }}>
                  {col.map((d, i) => (
                    <Pressable
                      key={i}
                      disabled={d.future}
                      onPress={() => {
                        const next = sel && sel.date.getTime() === d.date.getTime() ? null : d;
                        setSel(next);
                        onSelect?.(next ? next.date : null);
                      }}
                      accessibilityLabel={`${d.date.toDateString()}: ${d.seek} go here, ${d.avoid} stay out`}
                      style={{
                        width: cell,
                        height: cell,
                        borderRadius: 3,
                        backgroundColor: d.future ? 'transparent' : heatColor(d),
                        borderWidth: sel && sel.date.getTime() === d.date.getTime() ? 1.5 : 0,
                        borderColor: Ink.primary,
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
          <View style={s.heatLegend}>
            <Text style={s.legendText}>Stay out</Text>
            {[HEAT.avoid2, HEAT.avoid1, HEAT.even, HEAT.seek1, HEAT.seek2].map((c) => (
              <View
                key={c}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: c,
                }}
              />
            ))}
            <Text style={s.legendText}>Go here</Text>
          </View>
        </>
      )}
    </View>
  );
}

// Horizontal bars, one per place, value at the tip. Doubles as the table view:
// every number the chart encodes is also printed.
export function PlaceBars({ places }: { places: PlaceStat[] }) {
  const max = Math.max(1, ...places.map((p) => p.entries));
  return (
    <View style={{ gap: 14 }}>
      {places.map((p) => {
        const fixes = p.inside + p.outside;
        return (
          <View key={p.fenceId}>
            <View style={s.placeHead}>
              <View style={[s.swatch, { backgroundColor: KIND_COLORS[p.kind] }]} />
              <Text style={s.placeName} numberOfLines={1}>
                {p.name}
                {p.deleted ? <Text style={s.placeMeta}> (deleted)</Text> : null}
              </Text>
            </View>
            <View style={s.barRow}>
              <View style={s.barTrack}>
                {p.entries > 0 && (
                  <View
                    style={[
                      s.bar,
                      {
                        width: `${(p.entries / max) * 100}%`,
                        backgroundColor: KIND_COLORS[p.kind],
                      },
                    ]}
                  />
                )}
              </View>
              <Text style={s.barValue}>{p.entries}</Text>
            </View>
            <Text style={s.placeMeta}>
              {p.last
                ? `Last ${new Date(p.last).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : 'No entries yet'}
              {fixes > 0 ? ` · inside shape ${p.inside}/${fixes}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: Ink.secondary, fontSize: 13 },

  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 22,
    marginBottom: 8,
  },
  readoutTitle: { color: Ink.primary, fontSize: 13, fontWeight: '700' },
  readoutText: { color: Ink.secondary, fontSize: 13 },
  readoutIdle: { color: Ink.muted, fontSize: 13 },

  plotRow: { flexDirection: 'row', gap: 6 },
  yAxis: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    width: 18,
    marginVertical: -7,
  },
  tick: { color: Ink.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  gridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Ink.grid,
  },
  columns: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  slot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  column: { width: '70%', maxWidth: 24, justifyContent: 'flex-end' },
  dimmed: { opacity: 0.35 },
  xAxis: { height: 14, marginLeft: 24, marginTop: 6 },
  xTickBox: { position: 'absolute', top: 0, width: 60 },
  xTick: { color: Ink.muted, fontSize: 10 },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Ink.secondary,
    opacity: 0.5,
  },
  marker: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: Ink.surface,
  },
  markerOn: { transform: [{ scale: 1.3 }] },

  heatMonth: { position: 'absolute', top: 0, color: Ink.muted, fontSize: 10 },
  heatDay: { color: Ink.muted, fontSize: 9 },
  heatLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 10,
  },
  placeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  placeName: { color: Ink.primary, fontSize: 15, fontWeight: '600', flex: 1 },
  placeMeta: {
    color: Ink.muted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 4,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 14 },
  bar: {
    height: 14,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    minWidth: 4,
  },
  barValue: {
    color: Ink.primary,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
