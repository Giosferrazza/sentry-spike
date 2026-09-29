import type { Region } from 'react-native-maps';

import PlaceSearch, { type Suggestion } from '../../modules/place-search/src/PlaceSearchModule';
import type { LatLng } from './geo';

// Apple Maps search via the local place-search native module:
// suggestions while typing, then coordinates for the one you pick.

export type { Suggestion };
export type Place = LatLng & { title: string; subtitle: string };

const toRegion = (r: Region) => ({
  latitude: r.latitude,
  longitude: r.longitude,
  latitudeDelta: r.latitudeDelta,
  longitudeDelta: r.longitudeDelta,
});

export function suggest(query: string, region: Region): Promise<Suggestion[]> {
  if (!query.trim()) return Promise.resolve([]);
  return PlaceSearch.complete(query, toRegion(region)).catch(() => []);
}

export async function resolvePlace(s: Suggestion, region: Region): Promise<Place | null> {
  const p = await PlaceSearch.resolve(s.title, s.subtitle, toRegion(region)).catch(() => null);
  return p ? { title: p.title, subtitle: p.subtitle, latitude: p.latitude, longitude: p.longitude } : null;
}
