import { describe, expect, it } from 'vitest';
import {
  offsetLatLng,
  overlapFraction,
  sampleIndicesByDistance,
  shapeCompactness,
  turnMetrics,
} from '../server/geo.ts';

const O = { lat: 45, lng: 3 };
const line = (n: number, bearing: number, stepKm: number) =>
  Array.from({ length: n }, (_, i) => offsetLatLng(O, i * stepKm, bearing));

describe('turnMetrics', () => {
  it('ligne droite : virage cumulé quasi nul', () => {
    expect(turnMetrics(line(60, 90, 0.05)).degPerKm).toBeLessThan(5);
  });

  it('zigzag : bien plus sinueux qu’une ligne droite', () => {
    const zig = Array.from({ length: 60 }, (_, i) =>
      offsetLatLng(offsetLatLng(O, i * 0.05, 90), (i % 2) * 0.06, 0)
    );
    expect(turnMetrics(zig).degPerKm).toBeGreaterThan(100);
  });
});

describe('overlapFraction (recouvrement)', () => {
  it('aller-retour pur ≈ 0,5', () => {
    const out = line(80, 90, 0.05);
    const back = [...out].reverse().slice(1);
    const f = overlapFraction([...out, ...back]);
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(0.6);
  });

  it('boucle carrée propre ≈ 0', () => {
    const a = O;
    const b = offsetLatLng(a, 1, 90);
    const c = offsetLatLng(b, 1, 0);
    const d = offsetLatLng(a, 1, 0);
    const seg = (p: typeof a, q: typeof a) =>
      Array.from({ length: 34 }, (_, i) => ({
        lat: p.lat + ((q.lat - p.lat) * i) / 33,
        lng: p.lng + ((q.lng - p.lng) * i) / 33,
      }));
    expect(overlapFraction([...seg(a, b), ...seg(b, c), ...seg(c, d), ...seg(d, a)])).toBeLessThan(0.05);
  });
});

describe('shapeCompactness', () => {
  it('carré ≈ 0,79 et languette dégénérée ≈ 0', () => {
    const a = O;
    const b = offsetLatLng(a, 1, 90);
    const c = offsetLatLng(b, 1, 0);
    const d = offsetLatLng(a, 1, 0);
    const seg = (p: typeof a, q: typeof a) =>
      Array.from({ length: 12 }, (_, i) => ({
        lat: p.lat + ((q.lat - p.lat) * i) / 11,
        lng: p.lng + ((q.lng - p.lng) * i) / 11,
      }));
    const square = shapeCompactness([...seg(a, b), ...seg(b, c), ...seg(c, d), ...seg(d, a)]);
    expect(square).toBeGreaterThan(0.7);
    expect(square).toBeLessThan(0.85);

    const out = line(80, 90, 0.05);
    expect(shapeCompactness([...out, ...[...out].reverse()])).toBeLessThan(0.05);
  });
});

describe('sampleIndicesByDistance', () => {
  it('garde les extrémités, respecte l’espacement et le maximum', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i * 0.01); // 10 km, 1 point / 10 m
    const idx = sampleIndicesByDistance(cum, 0.1, 100);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(999);
    expect(idx.length).toBeLessThanOrEqual(100);
    expect(idx.length).toBeGreaterThan(50);
  });
});
