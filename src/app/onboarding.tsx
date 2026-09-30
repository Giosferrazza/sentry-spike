import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Dot, Icon } from '@/components/ui';
import { C, R, S, T } from '@/constants/ui';
import { KIND_COLORS, KIND_LABELS } from '@/lib/fences';
import { finishOnboarding } from '@/lib/onboarding';
import { saveName } from '@/lib/profile';

const STEPS = 4;

// First launch: what Sentry does, your name, and the permissions it needs.
// Ends on the Map so the first thing you do is draw a spot.
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [asking, setAsking] = useState(false);

  const next = () => setStep((s) => s + 1);

  const done = async () => {
    await finishOnboarding();
    router.replace('/map');
  };

  const allow = async () => {
    setAsking(true);
    try {
      await Notifications.requestPermissionsAsync();
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status === 'granted') await Location.requestBackgroundPermissionsAsync();
    } finally {
      setAsking(false);
      await done();
    }
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.root, { paddingTop: insets.top + S.xxl, paddingBottom: insets.bottom + S.lg }]}>
      <View style={styles.dots}>
        {Array.from({ length: STEPS }, (_, i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.body}>
        {step === 0 && (
          <>
            <Icon name="location.viewfinder" size={56} />
            <Text style={T.largeTitle}>Sentry</Text>
            <Text style={styles.lead}>
              A nudge at the places that matter. Show up where you want to be, skip the places you
              don't.
            </Text>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={T.largeTitle}>Draw your spots</Text>
            <Text style={styles.lead}>Circle any place on the map and pick what it means to you.</Text>
            <Kind
              color={KIND_COLORS.seek}
              title={KIND_LABELS.seek}
              text="The gym, the library. Each visit adds to your streak."
            />
            <Kind
              color={KIND_COLORS.avoid}
              title={KIND_LABELS.avoid}
              text="The drive-thru, the bar. You'll get a pause before you walk in."
            />
            <Text style={T.caption}>
              Add your own reason to any spot and it shows up in the alert.
            </Text>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={T.largeTitle}>What should we call you?</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="First name"
              placeholderTextColor={C.textMuted}
              autoFocus
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={async () => {
                await saveName(name);
                next();
              }}
            />
          </>
        )}

        {step === 3 && (
          <>
            <Icon name="bell.badge" size={48} />
            <Text style={T.largeTitle}>Turn on alerts</Text>
            <Text style={styles.lead}>
              Sentry needs notifications and location set to{' '}
              <Text style={styles.strong}>Always</Text> so it can notice arrivals while your phone is
              in your pocket. Your location never leaves this phone.
            </Text>
          </>
        )}
      </View>

      <View style={styles.actions}>
        {step < 2 && <Button label="Continue" onPress={next} />}
        {step === 2 && (
          <>
            <Button
              label="Continue"
              onPress={async () => {
                await saveName(name);
                next();
              }}
            />
            <Button label="Skip" variant="plain" onPress={next} />
          </>
        )}
        {step === 3 && (
          <>
            <Button label="Allow" onPress={allow} loading={asking} />
            <Button label="Not now" variant="plain" onPress={done} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Kind({ color, title, text }: { color: string; title: string; text: string }) {
  return (
    <View style={styles.kind}>
      <Dot color={color} size={12} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={T.label}>{title}</Text>
        <Text style={T.caption}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: S.xl },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.line },
  dotOn: { backgroundColor: C.text, width: 18 },
  body: { flex: 1, justifyContent: 'center', gap: S.lg },
  lead: { fontSize: 17, lineHeight: 24, color: C.textSecondary },
  strong: { color: C.text, fontWeight: '600' },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.lg,
    borderRadius: R.md,
    backgroundColor: C.surface,
  },
  input: {
    height: 54,
    color: C.text,
    fontSize: 20,
    paddingHorizontal: S.lg,
    borderRadius: R.md,
    backgroundColor: C.raised,
  },
  actions: { gap: S.sm },
});
