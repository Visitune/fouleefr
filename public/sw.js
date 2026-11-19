/* Service worker de Foulée France.
 *
 * Objectif : l'interface s'ouvre même sans réseau (favoris consultables).
 * - Les appels /api/* ne sont JAMAIS mis en cache : les parcours restent toujours frais
 *   et aucune donnée approximative ne peut être resservie à la place d'un calcul réel.
 * - Les tuiles de carte (autre origine) ne sont pas interceptées : la politique d'usage
 *   d'OpenStreetMap n'autorise pas le stockage massif de tuiles.
 */
const VERSION = 'v1';
const SHELL_CACHE = `foulee-shell-${VERSION}`;
const ASSET_CACHE = `foulee-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      const assets = await caches.open(ASSET_CACHE);
      const res = await fetch('/', { cache: 'reload' });
      const html = await res.clone().text();
      await shell.put('/', res);

      // Pré-charge les fichiers référencés par la page (noms hachés par le build).
      const urls = new Set(html.match(/\/(?:assets|icons)\/[^"')\s]+/g) || []);
      await Promise.all([...urls].map((u) => assets.add(u).catch(() => {})));

      // Polices citées dans les feuilles de style : alphabet latin (accents français) en
      // woff2 uniquement. Les autres alphabets seront mis en cache s'ils sont un jour utilisés.
      for (const u of urls) {
        if (!u.endsWith('.css')) continue;
        try {
          const css = await (await fetch(u)).text();
          const inner = new Set(css.match(/\/assets\/[^"')\s]*-latin-\d[^"')\s]*\.woff2/g) || []);
          await Promise.all([...inner].map((f) => assets.add(f).catch(() => {})));
        } catch {
          /* ignoré : mis en cache à la première utilisation */
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tuiles, services tiers : le navigateur gère
  if (url.pathname.startsWith('/api/')) return; // jamais de cache pour les données dynamiques
  if (url.pathname === '/sw.js') return;

  // Navigation : réseau d'abord (version à jour), page en cache si hors connexion.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/', fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match('/');
          return (
            cached ||
            new Response('Hors connexion', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  // Fichiers du build (noms hachés, immuables) : cache d'abord.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSET_CACHE)).put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Icônes, manifeste : on sert le cache et on rafraîchit en arrière-plan.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
