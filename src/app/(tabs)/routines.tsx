import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Dot, Icon, Row, Screen } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import { Fence, KIND_COLORS, loadFences } from '@/lib/fences';
import { currentRun, loadRuns, RoutineRun } from '@/lib/routines';

export default function RoutinesScreen() {
  const [fences, setFences] = useState<Fence[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadFences(), loadRuns()]).then(([f, r]) => {
        setFences(f);
        setRuns(r);
      });
    }, [])
  );

  const places = fences.filter((f) => f.kind === 'seek');
  const withRoutine = places.filter((f) => f.habits?.length);
  const without = places.filter((f) => !f.habits?.length);
  const today = withRoutine
    .map((f) => ({ fence: f, run: currentRun(runs, f.id) }))
    .filter((x): x is { fence: Fence; run: RoutineRun } => x.run !== null);

  const open = (f: Fence) => router.push(`/routine/${f.id}`);

  if (places.length === 0) {
    return (
      <Screen title="Routines">
        <Card>
          <Icon name="checklist" size={22} color={C.textSecondary} />
          <Text style={[T.title, { marginTop: S.md }]}>Routines start when you arrive</Text>
          <Text style={[T.caption, { marginTop: S.xs, lineHeight: 20 }]}>
            Mark a place as Go here on the Map (home, the gym), then add the habits you want to do when you
            get there. Sentry pops up the checklist on arrival.
          </Text>
          <Button label="Open Map" icon="map" onPress={() => router.navigate('/map')} style={{ marginTop: S.lg }} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Routines">
      {today.length > 0 && (
        <>
          <Text style={[T.overline, styles.section]}>Today</Text>
          {today.map(({ fence, run }) => {
            const habits = fence.habits!;
            const done = run.done.filter((d) => habits.some((h) => h.id === d)).length;
            const complete = done === habits.length;
            const next = habits.find((h) => !run.done.includes(h.id));
            return (
              <Card key={fence.id}>
                <View style={styles.todayHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={T.title}>{fence.name}</Text>
                    <Text style={[T.caption, { marginTop: 2 }]}>
                      Arrived{' '}
                      {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={styles.count}>
                    {done}/{habits.length}
                  </Text>
                </View>
                <View style={styles.progress}>
                  <View style={[styles.progressFill, { width: `${(done / habits.length) * 100}%` }]} />
                </View>
                <View style={styles.todayFoot}>
                  <Text style={[T.caption, { flex: 1 }]} numberOfLines={1}>
                    {complete ? 'Routine complete' : `Next: ${next?.title}`}
                  </Text>
                  <Button
                    label={complete ? 'View' : 'Continue'}
                    variant={complete ? 'secondary' : 'primary'}
                    onPress={() => open(fence)}
                    style={styles.smallBtn}
                  />
                </View>
              </Card>
            );
          })}
        </>
      )}

      {withRoutine.length > 0 && (
        <>
          <Text style={[T.overline, styles.section]}>Your routines</Text>
          <Card flush>
            {withRoutine.map((f, i) => (
              <Row
                key={f.id}
                leading={<Dot color={KIND_COLORS.seek} />}
                title={f.name}
                subtitle={`${f.habits!.length} ${f.habits!.length === 1 ? 'habit' : 'habits'} · starts with ${f.habits![0].title}`}
                trailing={<Icon name="chevron.right" size={14} color={C.textMuted} />}
                onPress={() => open(f)}
                last={i === withRoutine.length - 1}
              />
            ))}
          </Card>
        </>
      )}

      {without.length > 0 && (
        <>
          <Text style={[T.overline, styles.section]}>Add a routine</Text>
          <Card flush>
            {without.map((f, i) => (
              <Row
                key={f.id}
                leading={<Icon name="plus.circle.fill" size={20} color={C.textMuted} weight="regular" />}
                title={f.name}
                subtitle="No habits yet"
                trailing={<Icon name="chevron.right" size={14} color={C.textMuted} />}
                onPress={() => open(f)}
                last={i === without.length - 1}
              />
            ))}
          </Card>
        </>
      )}

      <Text style={[T.caption, styles.note]}>
        Routines belong to Go here places. Sentry sends the checklist when you actually arrive, not when you
        open the app at home.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: S.sm, marginLeft: S.xs },
  todayHead: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  count: { color: C.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  progress: { height: 6, borderRadius: R.pill, backgroundColor: C.raised, overflow: 'hidden', marginTop: S.md },
  progressFill: { height: '100%', backgroundColor: C.text, borderRadius: R.pill },
  todayFoot: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.md },
  smallBtn: { height: 40, paddingHorizontal: S.lg },
  note: { color: C.textMuted, lineHeight: 18, paddingHorizontal: S.xs, marginTop: S.sm },
});
