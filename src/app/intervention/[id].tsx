import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Icon } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import {
  interventionService,
  InterventionContext,
  QuickIntent,
} from '@/lib/ai/intervention-service';
import { placeStreak } from '@/lib/analytics';
import { syncLiveActivity } from '@/lib/live-activity';
import { Fence, KIND_COLORS, loadFences, loadLog, LogEntry, watchExitTimers } from '@/lib/fences';
import {
  ChatMessage,
  dismissIntervention,
  InterventionAction,
  InterventionSession,
  loadIntervention,
  markStayed,
  startExitTimer,
  SuggestedAction,
  timerActive,
  updateIntervention,
  withAction,
} from '@/lib/interventions';
import { newId } from '@/lib/routines';

const SUGGESTION_LABELS: Record<SuggestedAction, string> = {
  timer: 'Start exit timer',
  buddy: 'Call buddy',
  'go-here': 'Find a Go Here place',
  'remind-why': 'Remind me why',
  okay: "I'm okay",
};

// Opened from the stay-out arrival alert (and the timer's "Still at …?"
// reminder). Talk -> redirect: chat with the buddy, start an exit timer,
// reach a person, or head to a Go Here place.
export default function InterventionScreen() {
  // action: from the Live Activity's buttons (timer | okay).
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<InterventionSession | null>(null);
  const [fences, setFences] = useState<Fence[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scroll = useRef<ScrollView>(null);
  const started = useRef(false);

  const fence = fences.find((f) => f.id === session?.placeId);
  const goHere = fences.filter((f) => f.kind === 'seek');

  // Streak at stake: days clean before this visit.
  const streak = session
    ? placeStreak(
        log.filter((e) => e.ts !== session.entryTs),
        session.placeId,
        'avoid',
        fence?.createdAt ?? null
      )
    : 0;

  const ctxFor = useCallback(
    (s: InterventionSession): InterventionContext => ({
      placeName: s.placeName,
      stage: s.stage ?? 'arrived',
      reason: fence?.reason,
      minutesThere: Math.round(((s.exitedAt ? Date.parse(s.exitedAt) : Date.now()) - Date.parse(s.enteredAt)) / 60_000),
      streakDays: streak,
      goHerePlaces: goHere.map((f) => f.name),
      timer: s.timer ? { endsAt: s.timer.endsAt } : null,
      timerExpired: !!s.timer && !s.exitedAt && Date.now() >= Date.parse(s.timer.endsAt),
    }),
    [fence, streak, goHere]
  );

  const addMessage = async (msg: Omit<ChatMessage, 'id' | 'at'>, action?: InterventionAction) => {
    const full: ChatMessage = { ...msg, id: newId('m'), at: new Date().toISOString() };
    const next = await updateIntervention(id, (s) => {
      const withMsg = { ...s, messages: [...s.messages, full] };
      return action ? withAction(withMsg, action) : withMsg;
    });
    if (next) setSession(next);
    return next;
  };

  const record = async (action: InterventionAction) => {
    const next = await updateIntervention(id, (s) => withAction(s, action));
    if (next) setSession(next);
  };

  const startTimer = async () => {
    const s = await startExitTimer(id);
    if (!s) return;
    setSession(s);
    await watchExitTimers(); // precise GPS until you leave the shape or time runs out
    await addMessage({
      role: 'buddy',
      text: "Timer's on: 10 minutes. Head for the door. Leave before it ends and your streak holds.",
    });
  };

  const okay = async () => {
    await dismissIntervention(id);
    router.back();
  };

  // The timer ran out and you're still here: escalate once.
  const escalate = async (s: InterventionSession) => {
    const stayed = await markStayed(s.id);
    if (!stayed) return;
    setSession(stayed);
    const reply = await interventionService.opening({ ...ctxFor(stayed), timerExpired: true });
    await addMessage({ role: 'buddy', ...reply });
  };

  // Load, then open the conversation the first time.
  useEffect(() => {
    let alive = true;
    Promise.all([loadIntervention(id), loadFences(), loadLog()]).then(([s, f, l]) => {
      if (!alive) return;
      setFences(f);
      setLog(l);
      setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!session || started.current || !fences.length) return;
    started.current = true;
    // In the foreground iOS lets us start the Live Activity if the arrival couldn't.
    syncLiveActivity(session);
    (async () => {
      if (action === 'okay') return okay();
      if (action === 'timer' && !session.exitedAt && !timerActive(session)) await startTimer();
      if (session.timer && !session.exitedAt && Date.now() >= Date.parse(session.timer.endsAt)) {
        if (!session.actions.some((a) => a.type === 'timer-expired')) await escalate(session);
        return;
      }
      if (session.messages.length) return;
      setThinking(true);
      const s = await updateIntervention(id, (x) => withAction({ ...x, aiStarted: true }, 'opened'));
      const reply = await interventionService.opening(ctxFor(s ?? session));
      await addMessage({ role: 'buddy', ...reply });
      setThinking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fences]);

  // Clock for the timer and "here N min"; pick up exits the background task records.
  useEffect(() => {
    const t = setInterval(async () => {
      setNow(Date.now());
      const fresh = await loadIntervention(id);
      if (!fresh) return;
      setSession((cur) => (cur && fresh.messages.length >= cur.messages.length ? fresh : cur));
      if (fresh.timer && !fresh.exitedAt && fresh.outcome === 'unknown' && Date.now() >= Date.parse(fresh.timer.endsAt)) {
        await escalate(fresh);
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [session?.messages.length, thinking]);

  if (!session) return <View style={styles.root} />;

  const crisis = session.messages.some((m) => m.crisis);
  const approaching = (session.stage ?? 'arrived') === 'approach';
  const left = !!session.exitedAt;
  const timing = timerActive(session, now);
  const remaining = session.timer ? Math.max(0, Date.parse(session.timer.endsAt) - now) : 0;
  const minutes = Math.max(0, Math.round(((left ? Date.parse(session.exitedAt!) : now) - Date.parse(session.enteredAt)) / 60_000));

  const send = async (text: string, intent?: QuickIntent, action?: InterventionAction) => {
    if (!text.trim() || thinking) return;
    const s = await addMessage({ role: 'user', text: text.trim() }, action);
    if (!s) return;
    setThinking(true);
    try {
      const reply = await interventionService.reply(ctxFor(s), s.messages, { text: text.trim(), intent });
      await addMessage({ role: 'buddy', ...reply }, reply.crisis ? 'crisis-shown' : undefined);
    } finally {
      setThinking(false);
    }
  };

  const contactBuddy = async () => {
    // TODO(friends): no buddy system yet. Opens Messages with a ready-to-send ask.
    await record('contact-buddy');
    const body = `I'm at ${session.placeName} and trying to leave. Can you call me?`;
    Linking.openURL(`sms:&body=${encodeURIComponent(body)}`).catch(() => {});
  };

  const findGoHere = async () => {
    await record('find-go-here');
    if (!goHere.length) {
      Alert.alert('No Go Here places yet', 'Add one on the Map, like the gym or a friend’s place.');
      return;
    }
    const options = [...goHere.map((f) => f.name), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, title: 'Walk to a Go Here place' },
      (i) => {
        const f = goHere[i];
        if (!f) return;
        const { latitude, longitude } = f.center;
        Linking.openURL(`http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`).catch(() => {});
      }
    );
  };

  const suggest = (a: SuggestedAction) => {
    if (a === 'timer') return startTimer();
    if (a === 'buddy') return contactBuddy();
    if (a === 'go-here') return findGoHere();
    if (a === 'remind-why') return send('Remind me why', 'remind-why', 'remind-why');
    return okay();
  };

  const lastBuddy = [...session.messages].reverse().find((m) => m.role === 'buddy');
  const suggestions = (lastBuddy?.suggestions ?? []).filter((a) => !(a === 'timer' && (timing || left)));

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingBottom: insets.bottom + S.sm }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close">
          <Icon name="xmark" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.top}>
        <Text style={T.overline}>
          {left
            ? approaching
              ? 'Turned around'
              : `Left after ${minutes} min`
            : approaching
              ? `Heading toward · ${minutes} min ago`
              : `Stay out · here ${minutes} min`}
        </Text>
        <Text style={[T.largeTitle, { marginTop: 2 }]} numberOfLines={1}>
          {session.placeName}
        </Text>
        {streak > 0 && (
          <View style={styles.streak}>
            <Icon name="flame.fill" size={13} color={C.streak} />
            <Text style={T.caption}>
              {left && session.streakKept
                ? `${streak} ${streak === 1 ? 'day' : 'days'} clean, still going`
                : `${streak} ${streak === 1 ? 'day' : 'days'} clean at stake`}
            </Text>
          </View>
        )}
      </View>

      {left && session.streakKept ? (
        <Card style={styles.banner}>
          <View style={styles.bannerRow}>
            <Icon name="checkmark.seal.fill" size={22} color={KIND_COLORS.seek} />
            <View style={{ flex: 1 }}>
              <Text style={T.title}>{approaching ? 'You turned around.' : 'You left. Boundary kept.'}</Text>
              <Text style={T.caption}>That counts as a win. Your streak holds.</Text>
            </View>
          </View>
        </Card>
      ) : timing ? (
        <Card style={styles.banner}>
          <View style={styles.bannerRow}>
            <Icon name="timer" size={22} color={C.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.countdown}>{fmt(remaining)}</Text>
              <Text style={T.caption}>Leave the area before it ends to keep your streak.</Text>
            </View>
          </View>
        </Card>
      ) : null}

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.chat}
        keyboardShouldPersistTaps="handled">
        {session.messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.role === 'user' ? styles.mine : styles.theirs]}>
            <Text style={T.body}>{m.text}</Text>
          </View>
        ))}
        {thinking && (
          <View style={[styles.bubble, styles.theirs]}>
            <Text style={[T.body, { color: C.textSecondary }]}>…</Text>
          </View>
        )}
        {!crisis && !thinking && suggestions.length > 0 && (
          <View style={styles.chips}>
            {suggestions.map((a) => (
              <Pressable
                key={a}
                onPress={() => suggest(a)}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Text style={styles.chipText}>{SUGGESTION_LABELS[a]}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {crisis ? (
        // Coaching stops here: real people only.
        <View style={styles.crisis}>
          <Button
            label="Call 988 (Suicide & Crisis Lifeline)"
            icon="phone.fill"
            onPress={() => record('crisis-call').then(() => Linking.openURL('tel:988'))}
          />
          <Button
            label="Text 988"
            icon="message.fill"
            variant="secondary"
            onPress={() => record('crisis-call').then(() => Linking.openURL('sms:988'))}
          />
          <Button
            label="Call 911"
            icon="exclamationmark.triangle.fill"
            variant="danger"
            onPress={() => record('crisis-call').then(() => Linking.openURL('tel:911'))}
          />
        </View>
      ) : (
        <View style={styles.grid}>
          <Quick icon="figure.walk" label="Help me leave" onPress={() => send('Help me leave', 'help-leave', 'help-leave')} />
          <Quick icon="heart" label="I'm struggling" onPress={() => send("I'm struggling", 'struggling', 'struggling')} />
          <Quick icon="quote.opening" label="Remind me why" onPress={() => send('Remind me why', 'remind-why', 'remind-why')} />
          {approaching ? (
            <Quick
              icon="arrow.uturn.backward"
              label="Turn around"
              onPress={() => send('Help me turn around', 'help-leave', 'help-leave')}
              disabled={left}
            />
          ) : (
            <Quick
              icon="timer"
              label={timing ? 'Timer running' : 'Start 10 min exit timer'}
              onPress={startTimer}
              disabled={timing || left}
            />
          )}
          <Quick icon="person.2.fill" label="Contact my buddy" onPress={contactBuddy} />
          <Quick icon="checkmark" label="I'm okay" onPress={okay} />
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Tell Sentry what's going on"
          placeholderTextColor={C.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => {
            send(draft);
            setDraft('');
          }}
        />
        <Pressable
          onPress={() => {
            send(draft);
            setDraft('');
          }}
          disabled={!draft.trim() || thinking}
          hitSlop={8}
          accessibilityLabel="Send">
          <Icon name="arrow.up.circle.fill" size={30} color={draft.trim() ? C.text : C.textMuted} weight="regular" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Quick({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed, disabled && { opacity: 0.45 }]}>
      <Icon name={icon} size={16} color={C.text} />
      <Text style={styles.quickText} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: S.xl, paddingTop: S.lg },
  top: { paddingHorizontal: S.xl, paddingBottom: S.md },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.xs },
  banner: { marginHorizontal: S.lg, marginBottom: S.sm },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  countdown: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  chat: { paddingHorizontal: S.lg, paddingVertical: S.sm, gap: S.sm },
  bubble: { maxWidth: '85%', paddingHorizontal: S.md, paddingVertical: S.sm + 2, borderRadius: R.md },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.surface },
  mine: { alignSelf: 'flex-end', backgroundColor: C.raised },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.xs },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    backgroundColor: C.raised,
  },
  chipText: { color: C.text, fontSize: 14, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.sm },
  quick: {
    width: '48.5%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    backgroundColor: C.raised,
  },
  quickText: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  crisis: { gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
  },
  input: {
    flex: 1,
    height: 44,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: S.md,
    borderRadius: R.pill,
    backgroundColor: C.surface,
  },
});
