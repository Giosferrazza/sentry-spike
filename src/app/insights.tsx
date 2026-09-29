import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Legend, PlaceBars, StackedColumns } from '@/components/charts';
import { Card, Dot, Screen } from '@/components/ui';
import { C, S, T } from '@/constants/ui';
import { byDay, byHour, byPlace, summarize } from '@/lib/analytics';
import { Fence, KIND_COLORS, loadFences, loadLog, LogEntry } from '@/lib/fences';

const DAY_TICKS = [0, 4, 8, 13];
const HOUR_TICKS = [0, 6, 12, 18, 23];

export default function InsightsScreen() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [fences, setFences] = useState<Fence[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadLog(), loadFences()]).then(([l, f]) => {
        setLog(l);
        setFences(f);
      });
    }, [])
  );

  const sum = summarize(log);
  const days = byDay(log, 14);
  const hours = byHour(log);
  const places = byPlace(log, fences);
  const total14 = days.reduce((n, d) => n + d.counts.avoid + d.counts.seek, 0);
  const totalAll = hours.reduce((n, h) => n + h.counts.avoid + h.counts.seek, 0);

  const diff = sum.last7 - sum.prior7;
  const delta =
    sum.prior7 === 0 && sum.last7 === 0 ? undefined : `${diff > 0 ? '+' : ''}${diff} vs prior 7 days`;

  return (
    <Screen title="Insights">
      <Card>
        <Text style={T.overline}>Last 7 days</Text>
        <View style={styles.heroRow}>
          <Text style={styles.hero}>{sum.last7}</Text>
          <View style={{ paddingBottom: 10 }}>
            <Text style={T.label}>{sum.last7 === 1 ? 'entry' : 'entries'}</Text>
            {delta ? <Text style={T.caption}>{delta}</Text> : null}
          </View>
        </View>
        <View style={styles.split}>
          <View style={styles.splitItem}>
            <Dot color={KIND_COLORS.avoid} size={8} />
            <Text style={T.caption}>
              <Text style={styles.splitNum}>{sum.avoid7}</Text> stay out
            </Text>
          </View>
          <View style={styles.splitItem}>
            <Dot color={KIND_COLORS.seek} size={8} />
            <Text style={T.caption}>
              <Text style={styles.splitNum}>{sum.seek7}</Text> go here
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={T.caption}>
            <Text style={styles.splitNum}>
              {sum.shapeHitRate === null ? '—' : `${Math.round(sum.shapeHitRate * 100)}%`}
            </Text>{' '}
            in shape
          </Text>
        </View>
      </Card>

      {totalAll === 0 ? (
        <Card title="No entries yet">
          <Text style={[T.caption, { lineHeight: 20 }]}>
            Charts fill in once Sentry logs you entering a fence. Start watching on the Monitor tab, then
            walk or drive into one.
          </Text>
        </Card>
      ) : (
        <>
          <Card title="Entries per day" right={<Legend />}>
            <StackedColumns buckets={days} ticks={DAY_TICKS} idle={`${total14} in the last 14 days · tap a day`} />
          </Card>
          <Card title="Time of day" right={<Legend />}>
            <StackedColumns
              buckets={hours}
              ticks={HOUR_TICKS}
              height={110}
              idle={`All ${totalAll} entries by hour · tap an hour`}
            />
          </Card>
        </>
      )}

      {places.length > 0 && (
        <Card title="By place">
          <PlaceBars places={places} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: S.md, marginTop: S.xs },
  hero: { fontSize: 56, fontWeight: '700', color: C.text, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.lg,
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitNum: { color: C.text, fontWeight: '700' },
});
