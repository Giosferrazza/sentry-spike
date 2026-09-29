import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import { Fence, loadFences, saveFences } from '@/lib/fences';
import { currentRun, Habit, loadRuns, newId, RoutineRun, toggleHabit } from '@/lib/routines';

export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [fences, setFences] = useState<Fence[]>([]);
  const [run, setRun] = useState<RoutineRun | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const fence = fences.find((f) => f.id === id);
  const habits = fence?.habits ?? [];

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadFences(), loadRuns()]).then(([f, runs]) => {
        setFences(f);
        setRun(currentRun(runs, id));
        // Nothing to check yet: go straight to adding habits.
        if (!f.find((x) => x.id === id)?.habits?.length) setEditing(true);
      });
    }, [id])
  );

  const setHabits = async (next: Habit[]) => {
    const all = fences.map((f) => (f.id === id ? { ...f, habits: next } : f));
    setFences(all);
    await saveFences(all);
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    setHabits([...habits, { id: newId('h'), title }]);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= habits.length) return;
    const next = [...habits];
    [next[i], next[j]] = [next[j], next[i]];
    setHabits(next);
  };

  const toggle = async (h: Habit) => setRun(await toggleHabit(id, h.id));

  if (!fence) return <View style={styles.root} />;

  const done = run?.done.filter((d) => habits.some((h) => h.id === d)).length ?? 0;
  const complete = habits.length > 0 && done === habits.length;
  const arrived = run
    ? new Date(run.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close">
          <Icon name="xmark" size={18} color={C.textSecondary} />
        </Pressable>
        {habits.length > 0 && (
          <Pressable onPress={() => setEditing((e) => !e)} hitSlop={10}>
            <Text style={styles.headAction}>{editing ? 'Done' : 'Edit'}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={T.overline}>{arrived ? `Arrived ${arrived}` : 'Routine'}</Text>
        <Text style={[T.largeTitle, { marginTop: 2 }]}>{fence.name}</Text>

        {!editing && habits.length > 0 && (
          <View style={styles.progressWrap}>
            <View style={styles.progress}>
              <View style={[styles.progressFill, { width: `${(done / habits.length) * 100}%` }]} />
            </View>
            <Text style={T.caption}>
              {complete ? 'Routine complete' : `${done} of ${habits.length}`}
            </Text>
          </View>
        )}

        {editing && (
          <Text style={[T.caption, { marginTop: S.sm }]}>
            When you arrive, Sentry sends a notification that opens this list. Add habits in the order you
            want to do them.
          </Text>
        )}

        <View style={styles.list}>
          {habits.map((h, i) => {
            const checked = !!run?.done.includes(h.id);
            return editing ? (
              <View key={h.id} style={[styles.item, i < habits.length - 1 && styles.divider]}>
                <Text style={[T.body, { flex: 1 }]}>{h.title}</Text>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6}>
                  <Icon name="chevron.up" size={15} color={i === 0 ? C.line : C.textSecondary} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === habits.length - 1} hitSlop={6}>
                  <Icon
                    name="chevron.down"
                    size={15}
                    color={i === habits.length - 1 ? C.line : C.textSecondary}
                  />
                </Pressable>
                <Pressable onPress={() => setHabits(habits.filter((x) => x.id !== h.id))} hitSlop={6}>
                  <Icon name="minus.circle.fill" size={20} color={C.danger} weight="regular" />
                </Pressable>
              </View>
            ) : (
              <Pressable
                key={h.id}
                onPress={() => toggle(h)}
                style={({ pressed }) => [styles.item, i < habits.length - 1 && styles.divider, pressed && styles.pressed]}>
                <Icon
                  name={checked ? 'checkmark.circle.fill' : 'circle'}
                  size={24}
                  color={checked ? C.text : C.textMuted}
                  weight="regular"
                />
                <Text style={[styles.habit, checked && styles.habitDone]}>{h.title}</Text>
              </Pressable>
            );
          })}
        </View>

        {editing && (
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              placeholder={habits.length ? 'Add another habit' : 'e.g. Change into gym clothes'}
              placeholderTextColor={C.textMuted}
              returnKeyType="done"
              blurOnSubmit={false}
              autoFocus={habits.length === 0}
            />
            <Button label="Add" variant="secondary" onPress={add} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.xl,
    paddingTop: S.xl,
    paddingBottom: S.sm,
  },
  headAction: { color: C.text, fontSize: 16, fontWeight: '600' },
  body: { paddingHorizontal: S.xl, paddingBottom: S.xxl },
  progressWrap: { marginTop: S.lg, gap: S.sm },
  progress: { height: 6, borderRadius: R.pill, backgroundColor: C.raised, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.text, borderRadius: R.pill },
  list: { marginTop: S.lg, backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: S.lg,
    minHeight: 56,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  pressed: { backgroundColor: C.raised },
  habit: { flex: 1, color: C.text, fontSize: 17 },
  habitDone: { color: C.textMuted, textDecorationLine: 'line-through' },
  addRow: { flexDirection: 'row', gap: S.sm, marginTop: S.md, alignItems: 'center' },
  addInput: {
    flex: 1,
    height: 50,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: S.lg,
    borderRadius: R.md,
    backgroundColor: C.surface,
  },
});
