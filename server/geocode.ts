import { TtlCache, Throttle, fetchWithTimeout } from './http.ts';

/** Une seule file pour tous les appels Nominatim de l'application (≤ 1 requête/s). */
export const nominatimGate = new Throttle(1100);

export interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
}

const cache = new TtlCache<GeocodeHit[]>(24 * 3600_000, 500);

/** Recherche d'un lieu en France (Nominatim). Renvoie null si le service est indisponible. */
export async function searchPlacesFrance(query: string): Promise<GeocodeHit[] | null> {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const hit = cache.get(q);
  if (hit) return hit;

  try {
    await nominatimGate.wait();
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=fr&limit=6&accept-language=fr&dedupe=1`,
      {},
      6000
    );
    if (!res.ok) return null;
    const items = (await res.json()) as {
      display_name?: string;
      name?: string;
      lat?: string;
      lon?: string;
    }[];
    if (!Array.isArray(items)) return null;

    const out: GeocodeHit[] = [];
    for (const it of items) {
      const lat = Number(it.lat);
      const lng = Number(it.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !it.display_name) continue;
      out.push({ label: it.display_name, lat, lng });
    }
    cache.set(q, out);
    return out;
  } catch {
    return null;
  }
}
