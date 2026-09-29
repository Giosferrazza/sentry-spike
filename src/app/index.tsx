import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Circle, Polygon, Polyline, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import {
  Fence,
  FenceKind,
  KIND_COLORS,
  loadFences,
  makeFence,
  MAX_FENCES,
  saveFences,
} from '@/lib/fences';
import { areaSqMeters, LatLng, simplify } from '@/lib/geo';

// Where the old hardcoded spike fence lived; used until we get a GPS fix.
const FALLBACK_REGION: Region = {
  latitude: 39.51822,
  longitude: -119.896584,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

const MIN_AREA_M2 = 400;
const MIN_STROKE_PX = 6;

type Draft = { polygon: LatLng[]; name: string; kind: FenceKind };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(FALLBACK_REGION);
  const sizeRef = useRef({ width: 1, height: 1 });

  const [fences, setFences] = useState<Fence[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [stroke, setStroke] = useState<LatLng[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = fences.find((f) => f.id === selectedId) ?? null;
  const draftFence = useMemo(
    () => (draft ? makeFence(draft.polygon, draft.name, draft.kind) : null),
    [draft]
  );

  useEffect(() => {
    loadFences().then(setFences);
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion(
        { ...pos.coords, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        500
      );
    })();
  }, []);

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

  const setSelectedKind = (kind: FenceKind) =>
    selected && persist(fences.map((f) => (f.id === selected.id ? { ...f, kind } : f)));

  const recenter = async () => {
    const pos = await Location.getLastKnownPositionAsync();
    if (pos) mapRef.current?.animateToRegion({ ...pos.coords, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
  };

  const bottom = insets.bottom + BottomTabInset + 12;

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={FALLBACK_REGION}
        onRegionChangeComplete={(r) => (regionRef.current = r)}
        onLayout={(e: LayoutChangeEvent) => (sizeRef.current = e.nativeEvent.layout)}
        showsUserLocation
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

        {stroke.length > 1 && <Polyline coordinates={stroke} strokeColor="#5b7fff" strokeWidth={4} />}
      </MapView>

      {drawing && <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />}

      <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.pill}>
          <Text style={styles.title}>Sentry</Text>
          <Text style={styles.subtitle}>
            {drawing
              ? 'Draw a loop around the place'
              : `${fences.length} fence${fences.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        {!drawing && (
          <Pressable style={styles.roundBtn} onPress={recenter}>
            <Text style={styles.roundBtnText}>◎</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: bottom }]} pointerEvents="box-none">
        {draftFence ? (
          <View style={styles.sheet}>
            <TextInput
              style={styles.input}
              value={draft!.name}
              onChangeText={(name) => setDraft({ ...draft!, name })}
              placeholder="Name this place"
              placeholderTextColor="#5a6172"
              selectTextOnFocus
            />
            <KindToggle value={draft!.kind} onChange={(kind) => setDraft({ ...draft!, kind })} />
            <Text style={styles.meta}>{describe(draftFence)}</Text>
            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setDraft(null)}>
                <Text style={styles.btnGhostText}>Discard</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveDraft}>
                <Text style={styles.btnText}>Save fence</Text>
              </Pressable>
            </View>
          </View>
        ) : selected ? (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{selected.name}</Text>
            <KindToggle value={selected.kind} onChange={setSelectedKind} />
            <Text style={styles.meta}>{describe(selected)}</Text>
            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.btnDanger]} onPress={deleteSelected}>
                <Text style={styles.btnText}>Delete</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setSelectedId(null)}>
                <Text style={styles.btnGhostText}>Done</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={[styles.btn, styles.fab, drawing ? styles.btnGhostSolid : styles.btnPrimary]}
            onPress={() => setDrawing((d) => !d)}>
            <Text style={styles.btnText}>{drawing ? 'Cancel' : '✎  Draw a fence'}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function KindToggle({ value, onChange }: { value: FenceKind; onChange: (k: FenceKind) => void }) {
  return (
    <View style={styles.seg}>
      {(['avoid', 'seek'] as const).map((k) => (
        <Pressable
          key={k}
          style={[styles.segBtn, value === k && { backgroundColor: KIND_COLORS[k] }]}
          onPress={() => onChange(k)}>
          <Text style={[styles.segText, value === k && styles.segTextOn]}>
            {k === 'avoid' ? 'Stay out' : 'Go here'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function describe(f: Fence): string {
  const acres = areaSqMeters(f.polygon) / 4046.86;
  return `${acres < 1 ? acres.toFixed(2) : acres.toFixed(1)} acres · watched as a ${f.radius} m circle`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1115' },
  header: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pill: {
    flex: 1,
    backgroundColor: 'rgba(22,25,34,0.94)',
    borderColor: '#262b38',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { color: '#f3f5f8', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#8b93a3', fontSize: 13, marginTop: 1 },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(22,25,34,0.94)',
    borderColor: '#262b38',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnText: { color: '#f3f5f8', fontSize: 22 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  sheet: {
    backgroundColor: '#161922',
    borderColor: '#262b38',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sheetTitle: { color: '#f3f5f8', fontSize: 18, fontWeight: '700' },
  input: {
    color: '#f3f5f8',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: '#1d212c',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  meta: { color: '#8b93a3', fontSize: 13 },
  seg: { flexDirection: 'row', backgroundColor: '#1d212c', borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segText: { color: '#8b93a3', fontWeight: '600', fontSize: 14 },
  segTextOn: { color: '#fff' },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  fab: { flex: 0 },
  btnPrimary: { backgroundColor: '#5b7fff' },
  btnDanger: { backgroundColor: '#e0564f' },
  btnGhost: { borderWidth: 1, borderColor: '#262b38' },
  btnGhostSolid: { backgroundColor: '#1d212c', borderWidth: 1, borderColor: '#262b38' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnGhostText: { color: '#8b93a3', fontWeight: '600', fontSize: 16 },
});
