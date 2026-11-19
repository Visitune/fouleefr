import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzePath } from '../server/osm.ts';

// Tracé de ~300 m le long de lat 45, lng 3 → 3.004
const path = Array.from({ length: 11 }, (_, i) => ({ lat: 45, lng: 3 + i * 0.0004 }));
const geom = path.map((p) => ({ lat: p.lat, lon: p.lng }));

function mockOverpass(elements: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('analyzePath (réponse Overpass simulée)', () => {
  it('lit les étiquettes lit / surface réelles et le cours d’eau voisin', async () => {
    mockOverpass([
      {
        type: 'way', id: 1,
        tags: { highway: 'residential', name: 'Rue Test', lit: 'yes', surface: 'asphalt' },
        geometry: geom,
      },
      { type: 'way', id: 2, tags: { waterway: 'river', name: 'Le Rhône' } },
    ]);
    const a = await analyzePath(path);
    expect(a).not.toBeNull();
    expect(a!.lighting).toBe('eclaire');
    expect(a!.lightingCoveragePct).toBe(100);
    expect(a!.terrain).toBe('bitume');
    expect(a!.alongWater).toBe(true);
    expect(a!.waterName).toBe('Le Rhône');
    expect(a!.practicable).toBe(true);
  });

  it('n’invente rien quand les étiquettes sont absentes : « inconnu »', async () => {
    const p2 = path.map((p) => ({ lat: p.lat + 0.01, lng: p.lng }));
    mockOverpass([
      {
        type: 'way', id: 3,
        tags: { highway: 'residential', name: 'Rue Sans Tags' },
        geometry: p2.map((p) => ({ lat: p.lat, lon: p.lng })),
      },
    ]);
    const a = await analyzePath(p2);
    expect(a).not.toBeNull();
    expect(a!.lighting).toBe('inconnu');
    expect(a!.terrain).toBe('inconnu');
    expect(a!.lightingCoveragePct).toBe(0);
    expect(a!.surfaceCoveragePct).toBe(0);
  });

  it('signale des escaliers comme non praticables', async () => {
    const p3 = path.map((p) => ({ lat: p.lat + 0.02, lng: p.lng }));
    mockOverpass([
      {
        type: 'way', id: 4,
        tags: { highway: 'steps', lit: 'yes', surface: 'concrete' },
        geometry: p3.map((p) => ({ lat: p.lat, lon: p.lng })),
      },
    ]);
    const a = await analyzePath(p3);
    expect(a!.practicable).toBe(false);
    expect(a!.stairsM).toBeGreaterThan(0);
  });

  it('renvoie null (et non des valeurs déduites) si trop peu de voies correspondent', async () => {
    const p4 = path.map((p) => ({ lat: p.lat + 0.03, lng: p.lng }));
    mockOverpass([
      {
        type: 'way', id: 5,
        tags: { highway: 'residential', lit: 'yes' },
        geometry: [{ lat: 46, lon: 5 }, { lat: 46.001, lon: 5 }],
      },
    ]);
    expect(await analyzePath(p4)).toBeNull();
  });
});
