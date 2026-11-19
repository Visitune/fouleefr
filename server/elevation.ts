import type { ElevationPoint, FlatnessType, LatLngPoint } from '../src/types/route.ts';
import { TtlCache, fetchWithTimeout } from './http.ts';

export interface MeasuredElevation {
  profile: ElevationPoint[];
  gainM: number;
  lossM: number;
  flatness: Exclude<FlatnessType, 'inconnu'>;
}

const cache = new TtlCache<MeasuredElevation>(6 * 3600_000, 300);
const MAX_POINTS_PER_REQUEST = 100; // limite Open-Meteo

/** Dénivelé cumulé avec lissage (moyenne glissante) et seuil d'hystérésis de 3 m (bruit du MNT). */
export function computeGainLoss(elevations: number[]): { gain: number; loss: number } {
  const smooth = elevations.map((_, i) => {
    const a = elevations[Math.max(0, i - 1)];
    const b = elevations[i];
    const c = elevations[Math.min(elevations.length - 1, i + 1)];
    return (a + b + c) / 3;
  });
  const threshold = 3;
  let ref = smooth[0];
  let gain = 0;
  let loss = 0;
  for (const v of smooth) {
    if (v - ref >= threshold) {
      gain += v - ref;
      ref = v;
    } else if (ref - v >= threshold) {
      loss += ref - v;
      ref = v;
    }
  }
  return { gain, loss };
}

/**
 * Mesure l'altitude réelle des points (modèle numérique de terrain Open-Meteo).
 * `cumKm[i]` est la distance cumulée réelle du tracé au point i.
 * Renvoie null si le service est indisponible : aucune valeur n'est inventée.
 */
export async function measureElevation(
  points: LatLngPoint[],
  cumKm: number[]
): Promise<MeasuredElevation | null> {
  if (points.length < 2 || points.length > MAX_POINTS_PER_REQUEST) return null;

  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const lats = points.map((p) => p.lat.toFixed(5)).join(',');
  const lngs = points.map((p) => p.lng.toFixed(5)).join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

  let elevations: number[] | null = null;
  for (let attempt = 0; attempt < 2 && !elevations; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, 6000);
      if (!res.ok) continue;
      const data = (await res.json()) as { elevation?: unknown };
      if (
        Array.isArray(data.elevation) &&
        data.elevation.length === points.length &&
        data.elevation.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        elevations = data.elevation as number[];
      }
    } catch {
      // nouvelle tentative, puis abandon explicite (null)
    }
  }
  if (!elevations) return null;

  const { gain, loss } = computeGainLoss(elevations);
  const totalKm = Math.max(0.5, cumKm[cumKm.length - 1] ?? 0);
  const gainPerKm = gain / totalKm;
  const flatness: MeasuredElevation['flatness'] =
    gainPerKm <= 10 ? 'plat' : gainPerKm <= 24 ? 'vallonne' : 'exigeant';

  const result: MeasuredElevation = {
    profile: points.map((p, i) => ({
      distKm: Math.round(cumKm[i] * 100) / 100,
      ele: Math.round(elevations![i] * 10) / 10,
      lat: p.lat,
      lng: p.lng,
    })),
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    flatness,
  };
  cache.set(key, result);
  return result;
}
