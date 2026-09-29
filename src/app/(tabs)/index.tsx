import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Heatmap, Legend, StackedColumns } from '@/components/charts';
import { Card, Dot, Icon, Row, Screen } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import { byDay, byPlace, heatmap, lifeScore, peakAvoidWindow } from '@/lib/analytics';
import { Fence, KIND_COLORS, loadFences, loadLog, LogEntry } from '@/lib/fences';
import { loadRuns, RoutineRun } from '@/lib/routines';

const WEEK_TICKS = [0, 1, 2, 3, 4, 5, 6];
const TOP_PLACES = 5;

export default function InsightsScreen() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [fences, setFences] = useState<Fence[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadLog(), loadFences(), loadRuns()]).then(([l, f, r]) => {
        setLog(l);
        setFences(f);
        setRuns(r);
      });
    }, [])
  );

  const life = lifeScore(log, runs, fences);
  const week = byDay(log, 7, new Date(), 'weekday');
  const weekTotal = week.reduce((n, d) => n + d.counts.avoid + d.counts.seek, 0);
  const peak = peakAvoidWindow(log);
  const history = heatmap(log);
  const activeDays = history.flat().filter((d) => d.seek + d.avoid > 0).length;
  const places = byPlace(log, fences)
    .filter((p) => p.entries > 0)
    .slice(0, TOP_PLACES);

  return (
    <Screen title="Insights">
      <LifeScoreCard life={life} />

      <Card title="History">
        <Heatmap
          grid={history}
          idle={activeDays ? `${activeDays} days with visits · tap a day` : 'Your days fill in as you visit fences'}
        />
      </Card>

      <Card title="This week" right={weekTotal > 0 ? <Legend /> : undefined}>
        {weekTotal === 0 ? (
          <Text style={T.caption}>No fence visits in the last 7 days.</Text>
        ) : (
          <>
            <StackedColumns
              buckets={week}
              ticks={WEEK_TICKS}
              height={120}
              idle={`${weekTotal} ${weekTotal === 1 ? 'visit' : 'visits'} · tap a day`}
            />
            {peak ? (
              <View style={styles.pattern}>
                <Icon name="clock" size={14} color={C.textSecondary} weight="regular" />
                <Text style={T.caption}>
                  Most stay-out visits: <Text style={styles.strong}>{peak}</Text>
                </Text>
              </View>
            ) : null}
          </>
        )}
      </Card>

      {places.length > 0 && (
        <Card title="Places" flush>
          {places.map((p, i) => (
            <Row
              key={p.fenceId}
              leading={<Dot color={KIND_COLORS[p.kind]} />}
              title={p.name}
              subtitle={
                p.last
                  ? `Last ${new Date(p.last).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                  : undefined
              }
              trailing={<Text style={styles.count}>{p.entries}</Text>}
              last={i === places.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function LifeScoreCard({ life }: { life: ReturnType<typeof lifeScore> }) {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const wins = life.visits + life.skipped + life.routines;
  const parts = [
    life.visits && `${life.visits} go-here ${life.visits === 1 ? 'visit' : 'visits'}`,
    life.skipped && `${life.skipped} skipped`,
    life.routines && `${n(life.routines)} ${life.routines === 1 ? 'routine' : 'routines'} done`,
  ].filter(Boolean);
  const explain =
    wins + life.slips === 0
      ? 'Nothing logged this week yet, so you start at a neutral 50.'
      : `${n(wins)} ${wins === 1 ? 'win' : 'wins'}, ${life.slips} ${life.slips === 1 ? 'slip' : 'slips'}` +
        (parts.length ? ` · ${parts.join(', ')}` : '');
  const delta =
    life.delta === null
      ? 'First week'
      : life.delta === 0
        ? 'Same as last week'
        : `${life.delta > 0 ? '+' : '−'}${Math.abs(life.delta)} vs last week`;

  return (
    <Card>
      <Text style={T.overline}>Life score · 7 days</Text>
      <View style={styles.scoreRow}>
        <Text style={styles.score}>{life.score}</Text>
        <View style={styles.scoreSide}>
          <Text style={T.title}>{life.band}</Text>
          <Text style={T.caption}>{delta}</Text>
        </View>
      </View>
      <View style={styles.meter} accessibilityLabel={`Life score ${life.score} out of 100`}>
        <View style={[styles.meterFill, { width: `${Math.max(2, life.score)}%` }]} />
      </View>
      <Text style={[T.caption, { marginTop: S.md }]}>{explain}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: S.md, marginTop: S.xs },
  score: { fontSize: 64, fontWeight: '700', color: C.text, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  scoreSide: { paddingBottom: 12, gap: 2 },
  meter: { height: 8, borderRadius: R.pill, backgroundColor: C.raised, overflow: 'hidden', marginTop: S.sm },
  meterFill: { height: '100%', borderRadius: R.pill, backgroundColor: C.text },
  pattern: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  strong: { color: C.text, fontWeight: '600' },
  count: { color: C.text, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
