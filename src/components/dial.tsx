import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { C } from '@/constants/ui';

// A dashboard gauge built from plain Views (no SVG): a solid 240° arc that fills
// in behind a full needle as it sweeps to the score. It rests at neutral (50),
// so a fresh day with nothing logged doesn't animate at all.
const SWEEP = 240;
const SEGMENTS = 121; // dense enough that neighbouring segments overlap into a solid arc
const ARC = 12; // arc thickness
const DURATION = 900;
const NEUTRAL = 50;

// Zone colors along the arc, matching the Life Score bands.
export function zoneColor(score: number) {
  return score >= 80 ? '#30c46c' : score >= 60 ? '#9bd35a' : score >= 40 ? '#f5a524' : C.danger;
}

// Runs on the UI thread inside the needle's animated style, so it's a worklet.
function angleOf(frac: number) {
  'worklet';
  return -SWEEP / 2 + SWEEP * frac;
}

export function Dial({
  score,
  size = 232,
  children,
}: {
  score: number;
  size?: number;
  children?: React.ReactNode;
}) {
  const progress = useSharedValue(NEUTRAL / 100);
  const shown = useCountUp(score);
  const full = { width: size, height: size };

  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: DURATION, easing: Easing.out(Easing.cubic) });
  }, [score, progress]);

  const needle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angleOf(progress.value)}deg` }],
  }));

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{ width: size, height: size * 0.86 }}
        accessibilityRole="progressbar"
        accessibilityLabel={`Life score ${score} out of 100`}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <Segment key={i} size={size} frac={i / (SEGMENTS - 1)} progress={progress} />
        ))}
        {[0, 0.4, 0.6, 0.8, 1].map((f) => (
          <View
            key={f}
            style={[styles.fill, full, { transform: [{ rotate: `${angleOf(f)}deg` }] }]}
            pointerEvents="none">
            <View style={styles.mark} />
          </View>
        ))}

        <View style={[styles.fill, full, styles.readout, { paddingBottom: size * 0.14 + 4 }]} pointerEvents="none">
          <Text style={[styles.score, { color: zoneColor(shown) }]}>{shown}</Text>
        </View>

        <Animated.View style={[styles.fill, full, needle]} pointerEvents="none">
          <View style={[styles.needle, { height: size / 2 - ARC - 18 }]} />
        </Animated.View>
        <View style={[styles.fill, full, { justifyContent: 'center' }]} pointerEvents="none">
          <View style={styles.hub}>
            <View style={styles.hubDot} />
          </View>
        </View>
      </View>
      {children}
    </View>
  );
}

function Segment({ size, frac, progress }: { size: number; frac: number; progress: SharedValue<number> }) {
  const lit = useAnimatedStyle(() => ({
    opacity: progress.value >= frac - 0.001 ? 1 : 0,
  }));

  return (
    <View
      style={[styles.fill, { width: size, height: size, transform: [{ rotate: `${angleOf(frac)}deg` }] }]}
      pointerEvents="none">
      <View style={[styles.segment, { backgroundColor: C.raised }]} />
      <Animated.View style={[styles.segment, styles.overlay, { backgroundColor: zoneColor(frac * 100) }, lit]} />
    </View>
  );
}

// Counts the number up alongside the needle sweep.
function useCountUp(target: number) {
  const [value, setValue] = useState(NEUTRAL);
  useEffect(() => {
    let raf = 0;
    const from = value;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, alignItems: 'center' },
  segment: { width: 7, height: ARC },
  overlay: { position: 'absolute', top: 0 },
  // Zone boundary marks just inside the arc.
  mark: { width: 2, height: 8, marginTop: ARC + 4, borderRadius: 1, backgroundColor: C.textMuted },
  needle: {
    width: 4,
    marginTop: ARC + 18,
    borderRadius: 2,
    backgroundColor: C.text,
    shadowColor: C.text,
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  hub: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.surface },
  // The number sits in the open gap under the hub, clear of the needle's path.
  readout: { justifyContent: 'flex-end' },
  score: { fontSize: 48, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
});
