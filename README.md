# Foulée France

Découverte et génération de parcours de course à pied en France. Posez un point sur la carte : l'application calcule des boucles piétonnes réelles et indique, pour chacune, ce qui est **mesuré** et ce qui est **non renseigné**.

## Principe : aucune donnée inventée

| Donnée | Source | Si indisponible |
|---|---|---|
| Tracé et distance | Routage piéton OpenStreetMap (`routing.openstreetmap.de`, profil `foot`) | Aucun parcours n'est affiché |
| Altitude, D+ / D- | Modèle de terrain Open-Meteo (1 mesure par point du tracé, lissage + seuil 3 m) | « D+ n/d », pas de profil |
| Éclairage, revêtement | Étiquettes `lit` / `surface` OpenStreetMap (Overpass), tronçon par tronçon | « non renseigné » (jamais déduit) |
| Cours d'eau, parcs | Objets nommés OpenStreetMap à moins de 60 m / 10 m du tracé | Absent |
| Obstacles | Escaliers, voies rapides, `foot=no` dans OpenStreetMap | Aucun avertissement affiché |

Chaque parcours expose sa traçabilité (`dataQuality`) : part du tracé dont l'éclairage et le revêtement sont renseignés. L'éclairage ou le terrain n'est affiché que si au moins 40 % du tracé est renseigné.

Limites : OpenStreetMap est contributif. Un éclairage ou un revêtement manquant ne signifie pas son absence. L'estimation de durée est indicative (5 min 36 s/km + 6 s par mètre de D+).

## Lancer en local

```bash
npm install
npm run dev                  # http://localhost:3000
npm test                     # tests unitaires
npm run lint                 # vérification TypeScript (strict)
```

## Architecture

- `src/` : interface React 19 + Tailwind 4 + Leaflet (fonds OpenStreetMap / OpenTopoMap, aucune clé requise).
- `server/app.ts` : API Express (validation `zod`, limitation de débit 30 req/min/IP, emprise France) ; `server/geocode.ts` : recherche d'adresse Nominatim (≤ 1 requête/s, validée par l'utilisateur, sans autocomplétion à la frappe).
- `server/routesEngine.ts` : construction des parcours ; `server/osm.ts` : Overpass ; `server/elevation.ts` : altitudes ; `server/geo.ts` : géométrie ; `server/http.ts` : timeouts, cache, limiteur.
- `api/index.ts` : point d'entrée serverless Vercel (`vercel.json` réécrit `/api/*`).

## Déploiement Vercel

1. Importer le dépôt GitHub dans Vercel (framework : Vite, détecté automatiquement).
2. Variable d'environnement (facultative) : `APP_CONTACT` (e-mail ou URL du dépôt, transmis aux services OpenStreetMap).
3. Aucune clé d'API ni compte de facturation n'est nécessaire.

Le cache et le limiteur de débit sont en mémoire (par instance serverless) : suffisant pour un trafic modéré, à remplacer par un stockage partagé (Redis/KV) en cas de forte charge.

## Services tiers et vie privée

OpenStreetMap (fonds de carte, Overpass, Nominatim, routage), OpenTopoMap (fond Relief), Open-Meteo, ipwho.is (repli de géolocalisation : l'adresse IP du visiteur lui est transmise uniquement si le GPS du navigateur est refusé). Les polices sont embarquées (aucun appel à Google). Les favoris et signalements restent dans le `localStorage` du navigateur.

Données © contributeurs OpenStreetMap, licence ODbL.
