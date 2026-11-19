import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Route as RouteIcon,
  X,
} from 'lucide-react';
import { FilterBar } from './components/FilterBar';
import { LoopBuilder } from './components/LoopBuilder';
import { RouteCard } from './components/RouteCard';
import { RouteDetail } from './components/RouteDetail';
import { RunningMap } from './components/RunningMap';
import { SearchBar } from './components/SearchBar';
import { TopBar, type ActiveTab } from './components/TopBar';
import type {
  LatLngPoint,
  LoopGenerationRequest,
  RouteFilters,
  RouteReport,
  RunningRoute,
} from './types/route';
import {
  DEFAULT_FILTERS,
  filterRoutes,
  loadFavorites,
  loadReports,
  saveFavorites,
  saveReport,
} from './utils/formatters';

const DEFAULT_PARIS_ANCHOR: LatLngPoint = { lat: 48.8588, lng: 2.2945 };

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('explore');
  const [anchor, setAnchor] = useState<LatLngPoint>(DEFAULT_PARIS_ANCHOR);
  const [anchorLabel, setAnchorLabel] = useState<string>('Paris — Champ-de-Mars');
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [centerTrigger, setCenterTrigger] = useState<number>(0);

  const [routes, setRoutes] = useState<RunningRoute[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(true);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverWarnings, setDiscoverWarnings] = useState<string[]>([]);
  const discoverAbort = useRef<AbortController | null>(null);

  const [selectedRoute, setSelectedRoute] = useState<RunningRoute | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const [elevationHoverPoint, setElevationHoverPoint] =
    useState<LatLngPoint | null>(null);

  const [filters, setFilters] = useState<RouteFilters>(DEFAULT_FILTERS);
  const [favorites, setFavorites] = useState<RunningRoute[]>(() =>
    loadFavorites()
  );
  const [reports, setReports] = useState<Record<string, RouteReport>>(() =>
    loadReports()
  );

  const [isGeolocating, setIsGeolocating] = useState(false);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);
  const [isGeneratingLoop, setIsGeneratingLoop] = useState(false);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(true);

  // Fetch routes around anchor
  const fetchRoutesAtPoint = useCallback(
    async (point: LatLngPoint, rKm: number, customLabel?: string) => {
      // annule la requête précédente : seule la dernière position fait foi
      discoverAbort.current?.abort();
      const controller = new AbortController();
      discoverAbort.current = controller;
      setIsLoadingRoutes(true);
      setDiscoverError(null);
      setDiscoverWarnings([]);
      try {
        const res = await fetch(
          `/api/discover?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}&radiusKm=${rKm}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'Erreur serveur');
        }
        const data = (await res.json()) as {
          routes: RunningRoute[];
          cityLabel?: string;
          warnings?: string[];
        };
        setRoutes(data.routes || []);
        setDiscoverWarnings(data.warnings || []);
        if (
          data.cityLabel &&
          (!customLabel || customLabel.startsWith('Point ('))
        ) {
          setAnchorLabel(data.cityLabel);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setDiscoverError(
          err instanceof Error && err.message && err.message !== 'Erreur serveur'
            ? err.message
            : 'Impossible de récupérer les parcours pour ce point. Veuillez réessayer.'
        );
      } finally {
        if (discoverAbort.current === controller) setIsLoadingRoutes(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchRoutesAtPoint(anchor, radiusKm, anchorLabel);
  }, [anchor, radiusKm]);

  const handleAnchorMove = useCallback((point: LatLngPoint, label?: string) => {
    setSelectedRoute(null);
    setElevationHoverPoint(null);
    setGeoNotice(null);
    setAnchor(point);
    setAnchorLabel(
      label || `Point (${point.lat.toFixed(3)}, ${point.lng.toFixed(3)})`
    );
    setCenterTrigger((c) => c + 1);
  }, []);

  const fallbackToIpLocation = useCallback(async () => {
    try {
      const res = await fetch('/api/ip-location');
      if (!res.ok) throw new Error('IP lookup failed');
      const data = (await res.json()) as {
        success?: boolean;
        lat?: number;
        lng?: number;
        city?: string;
        countryCode?: string;
      };
      const inFrance =
        data.success &&
        typeof data.lat === 'number' &&
        typeof data.lng === 'number' &&
        (data.countryCode === 'FR' ||
          (data.lat >= 41 &&
            data.lat <= 51.5 &&
            data.lng >= -5.5 &&
            data.lng <= 10));

      if (inFrance && data.lat !== undefined && data.lng !== undefined) {
        const cityName = data.city || 'Votre ville';
        handleAnchorMove(
          { lat: data.lat, lng: data.lng },
          `${cityName} (position approx.)`
        );
        setActiveTab('explore');
        setGeoNotice(
          `GPS bloqué par le navigateur — position approximative centrée sur ${cityName}. Cliquez sur la carte pour ajuster.`
        );
        return;
      }

      setGeoNotice(
        'Géolocalisation bloquée par le navigateur. Tapez votre ville ci-dessous ou cliquez directement sur la carte en France.'
      );
    } catch {
      setGeoNotice(
        'Géolocalisation bloquée par le navigateur. Tapez votre ville ci-dessous ou cliquez directement sur la carte en France.'
      );
    } finally {
      setIsGeolocating(false);
    }
  }, [handleAnchorMove]);

  const handleGeolocate = useCallback(() => {
    setIsGeolocating(true);
    setGeoNotice(null);

    if (!navigator.geolocation) {
      void fallbackToIpLocation();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGeolocating(false);
        handleAnchorMove(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          'Votre position actuelle'
        );
        setActiveTab('explore');
      },
      () => {
        void fallbackToIpLocation();
      },
      { enableHighAccuracy: false, timeout: 4500, maximumAge: 60000 }
    );
  }, [handleAnchorMove, fallbackToIpLocation]);

  const handleGenerateLoop = useCallback(
    async (req: LoopGenerationRequest) => {
      setIsGeneratingLoop(true);
      setDiscoverError(null);
      try {
        const res = await fetch('/api/loop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || 'Erreur lors du calcul');
        }
        const data = (await res.json()) as { route: RunningRoute };
        if (data.route) {
          setRoutes((prev) => [data.route, ...prev]);
          setSelectedRoute(data.route);
          setActiveTab('explore');
          setMobileSheetExpanded(true);
        }
      } catch (err) {
        setDiscoverError(
          err instanceof Error && err.message !== 'Erreur lors du calcul'
            ? err.message
            : 'Échec du calcul automatique de boucle. Réessayez.'
        );
      } finally {
        setIsGeneratingLoop(false);
      }
    },
    []
  );

  const handleToggleFavorite = useCallback((route: RunningRoute) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === route.id);
      const next = exists
        ? prev.filter((f) => f.id !== route.id)
        : [route, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleSubmitReport = useCallback((report: RouteReport) => {
    const updated = saveReport(report);
    setReports(updated);
  }, []);

  const favoriteIds = useMemo(() => {
    const map: Record<string, boolean> = {};
    favorites.forEach((f) => {
      map[f.id] = true;
    });
    return map;
  }, [favorites]);

  const filteredExploreRoutes = useMemo(
    () => filterRoutes(routes, filters, reports),
    [routes, filters, reports]
  );

  const mapVisibleRoutes = useMemo(() => {
    if (activeTab === 'favorites') return favorites;
    return filteredExploreRoutes;
  }, [activeTab, favorites, filteredExploreRoutes]);

  const handleSelectRoute = useCallback((route: RunningRoute) => {
    setSelectedRoute(route);
    setElevationHoverPoint(null);
    setMobileSheetExpanded(true);
  }, []);

  const handleMapSelectRoute = useCallback((route: RunningRoute) => {
    setSelectedRoute(route);
    setActiveTab('explore');
    setMobileSheetExpanded(true);
  }, []);

  const handleCenterOnRoute = useCallback((route: RunningRoute) => {
    setSelectedRoute(route);
    setCenterTrigger((c) => c + 1);
  }, []);

  const workspaceContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Top Bar */}
      <TopBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab !== 'explore') setSelectedRoute(null);
          setMobileSheetExpanded(true);
        }}
        onGeolocate={handleGeolocate}
        isGeolocating={isGeolocating}
        favoritesCount={favorites.length}
      />

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Sidebar (Desktop) / Bottom Drawer (Mobile) */}
        <aside
          aria-label="Exploration et filtres de parcours"
          className={`order-2 md:order-1 w-full md:w-[420px] lg:w-[450px] shrink-0 bg-white border-t md:border-t-0 md:border-r border-slate-200 flex flex-col z-20 transition-all duration-200 ${
            mobileSheetExpanded ? 'h-[58%] md:h-full' : 'h-14 md:h-full'
          }`}
        >
          {/* Mobile Drawer Handle & Tab Strip */}
          <div className="md:hidden flex items-center justify-between px-4 h-12 shrink-0 border-b border-slate-100 bg-slate-50/80">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('explore');
                  setMobileSheetExpanded(true);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                  activeTab === 'explore'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700'
                }`}
              >
                Explorer
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('loop');
                  setMobileSheetExpanded(true);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                  activeTab === 'loop'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700'
                }`}
              >
                Boucle auto
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('favorites');
                  setMobileSheetExpanded(true);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                  activeTab === 'favorites'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700'
                }`}
              >
                Favoris ({favorites.length})
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMobileSheetExpanded((v) => !v)}
              aria-label={
                mobileSheetExpanded
                  ? 'Réduire le panneau'
                  : 'Agrandir le panneau'
              }
              className="p-1.5 text-slate-600 cursor-pointer"
            >
              {mobileSheetExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronUp className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Sidebar Body */}
          <div className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-4">
            {geoNotice && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start justify-between gap-2">
                <span>{geoNotice}</span>
                <button
                  type="button"
                  onClick={() => setGeoNotice(null)}
                  aria-label="Fermer l'avis"
                  className="text-amber-800 hover:text-amber-950 p-0.5 shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {discoverError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center justify-between gap-2">
                <span>{discoverError}</span>
                <button
                  type="button"
                  onClick={() => void fetchRoutesAtPoint(anchor, radiusKm)}
                  className="font-semibold underline shrink-0 cursor-pointer"
                >
                  Réessayer
                </button>
              </div>
            )}

            {discoverWarnings.length > 0 && (
              <div
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1"
              >
                {discoverWarnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}

            {/* Route Detail View */}
            {selectedRoute && activeTab === 'explore' ? (
              <RouteDetail
                route={selectedRoute}
                report={reports[selectedRoute.id]}
                isFavorite={Boolean(favoriteIds[selectedRoute.id])}
                onBack={() => {
                  setSelectedRoute(null);
                  setElevationHoverPoint(null);
                }}
                onToggleFavorite={handleToggleFavorite}
                onCenterMap={handleCenterOnRoute}
                onHoverElevationPoint={setElevationHoverPoint}
                onSubmitReport={handleSubmitReport}
              />
            ) : activeTab === 'loop' ? (
              <>
                <SearchBar
                  onSelectLocation={(pt, label) => handleAnchorMove(pt, label)}
                  anchorLabel={anchorLabel}
                />
                <LoopBuilder
                  anchor={anchor}
                  anchorLabel={anchorLabel}
                  isGenerating={isGeneratingLoop}
                  onGenerateLoop={(req) => void handleGenerateLoop(req)}
                />
              </>
            ) : activeTab === 'favorites' ? (
              <div className="space-y-3">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Parcours favoris ({favorites.length})
                </h2>
                {favorites.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-800">
                      Aucun parcours enregistré pour le moment
                    </p>
                    <p className="text-xs text-slate-500">
                      Cliquez sur l&apos;icône marque-page d&apos;un itinéraire
                      pour le conserver ici hors connexion.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('explore')}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-emerald-600 text-white text-xs font-medium cursor-pointer"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>Explorer autour de moi</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {favorites.map((route) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        report={reports[route.id]}
                        isSelected={selectedRoute?.id === route.id}
                        isFavorite={true}
                        onSelect={(r) => {
                          setAnchor(r.startPoint);
                          setAnchorLabel(r.city);
                          setSelectedRoute(r);
                          setActiveTab('explore');
                          setCenterTrigger((c) => c + 1);
                        }}
                        onHover={setHoveredRouteId}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <SearchBar
                  onSelectLocation={(pt, label) => handleAnchorMove(pt, label)}
                  anchorLabel={anchorLabel}
                />

                <FilterBar
                  filters={filters}
                  onChange={setFilters}
                  totalCount={routes.length}
                  filteredCount={filteredExploreRoutes.length}
                />

                {/* Route List States */}
                {isLoadingRoutes ? (
                  <div className="space-y-2.5 pt-1" aria-busy="true">
                    {[1, 2, 3].map((n) => (
                      <div
                        key={n}
                        className="rounded-lg border border-slate-200 p-3.5 space-y-2 animate-pulse"
                      >
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-100 rounded w-1/2" />
                        <div className="h-3 bg-slate-100 rounded w-2/3" />
                      </div>
                    ))}
                  </div>
                ) : filteredExploreRoutes.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-center space-y-2.5">
                    <p className="text-sm font-medium text-slate-900">
                      Aucun parcours ne correspond à ces critères
                    </p>
                    <p className="text-xs text-slate-600">
                      Élargissez vos filtres ou générez directement une boucle
                      sur mesure autour du point sélectionné.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                        className="px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        Tout afficher
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('loop')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 cursor-pointer"
                      >
                        <RouteIcon className="w-3.5 h-3.5" />
                        <span>Générer une boucle ici</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 pb-4">
                    {filteredExploreRoutes.map((route) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        report={reports[route.id]}
                        isSelected={selectedRoute?.id === route.id}
                        isFavorite={Boolean(favoriteIds[route.id])}
                        onSelect={handleSelectRoute}
                        onHover={setHoveredRouteId}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <p className="pt-2 text-[11px] leading-relaxed text-slate-500 border-t border-slate-100">
              Données de parcours, éclairage et revêtement ©{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                contributeurs OpenStreetMap
              </a>{' '}
              (ODbL). Altitudes : Open-Meteo. Les attributs absents d’OpenStreetMap
              sont indiqués « non renseigné ».
            </p>
          </div>
        </aside>

        {/* Map Viewport */}
        <main className="order-1 md:order-2 flex-1 relative min-h-[260px] bg-slate-100">
          <RunningMap
            anchor={anchor}
            radiusKm={radiusKm}
            routes={mapVisibleRoutes}
            selectedRoute={selectedRoute}
            hoveredRouteId={hoveredRouteId}
            elevationHoverPoint={elevationHoverPoint}
            centerTrigger={centerTrigger}
            onAnchorMove={handleAnchorMove}
            onSelectRoute={handleMapSelectRoute}
            onRadiusChange={setRadiusKm}
          />
        </main>
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50">
      {workspaceContent}
    </div>
  );
}
