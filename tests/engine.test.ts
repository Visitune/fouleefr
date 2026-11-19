import { describe, expect, it } from 'vitest';
import { computeGainLoss } from '../server/elevation.ts';
import {
  bearingDeg,
  distanceToSegmentM,
  haversineKm,
  offsetLatLng,
  simplifyIndices,
} from '../server/geo.ts';
import { RateLimiter, TtlCache } from '../server/http.ts';

describe('geo', () => {
  it('haversine : Paris -> Lyon ≈ 392 km', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 });
    expect(d).toBeGreaterThan(388);
    expect(d).toBeLessThan(396);
  });

  it('offsetLatLng est cohérent avec haversine et le cap', () => {
    const o = { lat: 45, lng: 3 };
    const p = offsetLatLng(o, 5, 90);
    expect(haversineKm(o, p)).toBeCloseTo(5, 2);
    expect(bearingDeg(o, p)).toBeCloseTo(90, 0);
  });

  it('distanceToSegmentM : point sur le segment = 0, perpendiculaire ≈ 111 m', () => {
    const a = { lat: 45, lng: 3 };
    const b = { lat: 45, lng: 3.01 };
    expect(distanceToSegmentM({ lat: 45, lng: 3.005 }, a, b)).toBeLessThan(0.5);
    expect(distanceToSegmentM({ lat: 45.001, lng: 3.005 }, a, b)).toBeGreaterThan(105);
    expect(distanceToSegmentM({ lat: 45.001, lng: 3.005 }, a, b)).toBeLessThan(115);
  });

  it('simplifyIndices garde les extrémités et respecte le maximum', () => {
    const path = Array.from({ length: 1000 }, (_, i) => ({
      lat: 45 + i * 0.0001,
      lng: 3 + Math.sin(i / 20) * 0.001,
    }));
    const idx = simplifyIndices(path, 100);
    expect(idx.length).toBeLessThanOrEqual(100);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(999);
  });
});

describe('elevation', () => {
  it('ignore le bruit < 3 m', () => {
    const { gain, loss } = computeGainLoss([100, 101, 100, 102, 100, 101]);
    expect(gain).toBe(0);
    expect(loss).toBe(0);
  });

  it('cumule une vraie montée puis descente', () => {
    const { gain, loss } = computeGainLoss([100, 110, 120, 130, 120, 110, 100]);
    // vraie montée de 30 m : le lissage rogne légèrement les extrémités, jamais plus de 1/3
    expect(gain).toBeGreaterThanOrEqual(20);
    expect(gain).toBeLessThanOrEqual(30);
    expect(loss).toBeGreaterThanOrEqual(20);
    expect(loss).toBeLessThanOrEqual(30);
  });
});

describe('http utils', () => {
  it('RateLimiter bloque au-delà du maximum', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    expect(rl.allow('b')).toBe(true);
  });

  it('TtlCache expire les entrées', async () => {
    const c = new TtlCache<number>(10);
    c.set('k', 1);
    expect(c.get('k')).toBe(1);
    await new Promise((r) => setTimeout(r, 25));
    expect(c.get('k')).toBeUndefined();
  });
});
