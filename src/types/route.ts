export type DifficultyLevel = 'facile' | 'modere' | 'sportif';
export type TerrainType = 'bitume' | 'stabilise' | 'terre' | 'mixte' | 'inconnu';
export type LightingStatus = 'eclaire' | 'partiel' | 'non_eclaire' | 'inconnu';
export type EnvironmentType = 'ville' | 'parc' | 'campagne' | 'foret' | 'inconnu';
export type FlatnessType = 'plat' | 'vallonne' | 'exigeant' | 'inconnu';
export type PracticabilityStatus = 'praticable' | 'boueux' | 'travaux';

export interface LatLngPoint {
  lat: number;
  lng: number;
  ele?: number;
}

export interface ElevationPoint {
  distKm: number;
  ele: number;
  lat: number;
  lng: number;
}

/**
 * Traçabilité des données d'un parcours : rien n'est inventé, chaque
 * information indique d'où elle vient ou qu'elle est indisponible.
 */
export interface DataQuality {
  /** Le tracé est calculé par OSRM (réseau piéton OpenStreetMap). */
  path: 'osrm-foot';
  /** Altitudes mesurées (modèle numérique de terrain Open-Meteo) ou absentes. */
  elevation: 'measured' | 'unavailable';
  /** Étiquettes OpenStreetMap (éclairage, revêtement) récupérées via Overpass. */
  osmTags: 'available' | 'unavailable';
  /** Part du tracé dont l'éclairage est renseigné dans OSM (0-100). */
  lightingCoveragePct: number;
  /** Part du tracé dont le revêtement est renseigné dans OSM (0-100). */
  surfaceCoveragePct: number;
}

export interface RunningRoute {
  id: string;
  name: string;
  city: string;
  source: 'osm' | 'generated_loop';
  distanceKm: number;
  elevationAvailable: boolean;
  elevationGainM: number;
  elevationLossM: number;
  /** Estimation à allure fixe (5 min 36 s/km + 6 s par mètre de D+). */
  estimatedMinutes: number;
  difficulty: DifficultyLevel;
  terrain: TerrainType;
  lighting: LightingStatus;
  environment: EnvironmentType;
  alongWater: boolean;
  waterName?: string;
  isLoop: boolean;
  flatness: FlatnessType;
  /** false uniquement si OSM signale un obstacle (escaliers, axe rapide, accès interdit). */
  practicable: boolean;
  litPercentage?: number;
  surfaceSummary?: string;
  safetyNotes?: string[];
  description: string;
  startPoint: LatLngPoint;
  /** Même nombre de points que elevationProfile quand l'altitude est disponible. */
  path: LatLngPoint[];
  elevationProfile: ElevationPoint[];
  distanceFromAnchorKm?: number;
  dataQuality: DataQuality;
}

export interface RouteFilters {
  onlyLit: boolean;
  onlyWater: boolean;
  onlyFlat: boolean;
  onlyLoop: boolean;
  onlyPracticable: boolean;
  environment: EnvironmentType | 'all';
  terrain: TerrainType | 'all';
  difficulty: DifficultyLevel | 'all';
  distanceBucket: 'all' | 'short' | 'medium' | 'long';
  searchText: string;
}

export interface RouteReport {
  routeId: string;
  practicability: PracticabilityStatus;
  lightingOverride?: LightingStatus;
  rating: number;
  comment: string;
  updatedAt: string;
}

export interface LoopGenerationRequest {
  lat: number;
  lng: number;
  targetKm: number;
  preferWater: boolean;
  preferLit: boolean;
  preferFlat: boolean;
  terrainPreference: 'any' | 'bitume' | 'nature';
}
