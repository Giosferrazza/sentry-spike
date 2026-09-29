// Small native chart kit for the Insights tab. Plain Views, no chart library.
// Specs follow the dataviz rules: marks <= 24px, 4px rounded data-end and
// square at the baseline, 2px surface gap between stacked segments, hairline
// solid gridlines, text in text tokens (never the series color).

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Bucket, PlaceStat } from '@/lib/analytics';
import { niceMax } from '@/lib/analytics';
import { FenceKind, KIND_COLORS, KIND_LABELS } from '@/lib/fences';

export const Ink = {
  surface: '#161922',
  primary: '#f3f5f8',
  secondary: '#8b93a3',
  muted: '#5a6172',
  grid: '#262b38',
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

export function StatTile({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
      {delta ? <Text style={s.tileDelta}>{delta}</Text> : null}
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

      {/* Labels are wider than a slot, so each is centered on its slot and
          allowed to overhang; the first and last hug the plot edges. */}
      <View style={s.xAxis}>
        {ticks.map((i) => {
          const bk = buckets[i];
          const n = buckets.length;
          const last = i === n - 1;
          const edge = i === 0 ? { left: 0 } : last ? { right: 0 } : null;
          return (
            <View
              key={i}
              style={[s.xTickBox, edge ?? { left: `${((i + 0.5) / n) * 100}%`, marginLeft: -30 }]}>
              <Text style={[s.xTick, { textAlign: i === 0 ? 'left' : last ? 'right' : 'center' }]}>
                {bk.label}
              </Text>
            </View>
          );
        })}
      </View>
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

  tile: {
    flex: 1,
    backgroundColor: Ink.surface,
    borderRadius: 14,
    padding: 14,
    gap: 2,
  },
  tileLabel: { color: Ink.secondary, fontSize: 12 },
  tileValue: { color: Ink.primary, fontSize: 26, fontWeight: '700' },
  tileDelta: { color: Ink.muted, fontSize: 12 },

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
