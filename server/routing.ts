import type { LatLngPoint } from '../src/types/route.ts';
import { simplifyIndices } from './geo.ts';
import { Throttle, TtlCache, fetchWithTimeout } from './http.ts';

export interface FootRoute {
  path: LatLngPoint[];
  distanceKm: number;
  provider: 'osrm' | 'valhalla';
}

const routeCache = new TtlCache<FootRoute>(3 * 3600_000, 400);

/**
 * Les deux services sont des instances communautaires gratuites (FOSSGIS) : on espace
 * les appels et on coupe un fournisseur défaillant pendant 45 s au lieu de le marteler.
 */
const gate = new Throttle(220);
const DOWN_MS = 45_000;
const downUntil: Record<FootRoute['provider'], number> = { osrm: 0, valhalla: 0 };

// router.project-osrm.org (démo) n'implémente que le profil voiture, quel que soit le segment
// d'URL. routing.openstreetmap.de expose un vrai profil piéton.
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';

/** Décode une polyligne encodée (Google/Valhalla) ; `precision` = 5 ou 6 décimales. */
export function decodePolyline(str: string, precision = 6): LatLngPoint[] {
  const factor = 10 ** precision;
  const out: LatLngPoint[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i <= str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    out.push({ lat: lat / factor, lng: lng / factor });
  }
  return out;
}

async function viaOsrm(waypoints: LatLngPoint[]): Promise<FootRoute | null> {
  const coords = waypoints.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  try {
    await gate.wait();
    const res = await fetchWithTimeout(
      `${OSRM_FOOT}/${coords}?overview=full&geometries=geojson&continue_straight=false`,
      {},
      9000
    );
    if (!res.ok) {
      downUntil.osrm = Date.now() + DOWN_MS;
      return null;
    }
    const data = (await res.json()) as {
      code?: string;
      routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
    };
    const r = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!r || !r.geometry?.coordinates?.length || !(r.distance > 0)) return null; // pas d'itinéraire : service sain
    return {
      path: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceKm: r.distance / 1000,
      provider: 'osrm',
    };
  } catch {
    downUntil.osrm = Date.now() + DOWN_MS;
    return null;
  }
}

async function viaValhalla(waypoints: LatLngPoint[]): Promise<FootRoute | null> {
  try {
    await gate.wait();
    const res = await fetchWithTimeout(
      VALHALLA,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: waypoints.map((p) => ({ lat: p.lat, lon: p.lng })),
          costing: 'pedestrian',
          directions_type: 'none',
        }),
      },
      9000
    );
    if (!res.ok) {
      if (res.status !== 400) downUntil.valhalla = Date.now() + DOWN_MS; // 400 = pas d'itinéraire
      return null;
    }
    const data = (await res.json()) as {
      trip?: { legs?: { shape: string }[]; summary?: { length?: number } };
    };
    const legs = data.trip?.legs ?? [];
    const km = data.trip?.summary?.length;
    if (legs.length === 0 || typeof km !== 'number' || !(km > 0)) return null;
    const path: LatLngPoint[] = [];
    for (const leg of legs) {
      const pts = decodePolyline(leg.shape, 6);
      path.push(...(path.length ? pts.slice(1) : pts)); // le dernier point d'un tronçon = le premier du suivant
    }
    return { path, distanceKm: km, provider: 'valhalla' };
  } catch {
    downUntil.valhalla = Date.now() + DOWN_MS;
    return null;
  }
}

/** Itinéraire piéton réel entre des points de passage, ou null (aucun tracé n'est jamais inventé). */
export async function fetchFootRoute(waypoints: LatLngPoint[]): Promise<FootRoute | null> {
  const key = waypoints.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const hit = routeCache.get(key);
  if (hit) return hit;

  let route: FootRoute | null = null;
  if (Date.now() >= downUntil.osrm) route = await viaOsrm(waypoints);
  if (!route && Date.now() >= downUntil.valhalla) route = await viaValhalla(waypoints);

  if (route) routeCache.set(key, route);
  return route;
}

