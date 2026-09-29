import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { activeRoutines, RoutineCard } from '@/components/routine-card';
import { Button, Card, Dot, Icon, Row, Screen } from '@/components/ui';
import { C, S, T } from '@/constants/ui';
import { Fence, KIND_COLORS, loadFences } from '@/lib/fences';
import { loadRuns, RoutineRun } from '@/lib/routines';

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
  const today = activeRoutines(fences, runs);

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
          <Button
            label="Open Map"
            icon="map"
            onPress={() => router.navigate('/map')}
            style={{ marginTop: S.lg }}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Routines">
      {today.length > 0 && (
        <>
          <Text style={[T.overline, styles.section]}>Today</Text>
          {today.map((t) => (
            <RoutineCard key={t.fence.id} {...t} />
          ))}
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
  note: { color: C.textMuted, lineHeight: 18, paddingHorizontal: S.xs, marginTop: S.sm },
});
