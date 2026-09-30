import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { router, useFocusEffect } from 'expo-router';
import MapView, { Circle, Polygon, Polyline, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton, LassoSelectIcon, Segmented } from '@/components/ui';
import { ROUTINES_ENABLED } from '@/constants/features';
import { BottomTabInset } from '@/constants/theme';
import { C, R, S, T } from '@/constants/ui';
import {
  Fence,
  FenceKind,
  KIND_COLORS,
  KIND_LABELS,
  loadFences,
  makeFence,
  MAX_FENCES,
  MIN_RADIUS,
  saveFences,
} from '@/lib/fences';
import { areaSqMeters, circlePolygon, distanceMeters, LatLng, simplify } from '@/lib/geo';
import { resolvePlace, suggest, Suggestion } from '@/lib/search';

// Last resort when location is denied and there are no fences yet.
const FALLBACK_REGION: Region = {
  latitude: 39.51822,
  longitude: -119.896584,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

const START_SPAN = 0.012; // ~1.3 km across: a few blocks around you
const LOCATE_TIMEOUT_MS = 2500;
const RECENTER_IF_MOVED_M = 200;

const MIN_AREA_M2 = 400;
// Search-made fences start as a circle of this radius; the slider adjusts it.
// The shape can be smaller than iOS's ~100 m trigger minimum: iOS still
// watches a >= MIN_RADIUS circle (the dashed ring) and the log records
// whether you were inside the actual shape.
const DEFAULT_RADIUS = 60;
const MIN_SHAPE_RADIUS = 25;
const MAX_RADIUS = 1000;
const SUGGEST_DEBOUNCE_MS = 120;
const MIN_STROKE_PX = 6;

// A lasso draft carries its polygon; a search draft is a circle whose
// polygon is derived from center + radius so the slider can resize it.
type Draft = { name: string; kind: FenceKind } & (
  | { polygon: LatLng[]; circle?: undefined }
  | { circle: { center: LatLng; radius: number }; polygon?: undefined }
);

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(FALLBACK_REGION);
  const sizeRef = useRef({ width: 1, height: 1 });

  const [fences, setFences] = useState<Fence[]>([]);
  // The map mounts once we know where to open it, so it never flashes
  // somewhere else first.
  const [startRegion, setStartRegion] = useState<Region | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [stroke, setStroke] = useState<LatLng[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = fences.find((f) => f.id === selectedId) ?? null;
  const draftFence = useMemo(
    () =>
      draft
        ? makeFence(
            draft.circle ? circlePolygon(draft.circle.center, draft.circle.radius) : draft.polygon,
            draft.name,
            draft.kind
          )
        : null,
    [draft]
  );

  useEffect(() => {
    let opened: LatLng | null = null;
    const open = (at: LatLng) => {
      if (opened) return;
      opened = at;
      const region = {
        latitude: at.latitude,
        longitude: at.longitude,
        latitudeDelta: START_SPAN,
        longitudeDelta: START_SPAN,
      };
      regionRef.current = region;
      setStartRegion(region);
    };

    const fencesLoaded = loadFences().then((f) => {
      setFences(f);
      return f;
    });

    // Never leave the map blank: fall back after a short wait.
    const timer = setTimeout(async () => {
      const f = await fencesLoaded;
      open(f[0]?.center ?? FALLBACK_REGION);
    }, LOCATE_TIMEOUT_MS);

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        const f = await fencesLoaded;
        open(f[0]?.center ?? FALLBACK_REGION);
        return;
      }
      // Instant: the phone's cached fix. Then refine with a fresh one.
      const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 }).catch(() => null);
      if (last) open(last.coords);
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(
        () => null
      );
      if (!fresh) return;
      if (!opened) {
        open(fresh.coords);
      } else if (distanceMeters(opened, fresh.coords) > RECENTER_IF_MOVED_M) {
        mapRef.current?.animateToRegion(
          { ...fresh.coords, latitudeDelta: START_SPAN, longitudeDelta: START_SPAN },
          500
        );
      }
    })();

    return () => clearTimeout(timer);
  }, []);

  // Other screens (routine editor) change fences too; reload on return so a
  // later save here can't overwrite their edits with a stale copy.
  useFocusEffect(
    useCallback(() => {
      loadFences().then(setFences);
    }, [])
  );

  const persist = useCallback(async (next: Fence[]) => {
    setFences(next);
    try {
      await saveFences(next);
    } catch (e: any) {
      Alert.alert('Saved, but monitoring not updated', String(e?.message ?? e));
    }
  }, []);

  // Screen px -> lat/lng using the visible region. Rotation and pitch are
  // disabled on the map, so a linear mapping is accurate at street zoom.
  const toCoord = (x: number, y: number): LatLng => {
    const r = regionRef.current;
    const { width, height } = sizeRef.current;
    return {
      latitude: r.latitude + r.latitudeDelta / 2 - (y / height) * r.latitudeDelta,
      longitude: r.longitude - r.longitudeDelta / 2 + (x / width) * r.longitudeDelta,
    };
  };

  const lastPx = useRef({ x: 0, y: 0 });
  const strokeRef = useRef<LatLng[]>([]);

  const finishStroke = () => {
    const raw = strokeRef.current;
    strokeRef.current = [];
    setStroke([]);
    setDrawing(false);

    const polygon = simplify(raw);
    if (polygon.length < 3 || areaSqMeters(polygon) < MIN_AREA_M2) {
      Alert.alert('Too small', 'Draw a loop around the whole place.');
      return;
    }
    setSelectedId(null);
    setDraft({ polygon, name: `Spot ${fences.length + 1}`, kind: 'avoid' });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          lastPx.current = { x, y };
          strokeRef.current = [toCoord(x, y)];
          setStroke(strokeRef.current);
        },
        onPanResponderMove: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          if (Math.hypot(x - lastPx.current.x, y - lastPx.current.y) < MIN_STROKE_PX) return;
          lastPx.current = { x, y };
          strokeRef.current = [...strokeRef.current, toCoord(x, y)];
          setStroke(strokeRef.current);
        },
        onPanResponderRelease: finishStroke,
        onPanResponderTerminate: finishStroke,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fences.length]
  );

  const saveDraft = async () => {
    if (!draftFence) return;
    if (fences.length >= MAX_FENCES) {
      Alert.alert('Fence limit', `iOS can only watch ${MAX_FENCES} places at once. Delete one first.`);
      return;
    }
    const fence = { ...draftFence, name: draftFence.name.trim() || 'Untitled' };
    setDraft(null);
    await persist([...fences, fence]);
  };

  const deleteSelected = () => {
    if (!selected) return;
    Alert.alert(`Delete ${selected.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSelectedId(null);
          await persist(fences.filter((f) => f.id !== selected.id));
        },
      },
    ]);
  };

  // Suggestions as you type. Each keystroke bumps searchSeq so a slow,
  // stale response can't overwrite a newer one.
  const onQuery = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    const seq = ++searchSeq.current;
    if (!q.trim()) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const hits = await suggest(q, regionRef.current);
      if (seq !== searchSeq.current) return;
      setResults(hits);
      setSearching(false);
    }, SUGGEST_DEBOUNCE_MS);
  };

  const pickSuggestion = async (s: Suggestion) => {
    Keyboard.dismiss();
    searchSeq.current++;
    setSearching(true);
    const place = await resolvePlace(s, regionRef.current);
    setSearching(false);
    if (!place) {
      Alert.alert('Couldn’t find that place', 'Try another result or draw the fence by hand.');
      return;
    }
    setQuery('');
    setResults(null);
    setSelectedId(null);
    setDraft({
      name: place.title,
      kind: 'avoid',
      circle: { center: { latitude: place.latitude, longitude: place.longitude }, radius: DEFAULT_RADIUS },
    });
    frameCircle(place, DEFAULT_RADIUS);
  };

  // Zoom so a circle of this radius fills roughly the middle third of the map.
  const frameCircle = (center: LatLng, radius: number) => {
    const span = (Math.max(radius, MIN_RADIUS) * 6) / 111_000;
    mapRef.current?.animateToRegion(
      { latitude: center.latitude, longitude: center.longitude, latitudeDelta: span, longitudeDelta: span },
      500
    );
  };

  const clearSearch = () => {
    searchSeq.current++;
    setQuery('');
    setResults(null);
    setSearching(false);
  };

  const commitName = () => {
    const name = nameEdit.trim();
    if (!selected || !name || name === selected.name) return;
    persist(fences.map((f) => (f.id === selected.id ? { ...f, name } : f)));
  };

  const closeSelected = () => {
    commitName();
    setSelectedId(null);
  };

  const setSelectedKind = (kind: FenceKind) =>
    selected && persist(fences.map((f) => (f.id === selected.id ? { ...f, kind } : f)));

  const recenter = async () => {
    const pos = await Location.getLastKnownPositionAsync();
    if (pos)
      mapRef.current?.animateToRegion({ ...pos.coords, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
  };

  const bottom = insets.bottom + BottomTabInset + S.md;
  const idle = !drawing && !draft && !selected;

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      {startRegion && (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={startRegion}
          onRegionChangeComplete={(r) => (regionRef.current = r)}
          onLayout={(e: LayoutChangeEvent) => (sizeRef.current = e.nativeEvent.layout)}
          mapType="mutedStandard"
          showsUserLocation
          showsPointsOfInterests={false}
          rotateEnabled={false}
          pitchEnabled={false}
          userInterfaceStyle="dark">
          {fences.map((f) => (
            <React.Fragment key={f.id}>
              <Circle
                center={f.center}
                radius={f.radius}
                strokeColor={KIND_COLORS[f.kind] + '55'}
                strokeWidth={1}
                lineDashPattern={[6, 6]}
                fillColor="transparent"
              />
              <Polygon
                coordinates={f.polygon}
                strokeColor={KIND_COLORS[f.kind]}
                strokeWidth={f.id === selectedId ? 4 : 2}
                fillColor={KIND_COLORS[f.kind] + (f.id === selectedId ? '55' : '33')}
                tappable
                onPress={() => {
                  setDraft(null);
                  setSelectedId(f.id);
                  setNameEdit(f.name);
                }}
              />
            </React.Fragment>
          ))}

          {draftFence && (
            <>
              <Circle
                center={draftFence.center}
                radius={draftFence.radius}
                strokeColor="#ffffff66"
                strokeWidth={1}
                lineDashPattern={[6, 6]}
                fillColor="transparent"
              />
              <Polygon
                coordinates={draftFence.polygon}
                strokeColor={KIND_COLORS[draftFence.kind]}
                strokeWidth={3}
                fillColor={KIND_COLORS[draftFence.kind] + '44'}
              />
            </>
          )}

          {stroke.length > 1 && <Polyline coordinates={stroke} strokeColor="#ffffff" strokeWidth={4} />}
        </MapView>
      )}

      {drawing && <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />}

      {/* Top: search + locate while idle; a hint while drawing. */}
      <View style={[styles.top, { top: insets.top + S.sm }]} pointerEvents="box-none">
        {drawing ? (
          <View style={styles.hint}>
            <Icon name="lasso" size={15} color={C.textSecondary} />
            <Text style={T.caption}>Draw a loop around the place</Text>
          </View>
        ) : idle ? (
          <>
            <View style={styles.topRow}>
              <View style={styles.search}>
                <Icon name="magnifyingglass" size={16} color={C.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={onQuery}
                  onSubmitEditing={() => results?.[0] && pickSuggestion(results[0])}
                  placeholder="Search places"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {searching ? (
                  <ActivityIndicator color={C.textSecondary} />
                ) : query ? (
                  <Pressable onPress={clearSearch} hitSlop={12} accessibilityLabel="Clear search">
                    <Icon name="xmark.circle.fill" size={17} color={C.textMuted} weight="regular" />
                  </Pressable>
                ) : null}
              </View>
              <IconButton name="location.fill" onPress={recenter} label="Center on me" />
            </View>

            {results && (
              <View style={styles.results}>
                {results.length === 0 ? (
                  <Text style={[T.caption, { padding: S.lg }]}>No places found</Text>
                ) : (
                  results.map((r, i) => (
                    <Pressable
                      key={`${r.title}|${r.subtitle}`}
                      onPress={() => pickSuggestion(r)}
                      style={({ pressed }) => [
                        styles.result,
                        i < results.length - 1 && styles.resultDivider,
                        pressed && { backgroundColor: C.raised },
                      ]}>
                      <Icon name="mappin.circle.fill" size={20} color={C.textMuted} weight="regular" />
                      <View style={{ flex: 1 }}>
                        <Text style={T.label} numberOfLines={1}>
                          {r.title}
                        </Text>
                        {r.subtitle ? (
                          <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>
                            {r.subtitle}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </>
        ) : null}
      </View>

      <View style={[styles.bottom, { paddingBottom: bottom }]} pointerEvents="box-none">
        {draftFence ? (
          <FenceSheet
            name={draft!.name}
            onName={(name) => setDraft({ ...draft!, name })}
            kind={draft!.kind}
            onKind={(kind) => setDraft({ ...draft!, kind })}
            meta={draft!.circle ? describeCircle(draftFence, draft!.circle.radius) : describe(draftFence)}
            radius={draft!.circle?.radius}
            onRadius={
              draft!.circle
                ? (radius) => setDraft({ ...draft!, circle: { ...draft!.circle!, radius } })
                : undefined
            }
            autoFocus>
            <Button label="Discard" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button label="Save fence" onPress={saveDraft} style={{ flex: 1 }} />
          </FenceSheet>
        ) : selected ? (
          <FenceSheet
            name={nameEdit}
            onName={setNameEdit}
            onNameDone={commitName}
            kind={selected.kind}
            onKind={setSelectedKind}
            meta={describe(selected)}
            routine={
              ROUTINES_ENABLED && selected.kind === 'seek'
                ? {
                    count: selected.habits?.length ?? 0,
                    onPress: () => {
                      commitName();
                      router.push(`/routine/${selected.id}`);
                    },
                  }
                : undefined
            }>
            <Button
              label="Delete"
              icon="trash"
              variant="danger"
              onPress={deleteSelected}
              style={{ flex: 1 }}
            />
            <Button label="Done" onPress={closeSelected} style={{ flex: 1 }} />
          </FenceSheet>
        ) : (
          <View style={styles.fabWrap} pointerEvents="box-none">
            {drawing ? (
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setDrawing(false)}
                style={styles.fab}
              />
            ) : (
              <Button
                label="Draw fence"
                iconNode={(fg) => <LassoSelectIcon color={fg} background={C.action} />}
                onPress={() => setDrawing(true)}
                style={styles.fab}
              />
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function FenceSheet({
  name,
  onName,
  onNameDone,
  kind,
  onKind,
  meta,
  radius,
  onRadius,
  autoFocus,
  routine,
  children,
}: {
  name: string;
  onName: (s: string) => void;
  onNameDone?: () => void;
  kind: FenceKind;
  onKind: (k: FenceKind) => void;
  meta: string;
  radius?: number;
  onRadius?: (r: number) => void;
  autoFocus?: boolean;
  // Go-here fences link to their arrival routine.
  routine?: { count: number; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={onName}
        onEndEditing={onNameDone}
        placeholder="Name this place"
        placeholderTextColor={C.textMuted}
        returnKeyType="done"
        selectTextOnFocus={autoFocus}
      />
      <Segmented
        options={[
          { key: 'avoid', label: KIND_LABELS.avoid },
          { key: 'seek', label: KIND_LABELS.seek },
        ]}
        value={kind}
        onChange={onKind}
        colors={KIND_COLORS}
      />
      {radius !== undefined && onRadius ? (
        <View>
          <View style={styles.radiusHead}>
            <Text style={T.caption}>Radius</Text>
            <Text style={styles.radiusValue}>{radius} m</Text>
          </View>
          <Slider
            value={radius}
            minimumValue={MIN_SHAPE_RADIUS}
            maximumValue={MAX_RADIUS}
            step={5}
            onValueChange={onRadius}
            minimumTrackTintColor={C.text}
            maximumTrackTintColor={C.line}
            thumbTintColor={C.text}
          />
        </View>
      ) : null}
      <View style={styles.meta}>
        <Icon name="circle.dashed" size={13} color={C.textMuted} weight="regular" />
        <Text style={T.caption}>{meta}</Text>
      </View>
      {routine ? (
        <Pressable
          onPress={routine.onPress}
          style={({ pressed }) => [styles.routineRow, pressed && { backgroundColor: C.line }]}>
          <Icon name="checklist" size={17} color={C.text} />
          <View style={{ flex: 1 }}>
            <Text style={T.label}>Arrival routine</Text>
            <Text style={T.caption}>
              {routine.count
                ? `${routine.count} ${routine.count === 1 ? 'habit' : 'habits'} when you arrive`
                : 'Add habits to do when you arrive'}
            </Text>
          </View>
          <Icon name="chevron.right" size={14} color={C.textMuted} />
        </Pressable>
      ) : null}
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

function describeCircle(f: Fence, radius: number): string {
  return radius < MIN_RADIUS
    ? `Alerts start at the dashed ${f.radius} m ring (iOS minimum)`
    : 'Drag to resize, or draw your own shape';
}

function describe(f: Fence): string {
  const acres = areaSqMeters(f.polygon) / 4046.86;
  return `${acres < 1 ? acres.toFixed(2) : acres.toFixed(1)} acres · watched as a ${f.radius} m circle`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  top: { position: 'absolute', left: S.lg, right: S.lg, gap: S.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  search: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.md,
    borderRadius: R.pill,
    backgroundColor: C.glass,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 16, height: '100%' },
  results: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  resultDivider: { borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  hint: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.lg,
    height: 36,
    borderRadius: R.pill,
    backgroundColor: C.glass,
  },

  bottom: { position: 'absolute', left: S.lg, right: S.lg, bottom: 0 },
  fabWrap: { alignItems: 'center' },
  fab: { borderRadius: R.pill, paddingHorizontal: S.xxl },

  sheet: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    padding: S.lg,
    paddingTop: S.sm,
    gap: S.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    marginBottom: S.xs,
  },
  nameInput: { color: C.text, fontSize: 22, fontWeight: '700', paddingVertical: S.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.raised,
  },
  radiusHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  radiusValue: { color: C.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: S.sm, marginTop: S.xs },
});
