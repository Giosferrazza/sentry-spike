// Geometry for lasso fences. Everything is done in a local flat projection
// (meters east/north of a reference point), which is plenty accurate at
// neighborhood scale.

export type LatLng = { latitude: number; longitude: number };
type XY = { x: number; y: number };

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

function projector(ref: LatLng) {
  const kx = M_PER_DEG_LNG_EQ * Math.cos((ref.latitude * Math.PI) / 180);
  return {
    to: (p: LatLng): XY => ({
      x: (p.longitude - ref.longitude) * kx,
      y: (p.latitude - ref.latitude) * M_PER_DEG_LAT,
    }),
    from: (p: XY): LatLng => ({
      latitude: ref.latitude + p.y / M_PER_DEG_LAT,
      longitude: ref.longitude + p.x / kx,
    }),
  };
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const { x, y } = projector(a).to(b);
  return Math.hypot(x, y);
}

// Ramer–Douglas–Peucker: drop points that sit within `tol` meters of the line
// through their neighbors. Turns a 300-point finger scribble into ~20 points.
export function simplify(points: LatLng[], tolMeters = 6): LatLng[] {
  if (points.length < 3) return points;
  const proj = projector(points[0]);
  const xy = points.map(proj.to);
  const keep = new Array(xy.length).fill(false);
  keep[0] = keep[xy.length - 1] = true;

  const stack: [number, number][] = [[0, xy.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(xy[i], xy[a], xy[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolMeters) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Smallest circle containing every vertex (Welzl, iterative form). iOS can only
// monitor circles, so this is what actually gets handed to CoreLocation.
export function enclosingCircle(points: LatLng[]): { center: LatLng; radius: number } {
  const proj = projector(points[0]);
  const pts = points.map(proj.to);
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }

  let c = { x: pts[0].x, y: pts[0].y, r: 0 };
  for (let i = 1; i < pts.length; i++) {
    if (inCircle(c, pts[i])) continue;
    c = { x: pts[i].x, y: pts[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inCircle(c, pts[j])) continue;
      c = circleFrom2(pts[i], pts[j]);
      for (let k = 0; k < j; k++) {
        if (inCircle(c, pts[k])) continue;
        c = circleFrom3(pts[i], pts[j], pts[k]) ?? c;
      }
    }
  }
  return { center: proj.from(c), radius: c.r };
}

type Circle = { x: number; y: number; r: number };
const inCircle = (c: Circle, p: XY) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 1e-6;

function circleFrom2(a: XY, b: XY): Circle {
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

function circleFrom3(a: XY, b: XY, c: XY): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

// Ray casting.
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.latitude > p.latitude !== b.latitude > p.latitude &&
      p.longitude <
        ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function areaSqMeters(poly: LatLng[]): number {
  if (poly.length < 3) return 0;
  const proj = projector(poly[0]);
  const xy = poly.map(proj.to);
  let sum = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    sum += (xy[j].x + xy[i].x) * (xy[j].y - xy[i].y);
  }
  return Math.abs(sum / 2);
}
