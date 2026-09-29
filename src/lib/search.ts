import * as Location from 'expo-location';
import type { Region } from 'react-native-maps';

import { distanceMeters, LatLng } from './geo';

export type Place = LatLng & { id: string; title: string; subtitle: string };

// OpenStreetMap's Nominatim: free, no key, handles business names ("Taco Bell")
// as well as addresses. Usage policy wants an identifying User-Agent and no
// more than ~1 request/sec, which search-on-submit easily stays under.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SentrySpike/1.0 (personal geofencing app)';

// Half-width of the "nearby" search box: at least ~30 km (city scale), or
// 1.5x the visible map if zoomed further out.
const NEARBY_DEG = 0.3;

async function nominatim(q: string, center: Region, bounded: boolean): Promise<Place[]> {
  const dLat = Math.max(center.latitudeDelta * 1.5, NEARBY_DEG);
  const dLng = Math.max(center.longitudeDelta * 1.5, NEARBY_DEG);
  const viewbox = [
    center.longitude - dLng,
    center.latitude + dLat,
    center.longitude + dLng,
    center.latitude - dLat,
  ].join(',');
  const url =
    `${NOMINATIM}?format=jsonv2&limit=10&addressdetails=0` +
    `&q=${encodeURIComponent(q)}&viewbox=${viewbox}&bounded=${bounded ? 1 : 0}`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const rows: any[] = await res.json();

  return rows.map((r) => {
    const parts = String(r.display_name ?? '').split(', ');
    const title = r.name || parts[0] || q;
    const rest = parts.slice(1, 4).filter((p) => p !== title);
    return {
      id: String(r.place_id),
      title,
      subtitle: rest.join(', '),
      latitude: Number(r.lat),
      longitude: Number(r.lon),
    };
  });
}

// Nearby matches first, closest on top; if nothing is within the city-scale
// box, widen to anywhere. Falls back to Apple's on-device geocoder if the
// network request fails.
export async function searchPlaces(q: string, region: Region): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  const byDistance = (places: Place[]) =>
    places
      .map((p) => ({ p, d: distanceMeters(region, p) }))
      .sort((a, b) => a.d - b.d)
      .map(({ p }) => p);
  try {
    const near = await nominatim(query, region, true);
    if (near.length) return byDistance(near);
    return await nominatim(query, region, false);
  } catch {
    const hits = await Location.geocodeAsync(query).catch(() => []);
    return hits.map((h, i) => ({
      id: `geo-${i}`,
      title: query,
      subtitle: `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`,
      latitude: h.latitude,
      longitude: h.longitude,
    }));
  }
}
