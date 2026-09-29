import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ink, Legend, PlaceBars, StackedColumns, StatTile } from '@/components/charts';
import { BottomTabInset } from '@/constants/theme';
import { byDay, byHour, byPlace, summarize } from '@/lib/analytics';
import { Fence, loadFences, loadLog, LogEntry } from '@/lib/fences';

const DAY_TICKS = [0, 4, 8, 13];
const HOUR_TICKS = [0, 6, 12, 18, 23];

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
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
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        styles.container,
        { paddingTop: 16, paddingBottom: insets.bottom + BottomTabInset + 24 },
      ]}>
      <Text style={styles.h1}>Insights</Text>

      <View style={styles.tiles}>
        <StatTile label="Entries, last 7 days" value={String(sum.last7)} delta={delta} />
        <StatTile
          label="Shape accuracy"
          value={sum.shapeHitRate === null ? '—' : `${Math.round(sum.shapeHitRate * 100)}%`}
          delta="fired inside the shape"
        />
      </View>
      <View style={styles.tiles}>
        <StatTile label="Stay out, 7 days" value={String(sum.avoid7)} />
        <StatTile label="Go here, 7 days" value={String(sum.seek7)} />
      </View>

      {totalAll === 0 ? (
        <View style={styles.card}>
          <Text style={styles.h2}>No entries yet</Text>
          <Text style={styles.sub}>
            Charts fill in once Sentry logs you entering a fence. Start monitoring on the Monitor tab,
            then walk or drive into one.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.h2}>Entries per day</Text>
              <Legend />
            </View>
            <StackedColumns
              buckets={days}
              ticks={DAY_TICKS}
              idle={`${total14} in the last 14 days · tap a day`}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.h2}>Time of day</Text>
              <Legend />
            </View>
            <StackedColumns
              buckets={hours}
              ticks={HOUR_TICKS}
              height={110}
              idle={`All ${totalAll} entries by hour · tap an hour`}
            />
          </View>
        </>
      )}

      {places.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.h2}>By place</Text>
            <Legend />
          </View>
          <PlaceBars places={places} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  container: { paddingHorizontal: 20, gap: 12 },
  h1: { fontSize: 30, fontWeight: '800', color: Ink.primary, marginBottom: 4 },
  h2: { fontSize: 17, fontWeight: '700', color: Ink.primary },
  sub: { fontSize: 14, color: Ink.secondary, marginTop: 6, lineHeight: 20 },
  tiles: { flexDirection: 'row', gap: 12 },
  card: { backgroundColor: Ink.surface, borderRadius: 14, padding: 16 },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
});
