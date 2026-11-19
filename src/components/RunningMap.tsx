import { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  InfoWindow,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type { MapMouseEvent } from '@vis.gl/react-google-maps';
import { Flag, MapPin } from 'lucide-react';
import type { LatLngPoint, RunningRoute } from '../types/route';
import { formatDistanceKm } from '../utils/formatters';

interface RunningMapProps {
  anchor: LatLngPoint;
  radiusKm: number;
  routes: RunningRoute[];
  selectedRoute: RunningRoute | null;
  hoveredRouteId: string | null;
  elevationHoverPoint: LatLngPoint | null;
  centerTrigger: number;
  onAnchorMove: (point: LatLngPoint) => void;
  onSelectRoute: (route: RunningRoute) => void;
  onRadiusChange: (km: number) => void;
}

type MapStyleMode = 'roadmap' | 'terrain' | 'hybrid';

function getRouteStrokeColor(route: RunningRoute, isSelected: boolean): string {
  if (isSelected) return '#059669';
  if (route.alongWater) return '#0284C7';
  if (route.lighting === 'eclaire') return '#D97706';
  return '#475569';
}

function RoutePolylinesLayer({
  routes,
  selectedRouteId,
  hoveredRouteId,
  onSelectRoute,
}: {
  routes: RunningRoute[];
  selectedRouteId: string | null;
  hoveredRouteId: string | null;
  onSelectRoute: (route: RunningRoute) => void;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib) return;

    const polylines: google.maps.Polyline[] = [];
    const listeners: google.maps.MapsEventListener[] = [];

    // Draw non-selected routes first, then selected route on top with crisp white halo
    const ordered = [...routes].sort((a, b) => {
      if (a.id === selectedRouteId) return 1;
      if (b.id === selectedRouteId) return -1;
      return 0;
    });

    for (const route of ordered) {
      if (route.path.length < 2) continue;
      const isSelected = route.id === selectedRouteId;
      const isHovered = route.id === hoveredRouteId;
      const path = route.path.map((p) => ({ lat: p.lat, lng: p.lng }));

      if (isSelected || isHovered) {
        const halo = new mapsLib.Polyline({
          path,
          geodesic: true,
          strokeColor: '#ffffff',
          strokeOpacity: 0.95,
          strokeWeight: isSelected ? 9 : 7,
          zIndex: isSelected ? 29 : 19,
          clickable: false,
          map,
        });
        polylines.push(halo);
      }

      const line = new mapsLib.Polyline({
        path,
        geodesic: true,
        strokeColor: getRouteStrokeColor(route, isSelected),
        strokeOpacity: isSelected ? 1 : isHovered ? 0.95 : 0.72,
        strokeWeight: isSelected ? 5.5 : isHovered ? 4.5 : 3.5,
        zIndex: isSelected ? 30 : isHovered ? 20 : 10,
        clickable: true,
        map,
      });

      const listener = line.addListener('click', () => {
        onSelectRoute(route);
      });
      listeners.push(listener);
      polylines.push(line);
    }

    return () => {
      listeners.forEach((l) => l.remove());
      polylines.forEach((p) => p.setMap(null));
    };
  }, [map, mapsLib, routes, selectedRouteId, hoveredRouteId, onSelectRoute]);

  return null;
}

function MapViewportController({
  anchor,
  selectedRoute,
  centerTrigger,
}: {
  anchor: LatLngPoint;
  selectedRoute: RunningRoute | null;
  centerTrigger: number;
}) {
  const map = useMap();
  const prevAnchorRef = useRef<string>('');
  const prevTriggerRef = useRef<number>(0);

  useEffect(() => {
    if (!map) return;

    if (selectedRoute && selectedRoute.path.length >= 2) {
      const bounds = new google.maps.LatLngBounds();
      selectedRoute.path.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, { top: 64, right: 48, bottom: 64, left: 48 });
      return;
    }

    const key = `${anchor.lat.toFixed(4)},${anchor.lng.toFixed(4)}`;
    if (key !== prevAnchorRef.current || centerTrigger !== prevTriggerRef.current) {
      prevAnchorRef.current = key;
      prevTriggerRef.current = centerTrigger;
      map.panTo({ lat: anchor.lat, lng: anchor.lng });
      if ((map.getZoom() ?? 12) < 12) {
        map.setZoom(13);
      }
    }
  }, [map, anchor, selectedRoute, centerTrigger]);

  return null;
}

