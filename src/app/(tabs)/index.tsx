import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Heatmap, Legend, WeekTrends } from '@/components/charts';
import { activeRoutines, RoutineCard } from '@/components/routine-card';
import { Dial } from '@/components/dial';
import { Card, Dot, Icon, Row, Screen } from '@/components/ui';
import { ROUTINES_ENABLED } from '@/constants/features';
import { C, R, S, T } from '@/constants/ui';
import { byDay, byPlace, heatmap, lifeScore, peakAvoidWindow } from '@/lib/analytics';
import { Fence, KIND_COLORS, loadFences, loadLog, LogEntry } from '@/lib/fences';
import { loadName, saveName } from '@/lib/profile';
import { loadRuns, RoutineRun } from '@/lib/routines';

const WEEK_TICKS = [0, 1, 2, 3, 4, 5, 6];
const TOP_PLACES = 5;

export default function InsightsScreen() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [fences, setFences] = useState<Fence[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [name, setName] = useState<string | null>(null); // null until loaded
  const [editingName, setEditingName] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadLog(), loadFences(), loadRuns(), loadName()]).then(([l, f, r, n]) => {
        setLog(l);
        setFences(f);
        setRuns(r);
        setName(n);
      });
    }, [])
  );

  // Score card: today, or a day tapped in History.
  const [day, setDay] = useState<Date | null>(null);
  const shownDay = day ?? new Date();
  const life = lifeScore(log, runs, fences, shownDay, 1);
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
      title={name ? `${greeting(new Date())}, ${name}` : greeting(new Date())}
      onTitlePress={() => setEditingName(true)}>
      {(name === '' || editingName) && (
        <NameCard
          initial={name ?? ''}
          onSave={async (n) => {
            await saveName(n);
            setName(await loadName());
            setEditingName(false);
          }}
        />
      )}
      <LifeScoreCard life={life} day={shownDay} />

      {ROUTINES_ENABLED && today.length > 0 && (
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
          onSelect={setDay}
          idle={
            activeDays
              ? `${activeDays} days with visits · tap a day`
              : 'Your days fill in as you visit fences'
          }
        />
      </Card>

      <Card title="This week" right={<Legend />}>
        <>
          <WeekTrends
            buckets={week}
            ticks={WEEK_TICKS}
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

// Asks for a first name once (and again when the greeting is tapped).
function NameCard({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <Card title="What should we call you?">
      <TextInput
        style={styles.nameInput}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => onSave(draft)}
        placeholder="First name"
        placeholderTextColor={C.textMuted}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="givenName"
        autoComplete="name-given"
        returnKeyType="done"
        autoFocus={initial !== ''}
      />
    </Card>
  );
}

function LifeScoreCard({ life, day }: { life: ReturnType<typeof lifeScore>; day: Date }) {
  const isToday = day.toDateString() === new Date().toDateString();
  // Nothing logged yet today: sit at neutral and just be glad you're up.
  const fresh = isToday && life.visits + life.skipped + life.routines + life.slips === 0;
  const label = isToday
    ? 'Life score'
    : `Life score · ${day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;

  return (
    <Card>
      <Text style={[T.overline, { textAlign: 'center' }]}>{label}</Text>
      <View style={{ marginTop: S.md }}>
        <Dial score={life.score}>
          {fresh ? (
            <>
              <Text style={T.title}>Fresh start</Text>
              <Text style={T.caption}>Congrats, you woke up today. +1</Text>
            </>
          ) : (
            <Text style={T.title}>{life.band}</Text>
          )}
        </Dial>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    height: 50,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: S.lg,
    borderRadius: R.md,
    backgroundColor: C.raised,
  },
  section: { marginTop: S.sm, marginLeft: S.xs },
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
  count: {
    color: C.text,
    fontSize: 17,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
