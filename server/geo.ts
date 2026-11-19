import type { LatLngPoint } from '../src/types/route.ts';

const R_KM = 6371;

export function haversineKm(a: LatLngPoint, b: LatLngPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const c =
    s1 * s1 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      s2 *
      s2;
  return 2 * R_KM * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

export function pathDistanceKm(path: LatLngPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

/** Cap initial (0-360°) de a vers b. */
export function bearingDeg(a: LatLngPoint, b: LatLngPoint): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function offsetLatLng(
  origin: LatLngPoint,
  distanceKm: number,
  bearing: number
): LatLngPoint {
  const brng = (bearing * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const dR = distanceKm / R_KM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) +
      Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Distance en mètres d'un point à un segment (projection équirectangulaire locale). */
export function distanceToSegmentM(
  p: LatLngPoint,
  a: LatLngPoint,
  b: LatLngPoint
): number {
  const kLat = 111320;
  const kLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lng - p.lng) * kLng;
  const ay = (a.lat - p.lat) * kLat;
  const bx = (b.lng - p.lng) * kLng;
  const by = (b.lat - p.lat) * kLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function perpendicularM(p: LatLngPoint, a: LatLngPoint, b: LatLngPoint): number {
  return distanceToSegmentM(p, a, b);
}

/**
 * Simplification de Douglas-Peucker : conserve la forme réelle du tracé.
 * Renvoie les indices conservés (au plus maxPoints), toujours triés.
 */
export function simplifyIndices(path: LatLngPoint[], maxPoints: number): number[] {
  const n = path.length;
  if (n <= maxPoints) return path.map((_, i) => i);

  const run = (tolM: number): number[] => {
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const stack: [number, number][] = [[0, n - 1]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      let maxD = 0;
      let idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = perpendicularM(path[i], path[s], path[e]);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (idx !== -1 && maxD > tolM) {
        keep[idx] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  };

  let lo = 0.5;
  let hi = 2000;
  let best = run(hi);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const res = run(mid);
    if (res.length <= maxPoints) {
      best = res;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}
