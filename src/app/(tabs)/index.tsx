import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Heatmap, Legend, StackedColumns } from '@/components/charts';
import { activeRoutines, RoutineCard } from '@/components/routine-card';
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

  // Score card: the week, or a single day (today, or a day tapped in History).
  const [mode, setMode] = useState<'day' | 'week'>('week');
  const [day, setDay] = useState<Date | null>(null);
  const shownDay = day ?? new Date();
  const life = mode === 'week' ? lifeScore(log, runs, fences) : lifeScore(log, runs, fences, shownDay, 1);
  const today = activeRoutines(fences, runs);
  const week = byDay(log, 7, new Date(), 'weekday');
  const weekTotal = week.reduce((n, d) => n + d.counts.avoid + d.counts.seek, 0);
  const peak = peakAvoidWindow(log);
  const history = heatmap(log);
  const activeDays = history.flat().filter((d) => d.seek + d.avoid > 0).length;
  const places = byPlace(log, fences)
    .filter((p) => p.entries > 0)
    .slice(0, TOP_PLACES);

  return (
    <Screen
      title={greeting(new Date())}
      subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
      <LifeScoreCard
        life={life}
        mode={mode}
        day={shownDay}
        onMode={(m) => {
          setMode(m);
          if (m === 'week') setDay(null);
        }}
      />

      {today.length > 0 && (
        <>
          <Text style={[T.overline, styles.section]}>Today</Text>
          {today.map((t) => (
            <RoutineCard key={t.fence.id} {...t} />
          ))}
        </>
      )}

      <Card title="History">
        <Heatmap
          grid={history}
          onSelect={(d) => {
            setDay(d);
            setMode(d ? 'day' : 'week');
          }}
          idle={
            activeDays
              ? `${activeDays} days with visits · tap a day`
              : 'Your days fill in as you visit fences'
          }
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

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function LifeScoreCard({
  life,
  mode,
  day,
  onMode,
}: {
  life: ReturnType<typeof lifeScore>;
  mode: 'day' | 'week';
  day: Date;
  onMode: (m: 'day' | 'week') => void;
}) {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const isToday = day.toDateString() === new Date().toDateString();
  const period = mode === 'week' ? 'week' : isToday ? 'today' : 'that day';
  const wins = life.visits + life.skipped + life.routines;
  const parts = [
    life.visits && `${life.visits} go-here ${life.visits === 1 ? 'visit' : 'visits'}`,
    life.skipped && `${life.skipped} skipped`,
    life.routines && `${n(life.routines)} ${life.routines === 1 ? 'routine' : 'routines'} done`,
  ].filter(Boolean);
  const explain =
    wins + life.slips === 0
      ? `Nothing logged ${period === 'week' ? 'this week' : period} yet, so it sits at a neutral 50.`
      : `${n(wins)} ${wins === 1 ? 'win' : 'wins'}, ${life.slips} ${life.slips === 1 ? 'slip' : 'slips'}` +
        (parts.length ? ` · ${parts.join(', ')}` : '');
  const vs = mode === 'week' ? 'last week' : isToday ? 'yesterday' : 'the day before';
  const Vs = vs[0].toUpperCase() + vs.slice(1);
  const delta =
    life.delta !== null
      ? life.delta === 0
        ? `Same as ${vs}`
        : `${life.delta > 0 ? '+' : '−'}${Math.abs(life.delta)} vs ${vs}`
      : life.prevScore !== null
        ? `${Vs}: ${life.prevScore}`
        : mode === 'week'
          ? 'First week'
          : `Nothing ${vs}`;
  const label =
    mode === 'week'
      ? 'Life score · 7 days'
      : `Life score · ${isToday ? 'today' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;

  return (
    <Card>
      <View style={styles.cardTop}>
        <Text style={[T.overline, { flex: 1 }]}>{label}</Text>
        <View style={styles.toggle}>
          {(['day', 'week'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => onMode(m)}
              style={[styles.toggleBtn, mode === m && styles.toggleOn]}
              accessibilityState={{ selected: mode === m }}>
              <Text style={[styles.toggleText, mode === m && styles.toggleTextOn]}>
                {m === 'day' ? 'Day' : 'Week'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
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
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  toggle: { flexDirection: 'row', backgroundColor: C.raised, borderRadius: R.pill, padding: 2 },
  toggleBtn: { paddingHorizontal: S.md, paddingVertical: 4, borderRadius: R.pill },
  toggleOn: { backgroundColor: C.line },
  toggleText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  toggleTextOn: { color: C.text },
  section: { marginTop: S.sm, marginLeft: S.xs },
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
