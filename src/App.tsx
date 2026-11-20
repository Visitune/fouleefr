import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Loader2,
  LocateFixed,
  Route as RouteIcon,
  WifiOff,
  X,
} from 'lucide-react';
import { BottomNav } from './components/BottomNav';
import { FilterBar } from './components/FilterBar';
import { InstallPrompt } from './components/InstallPrompt';
import { LoopBuilder } from './components/LoopBuilder';
import { RouteCard } from './components/RouteCard';
import { RouteDetail } from './components/RouteDetail';
import { RunningMap } from './components/RunningMap';
import { SearchBar } from './components/SearchBar';
import { SheetHandle, type SheetState } from './components/SheetHandle';
import { TopBar, type ActiveTab } from './components/TopBar';
import { useMediaQuery, useOnlineStatus } from './hooks/useDeviceState';
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
  const [sheetState, setSheetState] = useState<SheetState>('half');
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isOnline = useOnlineStatus();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [mapBottomInset, setMapBottomInset] = useState(0);

  // Déplie le panneau sans jamais le réduire s'il est déjà ouvert.
  const expandSheet = useCallback(
    () => setSheetState((cur) => (cur === 'peek' ? 'half' : cur)),
    []
  );

  // Partie de la carte masquée par le panneau (mobile) : sert au cadrage des tracés.
  useEffect(() => {
    if (!isMobile || sheetState === 'peek') {
      setMapBottomInset(0);
      return;
    }
    const h = wrapperRef.current?.clientHeight ?? 0;
    setMapBottomInset(Math.max(0, Math.round(h * 0.55 - 64)));
  }, [isMobile, sheetState]);

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
          expandSheet();
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
    expandSheet();
  }, []);

  const handleMapSelectRoute = useCallback((route: RunningRoute) => {
    setSelectedRoute(route);
    setActiveTab('explore');
    expandSheet();
  }, []);

  const handleCenterOnRoute = useCallback((route: RunningRoute) => {
    setSelectedRoute(route);
    setCenterTrigger((c) => c + 1);
  }, []);

  const handleTabChange = (tab: ActiveTab) => {
    // Un second appui sur l'onglet actif replie/déplie le panneau (mobile).
    if (tab === activeTab && isMobile) {
      setSheetState((cur) => (cur === 'peek' ? 'half' : 'peek'));
      return;
    }
    setActiveTab(tab);
    if (tab !== 'explore') setSelectedRoute(null);
    expandSheet();
  };

  const sheetSummary = isLoadingRoutes && activeTab === 'explore' ? (
    <span className="inline-flex items-center gap-2 text-slate-600">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      Recherche de parcours…
    </span>
  ) : activeTab === 'loop' ? (
    <span>Créer une boucle</span>
  ) : activeTab === 'favorites' ? (
    <span>Favoris ({favorites.length})</span>
  ) : selectedRoute ? (
    <span>{selectedRoute.name}</span>
  ) : (
    <span>
      {filteredExploreRoutes.length} parcours
      <span className="font-normal text-slate-500"> · {anchorLabel}</span>
    </span>
  );

  const SHEET_HEIGHT: Record<SheetState, string> = {
    peek: 'h-16',
    half: 'h-[55%]',
    full: 'h-full',
  };

  const workspaceContent = (
    <div className="flex flex-col h-full bg-white">
      {/* En-tête */}
      <TopBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onGeolocate={handleGeolocate}
        isGeolocating={isGeolocating}
        favoritesCount={favorites.length}
      />

      {!isOnline && (
        <div
          role="status"
          className="shrink-0 flex items-center gap-2 bg-amber-100 text-amber-950 text-xs px-4 py-2"
        >
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            Hors connexion : vos favoris restent consultables. La carte et le calcul
            de parcours nécessitent Internet.
          </span>
        </div>
      )}

      {/* Espace de travail : mobile = carte plein écran + panneau coulissant ; bureau = 2 colonnes */}
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 relative overflow-hidden md:flex md:flex-row"
      >
        <InstallPrompt />

        {/* Panneau latéral (bureau) / panneau coulissant (mobile) */}
        <aside
          aria-label="Exploration et filtres de parcours"
          className={`absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden bg-white rounded-t-2xl shadow-[0_-6px_24px_rgba(15,23,42,0.18)] transition-[height] duration-200 ease-out ${SHEET_HEIGHT[sheetState]} md:static md:h-full md:w-[420px] lg:w-[450px] md:shrink-0 md:rounded-none md:shadow-none md:border-r md:border-slate-200 md:order-1`}
        >
          <SheetHandle state={sheetState} onChange={setSheetState} summary={sheetSummary} />

          {/* Sidebar Body */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain thin-scrollbar p-4 space-y-4">
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
            <p className="text-[11px] text-slate-400 tabular-nums">
              Version {__APP_VERSION__} · {__APP_BUILD_DATE__}
            </p>
          </div>
        </aside>

        {/* Carte */}
        <main className="absolute inset-x-0 top-0 bottom-16 md:relative md:inset-auto md:bottom-auto md:flex-1 md:order-2 min-h-0 bg-slate-100">
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
            bottomInset={mapBottomInset}
          />

          {/* Bouton flottant « ma position » (mobile) */}
          <button
            type="button"
            onClick={handleGeolocate}
            disabled={isGeolocating}
            aria-label="Centrer sur ma position"
            className="md:hidden absolute right-3 bottom-9 z-10 w-12 h-12 rounded-full bg-white border border-slate-200 shadow-lg flex items-center justify-center text-emerald-700 disabled:opacity-60 active:scale-95 cursor-pointer"
          >
            {isGeolocating ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        </main>
      </div>

      {/* Navigation du bas (mobile) */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        favoritesCount={favorites.length}
      />
    </div>
  );

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-slate-50">
      {workspaceContent}
    </div>
  );
}