export function RunningMap({
  anchor,
  radiusKm,
  routes,
  selectedRoute,
  hoveredRouteId,
  elevationHoverPoint,
  centerTrigger,
  onAnchorMove,
  onSelectRoute,
  onRadiusChange,
}: RunningMapProps) {
  const [mapType, setMapType] = useState<MapStyleMode>('roadmap');
  const [infoOpenFor, setInfoOpenFor] = useState<string | null>(null);

  const handleMapClick = (ev: MapMouseEvent) => {
    const latLng = ev.detail.latLng;
    if (!latLng) return;
    setInfoOpenFor(null);
    onAnchorMove({ lat: latLng.lat, lng: latLng.lng });
  };

  const activeInfoRoute = routes.find((r) => r.id === infoOpenFor) ?? null;

  return (
    <div className="relative w-full h-full min-h-[280px]">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={anchor}
        defaultZoom={13}
        mapTypeId={mapType}
        gestureHandling="greedy"
        disableDefaultUI={true}
        zoomControl={true}
        onClick={handleMapClick}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapViewportController
          anchor={anchor}
          selectedRoute={selectedRoute}
          centerTrigger={centerTrigger}
        />

        <RoutePolylinesLayer
          routes={routes}
          selectedRouteId={selectedRoute?.id ?? null}
          hoveredRouteId={hoveredRouteId}
          onSelectRoute={(r) => {
            onSelectRoute(r);
            setInfoOpenFor(r.id);
          }}
        />

        {/* Dropped Anchor Pin */}
        <AdvancedMarker
          position={anchor}
          title="Votre point de départ (cliquez sur la carte pour déplacer)"
          zIndex={50}
        >
          <div className="flex flex-col items-center -translate-y-1/2">
            <div className="w-9 h-9 rounded-full bg-slate-900 border-2 border-white shadow-lg flex items-center justify-center text-white">
              <MapPin className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
          </div>
        </AdvancedMarker>

        {/* Start markers for routes */}
        {routes.map((route) => {
          const isSelected = selectedRoute?.id === route.id;
          return (
            <AdvancedMarker
              key={route.id}
              position={route.startPoint}
              title={route.name}
              zIndex={isSelected ? 40 : 25}
              onClick={() => {
                onSelectRoute(route);
                setInfoOpenFor(route.id);
              }}
            >
              <Pin
                background={isSelected ? '#059669' : '#FFFFFF'}
                borderColor={isSelected ? '#064E3B' : '#334155'}
                glyphColor={isSelected ? '#FFFFFF' : '#0F172A'}
                scale={isSelected ? 1.15 : 0.85}
              >
                <Flag className="w-3.5 h-3.5" aria-hidden="true" />
              </Pin>
            </AdvancedMarker>
          );
        })}

        {/* Elevation Chart Hover Cursor Marker */}
        {elevationHoverPoint && (
          <AdvancedMarker position={elevationHoverPoint} zIndex={60}>
            <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-md" />
          </AdvancedMarker>
        )}

        {activeInfoRoute && (
          <InfoWindow
            position={activeInfoRoute.startPoint}
            onCloseClick={() => setInfoOpenFor(null)}
            maxWidth={240}
          >
            <div className="p-0.5 space-y-1">
              <div className="font-display text-xs font-semibold text-slate-900">
                {activeInfoRoute.name}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-600">
                {formatDistanceKm(activeInfoRoute.distanceKm)} · +
                {activeInfoRoute.elevationGainM} m
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Top-right Map Style & Search Radius Floating Controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-2">
        <div
          role="group"
          aria-label="Rayon de recherche"
          className="flex items-center gap-0.5 p-1 rounded-lg bg-white/95 backdrop-blur-md border border-slate-200 shadow-sm"
        >
          {[3, 5, 10].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRadiusChange(r)}
              className={`px-2.5 py-1 text-xs font-mono tabular-nums font-medium rounded-md transition-colors cursor-pointer ${
                radiusKm === r
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Fond de carte"
          className="flex items-center gap-0.5 p-1 rounded-lg bg-white/95 backdrop-blur-md border border-slate-200 shadow-sm"
        >
          {(
            [
              { id: 'roadmap', label: 'Plan' },
              { id: 'terrain', label: 'Relief' },
              { id: 'hybrid', label: 'Satellite' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setMapType(mode.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mapType === mode.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom-left Compact Instruction / Legend */}
      <div className="hidden sm:flex items-center gap-3 absolute bottom-3 left-3 z-10 px-3 py-1.5 rounded-lg bg-white/95 backdrop-blur-md border border-slate-200 shadow-sm text-[11px] text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-emerald-600" />
          <span>Sélectionné</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-sky-600" />
          <span>Cours d&apos;eau</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-amber-600" />
          <span>Éclairé</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-slate-600" />
          <span>Standard</span>
        </span>
      </div>
    </div>
  );
}
