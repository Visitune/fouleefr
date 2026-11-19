import type {
  DifficultyLevel,
  EnvironmentType,
  FlatnessType,
  LightingStatus,
  PracticabilityStatus,
  RouteFilters,
  RouteReport,
  RunningRoute,
  TerrainType,
} from '../types/route';

export const DEFAULT_FILTERS: RouteFilters = {
  onlyLit: false,
  onlyWater: false,
  onlyFlat: false,
  onlyLoop: false,
  onlyPracticable: false,
  environment: 'all',
  terrain: 'all',
  difficulty: 'all',
  distanceBucket: 'all',
  searchText: '',
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  facile: 'Facile',
  modere: 'Modéré',
  sportif: 'Sportif',
};

export const TERRAIN_LABELS: Record<TerrainType, string> = {
  bitume: 'Bitume',
  stabilise: 'Stabilisé / Gravier',
  terre: 'Sentier / Terre',
  mixte: 'Mixte',
  inconnu: 'Revêtement non renseigné',
};

export const LIGHTING_LABELS: Record<LightingStatus, string> = {
  eclaire: 'Éclairé',
  partiel: 'Partiellement éclairé',
  non_eclaire: 'Non éclairé',
  inconnu: 'Éclairage non renseigné',
};

export const ENVIRONMENT_LABELS: Record<EnvironmentType, string> = {
  ville: 'En ville',
  parc: 'Parc urbain',
  campagne: 'Campagne',
  foret: 'Forêt',
  inconnu: 'Non déterminé',
};

export const FLATNESS_LABELS: Record<FlatnessType, string> = {
  plat: 'Plat',
  vallonne: 'Vallonné',
  exigeant: 'Exigeant',
  inconnu: 'Relief non mesuré',
};

export const PRACTICABILITY_LABELS: Record<PracticabilityStatus, string> = {
  praticable: 'Terrain praticable',
  boueux: 'Boueux / Dégradé',
  travaux: 'Travaux signalés',
};

export function formatDistanceKm(km: number): string {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function formatDurationMin(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportRouteToGpx(route: RunningRoute): void {
  const escapedName = escapeXml(route.name);

  // Le profil d'altitude a exactement un point par point du tracé (garanti par le serveur).
  // Sans altitude mesurée, la balise <ele> est omise : aucune valeur n'est inventée.
  const hasEle =
    route.elevationAvailable && route.elevationProfile.length === route.path.length;

  const trkpts = route.path
    .map((p, i) => {
      const ele = hasEle ? `<ele>${route.elevationProfile[i].ele.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${ele}</trkpt>`;
    })
    .join('\n');
  const gainDesc = route.elevationAvailable ? ` - D+ ${route.elevationGainM}m` : '';

  const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Foulee France" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapedName}</name>
    <desc>${escapedName} - ${formatDistanceKm(route.distanceKm)}${gainDesc}. Données © contributeurs OpenStreetMap (ODbL).</desc>
  </metadata>
  <trk>
    <name>${escapedName}</name>
    <type>running</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = route.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  a.href = url;
  a.download = `${slug || 'parcours'}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FAVORITES_KEY = 'foulee_france_favorites_v1';
const REPORTS_KEY = 'foulee_france_reports_v1';

export function loadFavorites(): RunningRoute[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Les favoris d'anciennes versions (sans traçabilité des données) sont écartés.
    return parsed.filter(
      (r): r is RunningRoute =>
        r &&
        typeof r.id === 'string' &&
        Array.isArray(r.path) &&
        Array.isArray(r.elevationProfile) &&
        r.dataQuality &&
        typeof r.dataQuality === 'object'
    );
  } catch {
    return [];
  }
}

export function saveFavorites(routes: RunningRoute[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(routes));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadReports(): Record<string, RouteReport> {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveReport(report: RouteReport): Record<string, RouteReport> {
  const existing = loadReports();
  const updated = { ...existing, [report.routeId]: report };
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota issues
  }
  return updated;
}

export function applyReportToRoute(
  route: RunningRoute,
  report?: RouteReport
): RunningRoute & { report?: RouteReport } {
  if (!report) return route;
  return {
    ...route,
    lighting: report.lightingOverride ?? route.lighting,
    practicable: report.practicability === 'praticable',
    report,
  };
}

export function filterRoutes(
  routes: RunningRoute[],
  filters: RouteFilters,
  reports: Record<string, RouteReport>
): RunningRoute[] {
  return routes
    .map((r) => applyReportToRoute(r, reports[r.id]))
    .filter((r) => {
      if (filters.onlyLit && r.lighting !== 'eclaire') return false;
      if (filters.onlyWater && !r.alongWater) return false;
      if (filters.onlyFlat && r.flatness !== 'plat') return false;
      if (filters.onlyLoop && !r.isLoop) return false;
      if (filters.onlyPracticable && !r.practicable) return false;
      if (filters.environment !== 'all' && r.environment !== filters.environment) {
        return false;
      }
      if (filters.terrain !== 'all' && r.terrain !== filters.terrain) {
        return false;
      }
      if (filters.difficulty !== 'all' && r.difficulty !== filters.difficulty) {
        return false;
      }
      if (filters.distanceBucket === 'short' && r.distanceKm >= 5) return false;
      if (
        filters.distanceBucket === 'medium' &&
        (r.distanceKm < 5 || r.distanceKm > 10)
      ) {
        return false;
      }
      if (filters.distanceBucket === 'long' && r.distanceKm <= 10) return false;
      if (filters.searchText.trim()) {
        const q = filters.searchText.trim().toLowerCase();
        const hay = `${r.name} ${r.city} ${r.waterName || ''} ${r.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}
