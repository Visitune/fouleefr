import type {
  DifficultyLevel,
  EnvironmentType,
  FlatnessType,
  LatLngPoint,
  LoopGenerationRequest,
  RunningRoute,
} from '../src/types/route.ts';
import { measureElevation } from './elevation.ts';
import { nominatimGate } from './geocode.ts';
import {
  bearingDeg,
  haversineKm,
  offsetLatLng,
  simplifyIndices,
} from './geo.ts';
import { TtlCache, UpstreamError, fetchWithTimeout } from './http.ts';
import { analyzePath, findPlaces, type OsmPlace } from './osm.ts';

/** Nombre max. de points conservés (= limite Open-Meteo, profil et tracé alignés 1:1). */
const MAX_PATH_POINTS = 100;

/* ------------------------------------------------------------------ */
/* Géocodage inverse (Nominatim)                                       */
/* ------------------------------------------------------------------ */

const cityCache = new TtlCache<string | null>(24 * 3600_000, 500);

export async function reverseGeocodeFrance(
  lat: number,
  lng: number
): Promise<string | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cityCache.get(key);
  if (cached !== undefined) return cached;
  try {
    await nominatimGate.wait();
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&zoom=15&accept-language=fr`,
      {},
      5000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: Record<string, string | undefined>;
    };
    const a = data.address;
    if (!a) return null;
    const city = a.city || a.town || a.village || a.municipality || '';
    const district = a.neighbourhood || a.suburb || a.quarter || '';
    const label =
      city && district && city !== district ? `${city} — ${district}` : city || district || null;
    cityCache.set(key, label);
    return label;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Routage piéton (réseau OpenStreetMap, vrai profil « foot »)         */
/* ------------------------------------------------------------------ */

interface FootRoute {
  path: LatLngPoint[];
  distanceKm: number;
}

const routeCache = new TtlCache<FootRoute>(3 * 3600_000, 300);

// Le serveur de démonstration router.project-osrm.org n'implémente que le profil voiture,
// quel que soit le segment d'URL. routing.openstreetmap.de expose un vrai profil piéton.
const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

async function fetchFootRoute(waypoints: LatLngPoint[]): Promise<FootRoute | null> {
  const coords = waypoints.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const hit = routeCache.get(coords);
  if (hit) return hit;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${FOOT_ROUTER}/${coords}?overview=full&geometries=geojson&continue_straight=false`,
        {},
        9000
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        code?: string;
        routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
      };
      const r = data.code === 'Ok' ? data.routes?.[0] : undefined;
      if (!r || !r.geometry?.coordinates?.length || !(r.distance > 0)) continue;
      const out: FootRoute = {
        path: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceKm: r.distance / 1000,
      };
      routeCache.set(coords, out);
      return out;
    } catch {
      // nouvelle tentative puis abandon : aucun tracé inventé
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Construction d'un parcours vérifié                                  */
/* ------------------------------------------------------------------ */

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function fmtKm(km: number): string {
  return km.toFixed(1).replace('.', ',');
}

interface BuildOptions {
  id: string;
  name: string;
  city: string;
  source: RunningRoute['source'];
  origin: LatLngPoint;
  description: (r: { distanceKm: number }) => string;
}

async function buildRoute(
  foot: FootRoute,
  opts: BuildOptions
): Promise<RunningRoute> {
  const { path } = foot;

  // distance cumulée réelle sur le tracé complet, puis simplification qui conserve la forme
  const cumFull: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumFull.push(cumFull[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  const scale = cumFull[cumFull.length - 1] > 0 ? foot.distanceKm / cumFull[cumFull.length - 1] : 1;
  const keep = simplifyIndices(path, MAX_PATH_POINTS);
  const shownPath = keep.map((i) => path[i]);
  const cumKm = keep.map((i) => cumFull[i] * scale);

  const distanceKm = Math.round(foot.distanceKm * 10) / 10;

  const [elev, osm] = await Promise.all([
    measureElevation(shownPath, cumKm),
    analyzePath(path),
  ]);

  const flatness: FlatnessType = elev?.flatness ?? 'inconnu';
  const difficulty: DifficultyLevel =
    flatness === 'exigeant' || distanceKm >= 14
      ? 'sportif'
      : flatness === 'vallonne' || distanceKm >= 8
        ? 'modere'
        : 'facile';

  const gain = elev?.gainM ?? 0;
  const environment: EnvironmentType = osm?.environment ?? 'inconnu';

  const first = path[0];
  const last = path[path.length - 1];
  const isLoop = haversineKm(first, last) <= 0.05;

  return {
    id: opts.id,
    name: opts.name,
    city: opts.city,
    source: opts.source,
    distanceKm,
    elevationAvailable: Boolean(elev),
    elevationGainM: gain,
    elevationLossM: elev?.lossM ?? 0,
    estimatedMinutes: Math.max(5, Math.round(distanceKm * 5.6 + gain * 0.1)),
    difficulty,
    terrain: osm?.terrain ?? 'inconnu',
    lighting: osm?.lighting ?? 'inconnu',
    environment,
    alongWater: osm?.alongWater ?? false,
    waterName: osm?.waterName,
    isLoop,
    flatness,
    practicable: osm?.practicable ?? true,
    litPercentage: osm && osm.lighting !== 'inconnu' ? osm.litPct : undefined,
    surfaceSummary: osm?.surfaceSummary ?? 'Revêtement non vérifiable (OpenStreetMap indisponible)',
    safetyNotes:
      osm?.safetyNotes ?? [
        'Analyse OpenStreetMap indisponible : éclairage, revêtement et sécurité non vérifiés.',
      ],
    description: opts.description({ distanceKm }),
    startPoint: opts.origin,
    path: shownPath,
    elevationProfile: elev?.profile ?? [],
    dataQuality: {
      path: 'osrm-foot',
      elevation: elev ? 'measured' : 'unavailable',
      osmTags: osm ? 'available' : 'unavailable',
      lightingCoveragePct: osm?.lightingCoveragePct ?? 0,
      surfaceCoveragePct: osm?.surfaceCoveragePct ?? 0,
    },
    distanceFromAnchorKm: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Boucle à distance cible                                             */
/* ------------------------------------------------------------------ */

export async function generateSmartLoop(
  req: LoopGenerationRequest
): Promise<RunningRoute> {
  const origin: LatLngPoint = { lat: req.lat, lng: req.lng };
  const targetKm = Math.min(Math.max(req.targetKm, 1.5), 35);

  const [places, cityName] = await Promise.all([
    findPlaces(req.lat, req.lng, Math.max(2, targetKm / 2)),
    reverseGeocodeFrance(req.lat, req.lng),
  ]);

  const bearings: number[] = [];
  const pushDistinct = (b: number) => {
    const close = bearings.some((e) => {
      const d = Math.abs(((e - b + 540) % 360) - 180);
      return d < 35; // écart angulaire réel < 35°
    });
    if (!close) bearings.push(b);
  };
  if (req.preferWater) {
    const w = places?.find((p) => p.category === 'water');
    if (w) pushDistinct(bearingDeg(origin, w));
  }
  const park = places?.find((p) => p.category === 'park');
  if (park) pushDistinct(bearingDeg(origin, park));
  for (const b of [25, 115, 205, 295]) {
    if (bearings.length >= 4) break;
    pushDistinct(b);
  }

  const buildWaypoints = (rKm: number, bearing: number): LatLngPoint[] => {
    const center = offsetLatLng(origin, rKm * 0.9, bearing);
    return [
      origin,
      offsetLatLng(center, rKm * 0.85, bearing - 75),
      offsetLatLng(center, rKm * 0.95, bearing + 10),
      offsetLatLng(center, rKm * 0.85, bearing + 85),
      origin,
    ];
  };

  const baseRadiusKm = targetKm / 6.2;
  const routed = await Promise.all(
    bearings.map(async (bearing) => {
      let r = await fetchFootRoute(buildWaypoints(baseRadiusKm, bearing));
      if (r) {
        const ratio = targetKm / r.distanceKm;
        if (ratio < 0.9 || ratio > 1.1) {
          const adj = baseRadiusKm * Math.min(Math.max(ratio, 0.45), 1.85);
          const refined = await fetchFootRoute(buildWaypoints(adj, bearing));
          if (refined) r = refined;
        }
      }
      return r;
    })
  );

  // on ne garde que les boucles dont la distance réelle est proche de la cible
  const viable = routed
    .filter((r): r is FootRoute => r !== null && r.distanceKm > 0.5)
    .map((r) => ({ r, err: Math.abs(r.distanceKm - targetKm) / targetKm }))
    .filter((c) => c.err <= 0.25)
    .sort((a, b) => a.err - b.err)
    .slice(0, req.preferFlat ? 4 : 3); // « plat » : on compare toutes les boucles viables

  if (viable.length === 0) {
    throw new UpstreamError(
      'routage',
      'aucune boucle piétonne réelle n’a pu être calculée à cette distance depuis ce point'
    );
  }

  const label = cityName || 'votre point';
  const candidates = await Promise.all(
    viable.map(({ r }, i) =>
      buildRoute(r, {
        id: `loop-${Math.round(req.lat * 1e4)}_${Math.round(req.lng * 1e4)}-${Math.round(targetKm * 10)}-${i}`,
        name: `Boucle ${fmtKm(r.distanceKm)} km`,
        city: cityName || 'Départ sur votre repère',
        source: 'generated_loop',
        origin,
        description: ({ distanceKm }) =>
          `Boucle piétonne de ${fmtKm(distanceKm)} km calculée sur le réseau OpenStreetMap depuis ${label}.`,
      })
    )
  );

  const scored = candidates.map((c) => {
    let score = 100 - Math.abs(c.distanceKm - targetKm) * 3.5;
    if (req.preferWater && c.alongWater) score += 12;
    if (req.preferLit && c.lighting !== 'inconnu') score += (c.litPercentage ?? 0) * 0.12;
    if (req.preferFlat) {
      if (c.flatness === 'plat') score += 12;
      else if (c.flatness === 'vallonne') score += 4;
    }
    if (req.terrainPreference === 'bitume' && c.terrain === 'bitume') score += 10;
    if (
      req.terrainPreference === 'nature' &&
      (c.terrain === 'stabilise' || c.terrain === 'terre')
    ) {
      score += 10;
    }
    if (!c.practicable) score -= 40;
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/* ------------------------------------------------------------------ */
/* Découverte autour d'un point                                        */
/* ------------------------------------------------------------------ */

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function buildPlaceRoute(
  origin: LatLngPoint,
  place: OsmPlace,
  cityLabel: string,
  idx: number
): Promise<RunningRoute | null> {
  const target: LatLngPoint = { lat: place.lat, lng: place.lng };
  const bearing = bearingDeg(origin, target);
  const side = offsetLatLng(
    target,
    Math.min(0.8, Math.max(0.35, place.distanceKm * 0.45)),
    (bearing + (idx % 2 === 0 ? 70 : -70) + 360) % 360
  );

  const foot = await fetchFootRoute([origin, target, side, origin]);
  if (!foot || foot.distanceKm < 0.8) return null;

  const prefix =
    place.category === 'water'
      ? 'Parcours vers'
      : place.category === 'park'
        ? 'Boucle via'
        : 'Itinéraire par';

  return buildRoute(foot, {
    id: `osm-${slug(place.name)}-${Math.round(origin.lat * 1e3)}_${Math.round(origin.lng * 1e3)}`,
    name: `${prefix} ${place.name}`,
    city: cityLabel,
    source: 'osm',
    origin,
    description: ({ distanceKm }) =>
      `Boucle piétonne de ${fmtKm(distanceKm)} km calculée sur le réseau OpenStreetMap, passant par « ${place.name} » (à ${fmtKm(place.distanceKm)} km du repère).`,
  });
}

export interface DiscoverResult {
  routes: RunningRoute[];
  cityLabel: string;
  warnings: string[];
}

export async function discoverRoutesAroundPoint(
  lat: number,
  lng: number,
  radiusKm = 5
): Promise<DiscoverResult> {
  const origin: LatLngPoint = { lat, lng };
  const warnings: string[] = [];

  const [localCity, places] = await Promise.all([
    reverseGeocodeFrance(lat, lng),
    findPlaces(lat, lng, radiusKm),
  ]);
  const cityLabel = localCity || 'Secteur sélectionné';

  if (!places) {
    warnings.push(
      'OpenStreetMap (Overpass) est indisponible : impossible de repérer les parcs et cours d’eau. Réessayez dans un instant.'
    );
  }

  // au plus un lieu par catégorie en priorité, pour varier les propositions
  // On privilégie les lieux assez éloignés (≥ 35 % du rayon) : un lieu à 400 m ne donne
  // qu'une boucle d'1-2 km. Repli sur les plus proches s'il n'y en a pas assez.
  const inRange = (places ?? []).filter(
    (p) => p.distanceKm >= 0.25 && p.distanceKm <= radiusKm
  );
  const far = inRange.filter((p) => p.distanceKm >= radiusKm * 0.35);
  const pool = far.length >= 2 ? far : inRange;
  const picked: OsmPlace[] = [];
  for (const cat of ['park', 'water', 'trail'] as const) {
    const p = pool.find((x) => x.category === cat && !picked.includes(x));
    if (p) picked.push(p);
  }
  for (const p of pool) {
    if (picked.length >= 4) break;
    if (!picked.includes(p)) picked.push(p);
  }

  const built = await mapLimit(picked, 2, (p, i) =>
    buildPlaceRoute(origin, p, cityLabel, i)
  );
  const routes = built.filter((r): r is RunningRoute => r !== null);

  if (routes.length < 2) {
    try {
      const loop = await generateSmartLoop({
        lat,
        lng,
        targetKm: Math.min(5, Math.max(3, radiusKm)),
        preferWater: true,
        preferLit: false,
        preferFlat: false,
        terrainPreference: 'any',
      });
      loop.name = `Boucle ${fmtKm(loop.distanceKm)} km — ${cityLabel}`;
      routes.push(loop);
    } catch (err) {
      warnings.push(
        err instanceof UpstreamError
          ? 'Le service de routage piéton est indisponible ou n’a trouvé aucune boucle depuis ce point.'
          : 'Impossible de calculer une boucle depuis ce point.'
      );
    }
  }

  const seen = new Set<string>();
  const unique = routes.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return { routes: unique, cityLabel, warnings };
}
