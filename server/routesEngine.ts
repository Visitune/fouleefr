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
  overlapFraction,
  sampleIndicesByDistance,
  shapeCompactness,
  simplifyIndices,
  turnMetrics,
} from './geo.ts';
import { TtlCache, UpstreamError, fetchWithTimeout } from './http.ts';
import { analyzePath, findPlaces, type OsmPlace } from './osm.ts';
import { fetchFootRoute, traceAttributes, type FootRoute, type TraceSummary } from './routing.ts';

/** Nombre max. de points conservés (profil d'altitude et tracé alignés 1:1 ; altitudes lues par lots de 100). */
const MAX_PATH_POINTS = 250;

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
  opts: BuildOptions,
  withElevation = true,
  attrs?: TraceSummary | null
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

  // Altitude : le modèle de terrain a ~90 m de résolution, mesurer plus finement n'apporte rien
  // et épuise le quota du service. ≈ 1 mesure tous les 100 m, 100 points au plus (1 requête).
  const elevIdx = sampleIndicesByDistance(cumKm, 0.1, 100);
  const [elev, osm] = await Promise.all([
    withElevation
      ? measureElevation(
          elevIdx.map((i) => shownPath[i]),
          elevIdx.map((i) => cumKm[i])
        )
      : Promise.resolve(null),
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
  const turns = turnMetrics(path);

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
    windinessDegPerKm: Math.round(turns.degPerKm),
    turnsPerKm: Math.round(turns.turnsPerKm * 10) / 10,
    // Étiquettes OSM (Overpass) si disponibles, sinon attributs du moteur de routage.
    greenwayPct: osm?.greenwayPct ?? attrs?.dedicatedPct,
    urbanStreetPct: osm?.urbanStreetPct ?? attrs?.roadPct,
    cobblePct: osm?.cobblePct ?? attrs?.roughPct,
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

type LoopShape = 'triangle' | 'quad';

/**
 * Points de passage d'une boucle. Le routeur choisit le plus court chemin entre eux :
 * la forme conditionne donc le nombre de virages.
 * - triangle : 2 points de passage, grands côtés → peu de virages
 * - quad : 3 points de passage autour d'un centre → boucle plus ronde
 */
function loopWaypoints(
  origin: LatLngPoint,
  shape: LoopShape,
  scaleKm: number,
  bearing: number
): LatLngPoint[] {
  if (shape === 'triangle') {
    return [
      origin,
      offsetLatLng(origin, scaleKm, bearing - 32),
      offsetLatLng(origin, scaleKm, bearing + 32),
      origin,
    ];
  }
  const center = offsetLatLng(origin, scaleKm * 0.9, bearing);
  return [
    origin,
    offsetLatLng(center, scaleKm * 0.85, bearing - 75),
    offsetLatLng(center, scaleKm * 0.95, bearing + 10),
    offsetLatLng(center, scaleKm * 0.85, bearing + 85),
    origin,
  ];
}

/** Échelle de départ par forme (le tracé réel fait ~1,3× la distance à vol d'oiseau). */
const SHAPE_BASE_DIVISOR: Record<LoopShape, number> = { triangle: 4.0, quad: 6.2 };

/**
 * Notation d'une boucle (sur 1). Principe repris de routess (ADR 0029) : chaque défaut
 * observé devient une mesure pénalisée. Le recouvrement pèse le plus (aller-retour, impasses).
 */
const SCORE_W = {
  overlap: 0.3, // pas de retour par le même chemin
  distance: 0.2, // proche de la distance demandée
  straightness: 0.25, // peu de virages
  compactness: 0.1, // vraie boucle, pas une languette
  character: 0.15, // voies dédiées, peu de chaussée / pavés / routes à fort trafic
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** ±10 % de la cible = parfait, puis décroissance en cloche. */
function distanceScore(actualKm: number, targetKm: number): number {
  const miss = Math.abs(actualKm - targetKm) / targetKm;
  if (miss <= 0.1) return 1;
  const over = (miss - 0.1) / 0.25;
  return Math.exp(-over * over);
}

/** 250 °/km (très direct) → 1 ; 550 °/km (très sinueux) → 0. Calibré sur des tracés réels de 8 km. */
const straightnessScore = (degPerKm: number) => clamp01(1 - (degPerKm - 250) / 300);

/** Caractère d'un tracé d'après le moteur : favorise les voies dédiées, pénalise rues, pavés et axes routiers. */
function characterScore(t: TraceSummary): number {
  return clamp01(
    0.6 * (t.dedicatedPct / 100) +
      0.4 * (1 - t.roadPct / 100) -
      0.8 * (t.roughPct / 100) -
      0.5 * (t.busyPct / 100)
  );
}

export async function generateSmartLoop(
  req: LoopGenerationRequest
): Promise<RunningRoute> {
  const origin: LatLngPoint = { lat: req.lat, lng: req.lng };
  const targetKm = Math.min(Math.max(req.targetKm, 1.5), 35);

  // Les lieux (Overpass) ne servent qu'à orienter les caps vers un cours d'eau : on ne les
  // demande que si c'est utile.
  const [places, cityName] = await Promise.all([
    req.preferWater ? findPlaces(req.lat, req.lng, Math.max(2, targetKm / 2)) : Promise.resolve(null),
    reverseGeocodeFrance(req.lat, req.lng),
  ]);

  // Caps : d'abord vers un cours d'eau proche, puis balayage régulier (6 caps).
  const bearings: number[] = [];
  const pushDistinct = (b: number) => {
    const close = bearings.some((e) => Math.abs(((e - b + 540) % 360) - 180) < 30);
    if (!close) bearings.push(b);
  };
  if (req.preferWater) {
    const w = places?.find((p) => p.category === 'water');
    if (w) pushDistinct(bearingDeg(origin, w));
  }
  for (const b of [20, 80, 140, 200, 260, 320]) {
    if (bearings.length >= 6) break;
    pushDistinct(b);
  }

  // Étage 1 (géométrie seule, peu coûteux) : on calcule de nombreux candidats.
  const jobs = bearings.flatMap((bearing) =>
    (['triangle', 'quad'] as const).map((shape) => ({ bearing, shape }))
  );

  const routed = await mapLimit(jobs, 3, async ({ bearing, shape }) => {
    const base = targetKm / SHAPE_BASE_DIVISOR[shape];
    let r = await fetchFootRoute(loopWaypoints(origin, shape, base, bearing));
    if (r) {
      const ratio = targetKm / r.distanceKm;
      if (ratio < 0.9 || ratio > 1.1) {
        const adj = base * Math.min(Math.max(ratio, 0.45), 1.85);
        const refined = await fetchFootRoute(loopWaypoints(origin, shape, adj, bearing));
        if (refined) r = refined;
      }
    }
    return r;
  });

  const geom = routed
    .filter((r): r is FootRoute => r !== null && r.distanceKm > 0.5)
    .map((r) => {
      const errRatio = Math.abs(r.distanceKm - targetKm) / targetKm;
      const turns = turnMetrics(r.path);
      const overlap = overlapFraction(r.path);
      const stage1 =
        (SCORE_W.overlap * (1 - clamp01(overlap * 2)) +
          SCORE_W.distance * distanceScore(r.distanceKm, targetKm) +
          SCORE_W.straightness * straightnessScore(turns.degPerKm) +
          SCORE_W.compactness * clamp01(shapeCompactness(r.path) / 0.6)) /
        (1 - SCORE_W.character);
      return { r, errRatio, overlap, stage1 };
    })
    .filter((c) => c.errRatio <= 0.25);

  // Barrière de qualité : on écarte les aller-retours (> 35 % de recouvrement) tant qu'il reste mieux.
  const clean = geom.filter((c) => c.overlap <= 0.35);
  const pool = (clean.length > 0 ? clean : geom).sort((a, b) => b.stage1 - a.stage1);

  if (pool.length === 0) {
    throw new UpstreamError(
      'routage',
      'aucune boucle piétonne réelle n’a pu être calculée à cette distance depuis ce point'
    );
  }

  // Étage 2 : les meilleurs candidats sont caractérisés par le moteur (revêtement, type de voie).
  const label = cityName || 'votre point';
  const top = pool.slice(0, req.preferFlat ? 4 : 3);
  const optsFor = (r: FootRoute, i: number): BuildOptions => ({
    id: `loop-${Math.round(req.lat * 1e4)}_${Math.round(req.lng * 1e4)}-${Math.round(targetKm * 10)}-${i}`,
    name: `Boucle ${fmtKm(r.distanceKm)} km`,
    city: cityName || 'Départ sur votre repère',
    source: 'generated_loop',
    origin,
    description: ({ distanceKm }) =>
      `Boucle piétonne de ${fmtKm(distanceKm)} km calculée sur le réseau OpenStreetMap depuis ${label}.`,
  });

  // Les préférences « cours d'eau », « éclairé » et « plat » exigent des données OSM / d'altitude
  // pour chaque finaliste ; sinon, seul le gagnant sera enrichi (économise Overpass et Open-Meteo).
  const needsFullBuild = req.preferWater || req.preferLit || req.preferFlat;
  const finalists = await Promise.all(
    top.map(async (c, i) => {
      const [attrs, built] = await Promise.all([
        traceAttributes(c.r.path),
        needsFullBuild ? buildRoute(c.r, optsFor(c.r, i), req.preferFlat) : Promise.resolve(null),
      ]);
      let score = SCORE_W.character > 0 ? c.stage1 * (1 - SCORE_W.character) : c.stage1;
      score += SCORE_W.character * (attrs ? characterScore(attrs) : 0.5); // 0,5 = neutre si inconnu
      if (built) {
        if (req.preferWater && built.alongWater) score += 0.08;
        if (req.preferLit && built.lighting !== 'inconnu') score += (built.litPercentage ?? 0) * 0.0008;
        if (req.preferFlat) {
          if (built.flatness === 'plat') score += 0.08;
          else if (built.flatness === 'vallonne') score += 0.03;
        }
        if (req.terrainPreference === 'bitume' && built.terrain === 'bitume') score += 0.06;
        if (
          req.terrainPreference === 'nature' &&
          (built.terrain === 'stabilise' || built.terrain === 'terre')
        ) {
          score += 0.06;
        }
        if (!built.practicable) score -= 0.3;
      }
      if (attrs && attrs.stepsKm > 0.01) score -= 0.15; // escaliers : à éviter
      return { c, attrs, built, score, i };
    })
  );

  finalists.sort((a, b) => b.score - a.score);
  const win = finalists[0];
  if (win.built && (req.preferFlat || win.built.elevationAvailable)) return win.built;
  return buildRoute(win.c.r, optsFor(win.c.r, win.i), true, win.attrs);
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
  const sideKm = Math.min(0.8, Math.max(0.35, place.distanceKm * 0.45));

  // Deux retours possibles (à gauche / à droite du lieu) : on garde le plus direct.
  const variants = await Promise.all(
    [70, -70].map((angle) =>
      fetchFootRoute([
        origin,
        target,
        offsetLatLng(target, sideKm, (bearing + angle + 360) % 360),
        origin,
      ])
    )
  );
  const valid = variants.filter((v): v is FootRoute => v !== null && v.distanceKm >= 0.8);
  if (valid.length === 0) return null;
  const foot = valid.sort(
    (a, b) => turnMetrics(a.path).degPerKm - turnMetrics(b.path).degPerKm
  )[0];

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
