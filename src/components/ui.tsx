// Shared building blocks so every screen looks like one app.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { C, R, S, T } from '@/constants/ui';

type SymbolName = SymbolViewProps['name'];

export function Icon({
  name,
  size = 18,
  color = C.text,
  weight = 'semibold',
}: {
  name: SymbolName;
  size?: number;
  color?: string;
  weight?: SymbolViewProps['weight'];
}) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} />;
}

// Dashed selection rectangle with a pointing hand on its corner. SF Symbols
// has no dashed version of rectangle.and.hand.point.up.left, so it's
// composed: a filled hand in the background color knocks out the dashes
// behind the outlined hand.
export function LassoSelectIcon({ color, background }: { color: string; background: string }) {
  return (
    <View style={{ width: 22, height: 19 }}>
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <Icon name="rectangle.dashed" size={17} color={color} />
      </View>
      <View style={{ position: 'absolute', right: -2, bottom: -3 }}>
        <Icon name="hand.point.up.left.fill" size={15} color={background} weight="black" />
      </View>
      <View style={{ position: 'absolute', right: -1, bottom: -2 }}>
        <Icon name="hand.point.up.left" size={13} color={color} />
      </View>
    </View>
  );
}

// Scrollable tab screen with a large title. Native tabs already inset content
// below the status bar, so only a small top pad is added here.
export function Screen({
  title,
  subtitle,
  onTitlePress,
  children,
}: {
  title: string;
  subtitle?: string;
  onTitlePress?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={s.screen}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[s.screenContent, { paddingBottom: insets.bottom + BottomTabInset + S.xxl }]}>
      <View style={s.screenHead}>
        <Text style={T.largeTitle} onPress={onTitlePress} suppressHighlighting>
          {title}
        </Text>
        {subtitle ? <Text style={[T.caption, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({
  title,
  right,
  children,
  flush,
  style,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  // Flush cards hold list rows that run edge to edge.
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.card, flush && s.cardFlush, style]}>
      {title || right ? (
        <View style={[s.cardHead, flush && { paddingHorizontal: S.lg, paddingTop: S.lg }]}>
          {title ? <Text style={T.title}>{title}</Text> : <View />}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'plain';

export function Button({
  label,
  icon,
  iconNode,
  onPress,
  variant = 'primary',
  loading,
  style,
}: {
  label: string;
  icon?: SymbolName;
  // A custom icon (e.g. LassoSelectIcon); receives the button's text color.
  iconNode?: (color: string) => React.ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg =
    variant === 'primary' ? C.onAction : variant === 'danger' ? C.danger : variant === 'plain' ? C.textSecondary : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [s.btn, s[`btn_${variant}`], pressed && s.pressed, style]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {iconNode ? iconNode(fg) : icon ? <Icon name={icon} size={16} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// Round icon-only button for floating map controls.
export function IconButton({ name, onPress, label }: { name: SymbolName; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
      <Icon name={name} size={18} />
    </Pressable>
  );
}

// A list row inside a flush Card.
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  last,
}: {
  leading?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const body = (
    <View style={s.row}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={T.label} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {!last && <View style={s.divider} />}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: C.raised }}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  colors,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  // Optional per-option selected color (used for data kinds).
  colors?: Partial<Record<K, string>>;
}) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[s.segBtn, on && { backgroundColor: colors?.[o.key] ?? C.line }]}>
            <Text style={[s.segText, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { paddingHorizontal: S.xl, paddingTop: S.lg, gap: S.md },
  screenHead: { marginBottom: S.sm },

  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg },
  cardFlush: { padding: 0, overflow: 'hidden' },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: S.sm,
    marginBottom: S.md,
  },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
    height: 50,
    paddingHorizontal: S.xl,
    borderRadius: R.md,
  },
  btn_primary: { backgroundColor: C.action },
  btn_secondary: { backgroundColor: C.raised },
  btn_danger: { backgroundColor: C.raised },
  btn_plain: { backgroundColor: 'transparent' },
  btnText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },

  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: R.pill,
    backgroundColor: C.glass,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    minHeight: 52,
  },
  divider: {
    position: 'absolute',
    left: S.lg,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.line,
  },

  seg: { flexDirection: 'row', backgroundColor: C.raised, borderRadius: R.sm, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: R.sm - 2, alignItems: 'center' },
  segText: { color: C.textSecondary, fontWeight: '600', fontSize: 14 },
});
