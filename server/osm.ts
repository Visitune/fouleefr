import type {
  EnvironmentType,
  LatLngPoint,
  LightingStatus,
  TerrainType,
} from '../src/types/route.ts';
import { distanceToSegmentM, haversineKm, simplifyIndices } from './geo.ts';
import { TtlCache, fetchWithTimeout } from './http.ts';

// Miroirs interrogés en parallèle : le premier qui répond l'emporte.
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
}

const OVERPASS_TIMEOUT_MS = 9000;
const OVERPASS_COOLDOWN_MS = 60_000;
/** Disjoncteur : après un échec total, on ne retente pas Overpass pendant 60 s (échec immédiat). */
let overpassDownUntil = 0;

async function overpass(query: string): Promise<OverpassElement[] | null> {
  if (Date.now() < overpassDownUntil) return null;

  const attempt = async (endpoint: string): Promise<OverpassElement[]> => {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      },
      OVERPASS_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(data.elements)) throw new Error('réponse invalide');
    return data.elements;
  };

  try {
    // les miroirs sont interrogés en parallèle : le premier qui répond l'emporte
    const elements = await Promise.any(OVERPASS_ENDPOINTS.map(attempt));
    overpassDownUntil = 0;
    return elements;
  } catch {
    overpassDownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Lieux (parcs, forêts, cours d'eau) autour d'un point                */
/* ------------------------------------------------------------------ */

export interface OsmPlace {
  name: string;
  lat: number;
  lng: number;
  category: 'park' | 'water' | 'trail';
  distanceKm: number;
}

const placesCache = new TtlCache<OsmPlace[]>(3 * 3600_000, 200);

/** Parcs, plans d'eau, cours d'eau et voies vertes NOMMÉS dans OpenStreetMap. */
export async function findPlaces(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<OsmPlace[] | null> {
  const r = Math.round(Math.min(Math.max(radiusKm, 1), 10) * 1000);
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${r}`;
  const hit = placesCache.get(key);
  if (hit) return hit;

  const around = `(around:${r},${lat.toFixed(5)},${lng.toFixed(5)})`;
  // Requête volontairement légère : `nwr` (tous types d'objets) et la recherche de voies
  // vertes dépassaient le délai des serveurs (>20 s, réponse vide) sur un rayon de 5 km.
  const query = `[out:json][timeout:12];
(
  way["leisure"~"^(park|nature_reserve)$"]["name"]${around};
  rel["leisure"~"^(park|nature_reserve)$"]["name"]${around};
  way["landuse"="forest"]["name"]${around};
  way["waterway"~"^(river|canal)$"]["name"]${around};
  way["natural"="water"]["name"]["water"~"^(lake|reservoir|river|canal|lagoon|oxbow)$"]${around};
);
out tags center 300;`;

  const elements = await overpass(query);
  if (!elements) return null;

  const origin = { lat, lng };
  const places: OsmPlace[] = [];
  for (const el of elements) {
    const t = el.tags || {};
    const name = (t.name || '').trim();
    const c = el.center ?? (el.type === 'node' ? undefined : undefined);
    const pLat = c?.lat;
    const pLng = c?.lon;
    if (!name || pLat === undefined || pLng === undefined) continue;
    // fontaines, bassins et miroirs d'eau décoratifs : pas des cours d'eau où courir
    if (/\b(fontaine|bassin|miroir d'eau|pi[eè]ce d'eau|jet d'eau)\b/i.test(name)) continue;

    let category: OsmPlace['category'];
    if (t.waterway || t.natural === 'water') category = 'water';
    else if (t.highway) category = 'trail';
    else category = 'park';

    places.push({
      name,
      lat: pLat,
      lng: pLng,
      category,
      distanceKm: Math.round(haversineKm(origin, { lat: pLat, lng: pLng }) * 10) / 10,
    });
  }

  const seen = new Set<string>();
  const result = places
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((p) => {
      const k = `${p.category}:${p.name.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  placesCache.set(key, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Analyse d'un tracé à partir des étiquettes OSM réelles              */
/* ------------------------------------------------------------------ */

export interface PathAnalysis {
  /** Part (0-100) du tracé dont l'éclairage est renseigné. */
  lightingCoveragePct: number;
  /** Part (0-100) du tracé éclairé, parmi les tronçons renseignés. */
  litPct: number;
  lighting: LightingStatus;
  surfaceCoveragePct: number;
  terrain: TerrainType;
  environment: EnvironmentType;
  alongWater: boolean;
  waterName?: string;
  parkName?: string;
  practicable: boolean;
  /** Longueur (m) sur axes routiers rapides ou sans trottoir connu. */
  dangerM: number;
  stairsM: number;
  safetyNotes: string[];
  surfaceSummary: string;
  /** Noms de voies les plus longues empruntées. */
  mainWays: string[];
}

const PAVED = new Set([
  'asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes',
  'paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone', 'metal', 'bricks',
]);
const STABILISED = new Set([
  'compacted', 'fine_gravel', 'gravel', 'pebblestone', 'woodchips', 'rock',
]);
const SOFT = new Set([
  'unpaved', 'dirt', 'earth', 'ground', 'grass', 'mud', 'sand', 'wood', 'clay', 'grass_paver',
]);

const FAST_ROADS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const URBAN_HIGHWAYS = new Set([
  'residential', 'living_street', 'pedestrian', 'primary', 'secondary', 'tertiary',
  'unclassified', 'service', 'primary_link', 'secondary_link', 'tertiary_link',
]);
const NATURE_HIGHWAYS = new Set(['path', 'track', 'bridleway']);
const GREENWAY_HIGHWAYS = new Set(['footway', 'cycleway', 'steps']);

interface WayGeom {
  tags: Record<string, string>;
  pts: LatLngPoint[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const analysisCache = new TtlCache<PathAnalysis>(3 * 3600_000, 200);
const SAMPLE_STEP_M = 40;
const MATCH_MAX_M = 25;

function resampleByDistance(path: LatLngPoint[], stepM: number): LatLngPoint[] {
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

function nearestWay(p: LatLngPoint, ways: WayGeom[]): WayGeom | null {
  const dLat = MATCH_MAX_M / 111320;
  const dLng = MATCH_MAX_M / (111320 * Math.cos((p.lat * Math.PI) / 180));
  let best: WayGeom | null = null;
  let bestD = MATCH_MAX_M;
  for (const w of ways) {
    if (
      p.lat < w.minLat - dLat || p.lat > w.maxLat + dLat ||
      p.lng < w.minLng - dLng || p.lng > w.maxLng + dLng
    ) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const d = distanceToSegmentM(p, w.pts[i - 1], w.pts[i]);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
  }
  return best;
}

function surfaceClass(tags: Record<string, string>): TerrainType | null {
  const s = tags.surface;
  if (s) {
    if (PAVED.has(s)) return 'bitume';
    if (STABILISED.has(s)) return 'stabilise';
    if (SOFT.has(s)) return 'terre';
    return null;
  }
  // Revêtement non renseigné : on n'en déduit rien (sauf route classée, toujours revêtue en France).
  return null;
}

function isLitTag(v: string | undefined): boolean | null {
  if (!v) return null;
  if (v === 'yes' || v === '24/7' || v === 'automatic' || /^\d/.test(v)) return true;
  if (v === 'no' || v === 'disused') return false;
  return null;
}

/**
 * Analyse un tracé OSRM avec les étiquettes réelles d'OpenStreetMap.
 * Retourne null si Overpass est indisponible : l'appelant doit alors afficher
 * « inconnu » et non une valeur déduite.
 */
export async function analyzePath(path: LatLngPoint[]): Promise<PathAnalysis | null> {
  if (path.length < 2) return null;

  const idx = simplifyIndices(path, 80);
  const poly = idx.map((i) => `${path[i].lat.toFixed(5)},${path[i].lng.toFixed(5)}`).join(',');
  const key = poly;
  const hit = analysisCache.get(key);
  if (hit) return hit;

  const query = `[out:json][timeout:25];
way["highway"](around:20,${poly})->.h;
.h out tags geom;
(
  way["waterway"~"^(river|canal)$"]["name"](around:60,${poly});
  way["natural"="water"]["name"]["water"~"^(lake|reservoir|river|canal|lagoon|oxbow)$"](around:60,${poly});
  way["leisure"~"^(park|nature_reserve)$"]["name"](around:10,${poly});
  rel["leisure"~"^(park|nature_reserve)$"]["name"](around:10,${poly});
  way["landuse"="forest"]["name"](around:10,${poly});
  way["natural"="wood"]["name"](around:10,${poly});
);
out tags;`;

  const elements = await overpass(query);
  if (!elements) return null;

  const ways: WayGeom[] = [];
  let waterName: string | undefined;
  let parkName: string | undefined;
  let forestName: string | undefined;

  for (const el of elements) {
    const t = el.tags || {};
    if (t.highway && el.geometry && el.geometry.length >= 2) {
      const pts = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
      ways.push({
        tags: t,
        pts,
        minLat: Math.min(...pts.map((p) => p.lat)),
        maxLat: Math.max(...pts.map((p) => p.lat)),
        minLng: Math.min(...pts.map((p) => p.lng)),
        maxLng: Math.max(...pts.map((p) => p.lng)),
      });
      continue;
    }
    if (!t.name) continue;
    if (/\b(fontaine|bassin|miroir d'eau|pi[eè]ce d'eau|jet d'eau)\b/i.test(t.name)) continue;
    if (t.waterway || t.natural === 'water') waterName ??= t.name;
    else if (t.landuse === 'forest' || t.natural === 'wood') forestName ??= t.name;
    else if (t.leisure) parkName ??= t.name;
  }

  const samples = resampleByDistance(path, SAMPLE_STEP_M);
  const totalSamples = samples.length;
  if (totalSamples === 0) return null;

  let matched = 0;
  let litKnown = 0;
  let litYes = 0;
  let surfKnown = 0;
  const surfCount: Record<string, number> = { bitume: 0, stabilise: 0, terre: 0 };
  let urban = 0;
  let nature = 0;
  let greenway = 0;
  let dangerSamples = 0;
  let stairsSamples = 0;
  const wayLen = new Map<string, number>();

  for (const s of samples) {
    const w = nearestWay(s, ways);
    if (!w) continue;
    matched++;
    const t = w.tags;
    const hw = t.highway;

    const lit = isLitTag(t.lit);
    if (lit !== null) {
      litKnown++;
      if (lit) litYes++;
    }

    const sc = surfaceClass(t);
    if (sc && sc !== 'mixte' && sc !== 'inconnu') {
      surfKnown++;
      surfCount[sc]++;
    }

    if (URBAN_HIGHWAYS.has(hw)) urban++;
    else if (NATURE_HIGHWAYS.has(hw)) nature++;
    else if (GREENWAY_HIGHWAYS.has(hw)) greenway++;

    const noSidewalk =
      !t.sidewalk && !t.footway && (hw === 'primary' || hw === 'secondary' || hw === 'trunk');
    if (FAST_ROADS.has(hw) || t.foot === 'no' || noSidewalk) dangerSamples++;
    if (hw === 'steps') stairsSamples++;

    if (t.name) wayLen.set(t.name, (wayLen.get(t.name) || 0) + 1);
  }

  if (matched / totalSamples < 0.5) return null; // données OSM insuffisantes pour conclure

  const lightingCoveragePct = Math.round((litKnown / matched) * 100);
  const litPct = litKnown > 0 ? Math.round((litYes / litKnown) * 100) : 0;
  const lighting: LightingStatus =
    lightingCoveragePct < 40
      ? 'inconnu'
      : litPct >= 75
        ? 'eclaire'
        : litPct >= 25
          ? 'partiel'
          : 'non_eclaire';

  const surfaceCoveragePct = Math.round((surfKnown / matched) * 100);
  let terrain: TerrainType = 'inconnu';
  if (surfaceCoveragePct >= 40) {
    const top = (Object.entries(surfCount) as [TerrainType, number][]).sort(
      (a, b) => b[1] - a[1]
    )[0];
    terrain = top[1] / surfKnown >= 0.7 ? top[0] : 'mixte';
  }

  const urbanShare = urban / matched;
  // `footway` / `cycleway` désignent aussi les trottoirs et pistes en pleine ville :
  // ils comptent pour un parc ou une forêt nommé(e), jamais pour la « campagne ».
  const pathShare = (nature + greenway) / matched;
  const trailShare = nature / matched; // path, track, bridleway uniquement
  let environment: EnvironmentType = 'ville';
  if (forestName && pathShare >= 0.3) environment = 'foret';
  else if (parkName && pathShare >= 0.3) environment = 'parc';
  else if (trailShare >= 0.6 && urbanShare < 0.3) environment = 'campagne';

  const dangerM = dangerSamples * SAMPLE_STEP_M;
  const stairsM = stairsSamples * SAMPLE_STEP_M;
  const practicable = dangerM <= 200 && stairsM === 0;

  const mainWays = [...wayLen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n]) => n);

  const safetyNotes: string[] = [];
  if (dangerM > 200) {
    safetyNotes.push(
      `~${dangerM} m sur axe routier rapide ou sans trottoir renseigné dans OpenStreetMap : vérifiez sur place.`
    );
  }
  if (stairsM > 0) {
    safetyNotes.push(`Escaliers présents sur ~${stairsM} m (non adaptés à tous les parcours).`);
  }
  if (lighting === 'inconnu') {
    safetyNotes.push(
      `Éclairage non renseigné dans OpenStreetMap sur ${100 - lightingCoveragePct}% du tracé : ne pas le supposer éclairé.`
    );
  } else if (lighting !== 'eclaire') {
    safetyNotes.push('Éclairage partiel ou absent selon OpenStreetMap : prévoir une lampe frontale.');
  }
  if (safetyNotes.length === 0) {
    safetyNotes.push('Aucun point de vigilance signalé dans OpenStreetMap sur ce tracé.');
  }

  const surfaceSummary =
    terrain === 'inconnu'
      ? 'Revêtement non renseigné dans OpenStreetMap'
      : terrain === 'bitume'
        ? 'Majoritairement revêtu (bitume, pavés, dalles)'
        : terrain === 'stabilise'
          ? 'Majoritairement stabilisé (gravier, sable compacté)'
          : terrain === 'terre'
            ? 'Majoritairement sentier ou terre'
            : 'Revêtements mixtes';

  const result: PathAnalysis = {
    lightingCoveragePct,
    litPct,
    lighting,
    surfaceCoveragePct,
    terrain,
    environment,
    alongWater: Boolean(waterName),
    waterName,
    parkName: parkName ?? forestName,
    practicable,
    dangerM,
    stairsM,
    safetyNotes,
    surfaceSummary,
    mainWays,
  };
  analysisCache.set(key, result);
  return result;
}
