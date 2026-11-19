import express from 'express';
import net from 'net';
import { z } from 'zod';
import { searchPlacesFrance } from './geocode.ts';
import { RateLimiter, UpstreamError, fetchWithTimeout } from './http.ts';
import { discoverRoutesAroundPoint, generateSmartLoop } from './routesEngine.ts';

// Emprise France métropolitaine + Corse (+ marge) : le produit ne couvre que la France.
const LAT = z.coerce.number().min(41, 'hors de France').max(51.5, 'hors de France');
const LNG = z.coerce.number().min(-5.6, 'hors de France').max(9.8, 'hors de France');

const discoverQuery = z.object({
  lat: LAT,
  lng: LNG,
  radiusKm: z.coerce.number().min(1).max(10).default(5),
});

const geocodeQuery = z.object({
  q: z.string().trim().min(3).max(120),
});

const loopBody = z.object({
  lat: LAT,
  lng: LNG,
  targetKm: z.number().min(1.5).max(35),
  preferWater: z.boolean().optional().default(false),
  preferLit: z.boolean().optional().default(false),
  preferFlat: z.boolean().optional().default(false),
  terrainPreference: z.enum(['any', 'bitume', 'nature']).optional().default('any'),
});

function isPublicIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (net.isIPv6(ip)) return !(ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80'));
  const [a, b] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

export function createApp() {
  const app = express();
  // Derrière Vercel / un reverse proxy : req.ip reflète le vrai client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 30 requêtes / minute / IP sur les endpoints coûteux (ils appellent 4 services tiers).
  const heavyLimiter = new RateLimiter(30, 60_000);
  const limit: express.RequestHandler = (req, res, next) => {
    if (!heavyLimiter.allow(req.ip || 'unknown')) {
      res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });
      return;
    }
    next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Recherche d'un lieu (validée par l'utilisateur : Nominatim interdit l'autocomplétion à la frappe).
  app.get('/api/geocode', limit, async (req, res) => {
    const parsed = geocodeQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Saisissez au moins 3 caractères.' });
      return;
    }
    const results = await searchPlacesFrance(parsed.data.q);
    if (!results) {
      res.status(502).json({ error: 'Le service de recherche d’adresse est indisponible.' });
      return;
    }
    res.json({ results });
  });

  app.get('/api/ip-location', limit, async (req, res) => {
    try {
      const ip = req.ip || '';
      const url = isPublicIp(ip)
        ? `https://ipwho.is/${encodeURIComponent(ip)}`
        : 'https://ipwho.is/';
      const response = await fetchWithTimeout(url, {}, 4000);
      if (!response.ok) {
        res.json({ success: false });
        return;
      }
      const data = (await response.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
        country_code?: string;
      };
      if (
        data.success &&
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number'
      ) {
        res.json({
          success: true,
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || 'Votre secteur',
          countryCode: data.country_code || '',
        });
        return;
      }
      res.json({ success: false });
    } catch {
      res.json({ success: false });
    }
  });

  app.get('/api/discover', limit, async (req, res) => {
    const parsed = discoverQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paramètres invalides.' });
      return;
    }
    try {
      const { lat, lng, radiusKm } = parsed.data;
      res.json(await discoverRoutesAroundPoint(lat, lng, radiusKm));
    } catch (err) {
      console.error('Error in /api/discover:', err);
      res.status(502).json({ error: 'Impossible de charger les parcours alentour.' });
    }
  });

  app.post('/api/loop', limit, async (req, res) => {
    const parsed = loopBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paramètres invalides.' });
      return;
    }
    try {
      const route = await generateSmartLoop(parsed.data);
      res.json({ route });
    } catch (err) {
      console.error('Error in /api/loop:', err);
      if (err instanceof UpstreamError) {
        res.status(502).json({
          error:
            'Aucune boucle piétonne réelle n’a pu être calculée depuis ce point (service de routage indisponible ou réseau piéton insuffisant). Aucun tracé approximatif n’est affiché.',
        });
        return;
      }
      res.status(500).json({ error: 'Impossible de calculer la boucle.' });
    }
  });

  return app;
}
