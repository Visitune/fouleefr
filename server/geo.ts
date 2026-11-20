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

/** Rééchantillonne un tracé à pas régulier (en mètres). */
export function resampleByDistance(path: LatLngPoint[], stepM: number): LatLngPoint[] {
  if (path.length === 0) return [];
  const out: LatLngPoint[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    let segM = haversineKm(path[i - 1], path[i]) * 1000;
    if (segM === 0) continue;
    let from = path[i - 1];
    while (carry + segM >= stepM) {
      const t = (stepM - carry) / segM;
      const p = {
        lat: from.lat + (path[i].lat - from.lat) * t,
        lng: from.lng + (path[i].lng - from.lng) * t,
      };
      out.push(p);
      from = p;
      segM = haversineKm(from, path[i]) * 1000;
      carry = 0;
    }
    carry += segM;
  }
  return out;
}

export interface TurnMetrics {
  /** Virage cumulé par km (°/km) : ~0 = ligne droite, élevé = tracé sinueux. */
  degPerKm: number;
  /** Nombre de virages marqués (≥ 35° sur 40 m) par km. */
  turnsPerKm: number;
}

/**
 * Mesure la rectitude d'un tracé. Le tracé est rééchantillonné tous les 40 m pour ignorer
 * le bruit de la géométrie OSM, puis on cumule les changements de cap.
 * Une boucle fermée vaut au minimum 360° au total (≈ 360 / longueur en km, par km).
 */
export function turnMetrics(path: LatLngPoint[], stepM = 40): TurnMetrics {
  const pts = resampleByDistance(path, stepM);
  if (pts.length < 3) return { degPerKm: 0, turnsPerKm: 0 };
  let total = 0;
  let turns = 0;
  let prev = bearingDeg(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i++) {
    const h = bearingDeg(pts[i - 1], pts[i]);
    const d = Math.abs(((h - prev + 540) % 360) - 180);
    total += d;
    if (d >= 35) turns++;
    prev = h;
  }
  const km = ((pts.length - 1) * stepM) / 1000;
  return { degPerKm: total / km, turnsPerKm: turns / km };
}

/**
 * Choisit des indices espacés d'au moins `minStepKm` (distance cumulée `cumKm`), au plus
 * `maxPoints`, en gardant toujours le premier et le dernier point.
 */
export function sampleIndicesByDistance(
  cumKm: number[],
  minStepKm: number,
  maxPoints: number
): number[] {
  const n = cumKm.length;
  if (n <= 2) return cumKm.map((_, i) => i);
  const total = cumKm[n - 1];
  const step = Math.max(minStepKm, total / Math.max(1, maxPoints - 4));
  const idx = [0];
  let last = 0;
  for (let i = 1; i < n - 1; i++) {
    if (cumKm[i] - cumKm[last] >= step) {
      idx.push(i);
      last = i;
    }
  }
  idx.push(n - 1);
  return idx;
}

/**
 * Recouvrement (0-1) : part du tracé qui repasse à moins de `radiusM` d'un point déjà parcouru
 * au moins `minGapM` plus tôt. Un aller-retour pur vaut ≈ 0,5 (le retour recouvre l'aller),
 * une boucle propre ≈ 0. Mesure inspirée de la notation de routess (ADR 0029), où l'aller-retour
 * est le défaut n°1 des boucles générées.
 */
export function overlapFraction(
  path: LatLngPoint[],
  stepM = 30,
  radiusM = 18,
  minGapM = 250
): number {
  const pts = resampleByDistance(path, stepM);
  const n = pts.length;
  if (n < 8) return 0;

  const kLat = 111320;
  const kLng = 111320 * Math.cos((pts[0].lat * Math.PI) / 180);
  const xy = pts.map((p) => [p.lng * kLng, p.lat * kLat] as const);
  const gapSteps = Math.ceil(minGapM / stepM);
  const cell = radiusM;

  const grid = new Map<string, number[]>();
  let overlapping = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = xy[i];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (i - j >= gapSteps && Math.hypot(x - xy[j][0], y - xy[j][1]) <= radiusM) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) overlapping++;
    const k = `${cx},${cy}`;
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }
  return overlapping / n;
}

/**
 * Compacité de la boucle : quotient isopérimétrique 4πA/P² (cercle = 1, carré ≈ 0,79,
 * triangle équilatéral ≈ 0,60, aller-retour dégénéré ≈ 0). Écarte les formes en « languette ».
 */
export function shapeCompactness(path: LatLngPoint[]): number {
  const pts = resampleByDistance(path, 100);
  if (pts.length < 4) return 0;
  const kx = Math.cos((pts[0].lat * Math.PI) / 180);
  const q = pts.map((p) => [p.lng * kx, p.lat] as const);
  let area2 = 0;
  let perimeter = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % q.length];
    area2 += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  if (perimeter <= 0) return 0;
  return Math.min(1, (4 * Math.PI * (Math.abs(area2) / 2)) / (perimeter * perimeter));
}