/* ------------------------------------------------------------------ */
/* Caractère d'un tracé selon le moteur de routage (trace_attributes)  */
/* ------------------------------------------------------------------ */

export interface TraceSummary {
  totalKm: number;
  /** % sur voies dédiées aux piétons/cyclistes : chemins, sentiers, pistes, quais piétons. */
  dedicatedPct: number;
  /** % sur chaussée partagée avec les véhicules (rues, ruelles, voies de service). */
  roadPct: number;
  /** % sur revêtement rugueux (pavés, sett) : typique des centres anciens. */
  roughPct: number;
  /** % sur routes à fort trafic (primaire, secondaire, nationale). */
  busyPct: number;
  /** Longueur d'escaliers (km). */
  stepsKm: number;
}

const DEDICATED_USE = new Set([
  'footway', 'path', 'cycleway', 'track', 'bridleway', 'mountain_bike', 'pedestrian',
]);
const ROAD_USE = new Set([
  'road', 'living_street', 'alley', 'service_road', 'driveway', 'parking_aisle',
  'turn_channel', 'ramp', 'culdesac', 'drive_through', 'sidewalk',
]);
const BUSY_CLASS: Record<string, number> = { motorway: 1, trunk: 1, primary: 1, secondary: 0.6 };

const traceCache = new TtlCache<TraceSummary>(3 * 3600_000, 400);

/**
 * Attributs réels de chaque tronçon d'un tracé (revêtement, type de voie, classe de route),
 * calculés par Valhalla : un seul appel de ~1 s, sans Overpass. null si indisponible.
 */
export async function traceAttributes(path: LatLngPoint[]): Promise<TraceSummary | null> {
  if (path.length < 2 || Date.now() < downUntil.valhalla) return null;

  const idx = simplifyIndices(path, 400);
  const shape = idx.map((i) => ({ lat: path[i].lat, lon: path[i].lng }));
  const key = idx
    .filter((_, k) => k % 8 === 0)
    .map((i) => `${path[i].lat.toFixed(4)},${path[i].lng.toFixed(4)}`)
    .join('|');
  const hit = traceCache.get(key);
  if (hit) return hit;

  try {
    await gate.wait();
    const res = await fetchWithTimeout(
      'https://valhalla1.openstreetmap.de/trace_attributes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shape,
          costing: 'pedestrian',
          shape_match: 'map_snap',
          filters: {
            attributes: ['edge.length', 'edge.surface', 'edge.use', 'edge.road_class'],
            action: 'include',
          },
        }),
      },
      12000
    );
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) downUntil.valhalla = Date.now() + DOWN_MS;
      return null;
    }
    const data = (await res.json()) as {
      edges?: { length?: number; surface?: string; use?: string; road_class?: string }[];
    };
    const edges = data.edges ?? [];
    let total = 0;
    let dedicated = 0;
    let road = 0;
    let rough = 0;
    let busy = 0;
    let steps = 0;
    for (const e of edges) {
      const km = e.length ?? 0;
      total += km;
      if (e.use && DEDICATED_USE.has(e.use)) dedicated += km;
      else if (e.use && ROAD_USE.has(e.use)) road += km;
      if (e.use === 'steps') steps += km;
      if (e.surface === 'paved_rough') rough += km;
      busy += km * (BUSY_CLASS[e.road_class ?? ''] ?? 0);
    }
    if (total <= 0) return null;
    const pct = (v: number) => Math.round((v / total) * 100);
    const summary: TraceSummary = {
      totalKm: total,
      dedicatedPct: pct(dedicated),
      roadPct: pct(road),
      roughPct: pct(rough),
      busyPct: pct(busy),
      stepsKm: steps,
    };
    traceCache.set(key, summary);
    return summary;
  } catch {
    downUntil.valhalla = Date.now() + DOWN_MS;
    return null;
  }
}
