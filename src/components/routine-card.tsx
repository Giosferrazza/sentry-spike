// A routine in progress: place, arrival time, progress, next step, and a
// Continue button. Used by Home ("Today") and the Routines tab.

import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import type { Fence } from '@/lib/fences';
import { currentRun, RoutineRun } from '@/lib/routines';

export type ActiveRoutine = { fence: Fence; run: RoutineRun };

// Go-here fences with habits whose routine started within the run window.
export function activeRoutines(fences: Fence[], runs: RoutineRun[]): ActiveRoutine[] {
  return fences
    .filter((f) => f.kind === 'seek' && f.habits?.length)
    .map((fence) => ({ fence, run: currentRun(runs, fence.id) }))
    .filter((x): x is ActiveRoutine => x.run !== null);
}

export function RoutineCard({ fence, run }: ActiveRoutine) {
  const habits = fence.habits ?? [];
  const done = run.done.filter((d) => habits.some((h) => h.id === d)).length;
  const complete = habits.length > 0 && done === habits.length;
  const next = habits.find((h) => !run.done.includes(h.id));

  return (
    <Card>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={T.title}>{fence.name}</Text>
          <Text style={[T.caption, { marginTop: 2 }]}>
            Arrived {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>
        <Text style={styles.count}>
          {done}/{habits.length}
        </Text>
      </View>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${habits.length ? (done / habits.length) * 100 : 0}%` }]} />
      </View>
      <View style={styles.foot}>
        <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>
          {complete ? 'Routine complete' : `Next: ${next?.title}`}
        </Text>
        <Button
          label={complete ? 'View' : 'Continue'}
          variant={complete ? 'secondary' : 'primary'}
          onPress={() => router.push(`/routine/${fence.id}`)}
          style={styles.smallBtn}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  count: { color: C.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  progress: { height: 6, borderRadius: R.pill, backgroundColor: C.raised, overflow: 'hidden', marginTop: S.md },
  progressFill: { height: '100%', backgroundColor: C.text, borderRadius: R.pill },
  foot: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.md },
  smallBtn: { height: 40, paddingHorizontal: S.lg },
});
