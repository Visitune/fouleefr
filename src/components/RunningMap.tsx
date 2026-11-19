import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
  /** Hauteur (px) de la carte masquée par le panneau mobile : le cadrage en tient compte. */
  bottomInset?: number;
}

type MapStyleMode = 'plan' | 'relief';

const TILES: Record<
  MapStyleMode,
  { url: string; attribution: string; maxZoom: number; subdomains: string }
> = {
  plan: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a>',
    maxZoom: 19,
    subdomains: '',
  },
  relief: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Carte &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA) · Données &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a>, SRTM',
    maxZoom: 17,
    subdomains: 'abc',
  },
};

const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';

const anchorIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;border-radius:9999px;background:#0f172a;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center">${PIN_SVG}</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function startIcon(selected: boolean): L.DivIcon {
  const size = selected ? 22 : 18;
  const bg = selected ? '#059669' : '#ffffff';
  const border = selected ? '#064e3b' : '#334155';
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2.5px solid ${border};box-shadow:0 1px 5px rgba(0,0,0,.35)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function strokeColor(route: RunningRoute, isSelected: boolean): string {
  if (isSelected) return '#059669';
  if (route.alongWater) return '#0284C7';
  if (route.lighting === 'eclaire') return '#D97706';
  return '#475569';
}

interface RouteLayers {
  route: RunningRoute;
  halo: L.Polyline;
  line: L.Polyline;
}

function styleLayers(layers: RouteLayers, isSelected: boolean, isHovered: boolean) {
  const emphasised = isSelected || isHovered;
  layers.halo.setStyle({
    opacity: emphasised ? 0.95 : 0,
    weight: isSelected ? 9 : 7,
  });
  layers.line.setStyle({
    color: strokeColor(layers.route, isSelected),
    opacity: isSelected ? 1 : isHovered ? 0.95 : 0.72,
    weight: isSelected ? 5.5 : isHovered ? 4.5 : 3.5,
  });
}

/** Contenu de la bulle construit en nœuds DOM : les noms OSM ne sont jamais interprétés comme du HTML. */
function popupContent(route: RunningRoute): HTMLElement {
  const root = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = route.name;
  title.style.cssText = 'font-weight:600;font-size:12px;color:#0f172a;margin-bottom:2px';
  const meta = document.createElement('div');
  meta.textContent = `${formatDistanceKm(route.distanceKm)} · ${
    route.elevationAvailable ? `+${route.elevationGainM} m` : 'D+ n/d'
  }`;
  meta.style.cssText = 'font-size:11px;color:#475569;font-variant-numeric:tabular-nums';
  root.append(title, meta);
  return root;
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
  bottomInset = 0,
}: RunningMapProps) {
  const [mapType, setMapType] = useState<MapStyleMode>('plan');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const radiusCircleRef = useRef<L.Circle | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLayersRef = useRef<Map<string, RouteLayers>>(new Map());
  const prevAnchorRef = useRef('');
  const prevTriggerRef = useRef(0);

  // callbacks et état de survol toujours à jour sans reconstruire les couches
  const cbRef = useRef({ onAnchorMove, onSelectRoute });
  cbRef.current = { onAnchorMove, onSelectRoute };
  const hoveredRef = useRef(hoveredRouteId);
  hoveredRef.current = hoveredRouteId;
  const selectedId = selectedRoute?.id ?? null;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // création de la carte (une seule fois)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, {
      center: [anchor.lat, anchor.lng],
      zoom: 13,
      zoomControl: true,
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      cbRef.current.onAnchorMove({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      anchorMarkerRef.current = null;
      radiusCircleRef.current = null;
      hoverMarkerRef.current = null;
      routeLayersRef.current = new Map();
      prevAnchorRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fond de carte
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = TILES[mapType];
    tileRef.current?.remove();
    const layer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      subdomains: cfg.subdomains || 'abc',
    }).addTo(map);
    tileRef.current = layer;
    map.setMaxZoom(cfg.maxZoom);
  }, [mapType]);

  // repère de départ + cercle de rayon
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pos: L.LatLngExpression = [anchor.lat, anchor.lng];
    if (!anchorMarkerRef.current) {
      anchorMarkerRef.current = L.marker(pos, {
        icon: anchorIcon,
        title: 'Votre point de départ (cliquez sur la carte pour déplacer)',
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(map);
    } else {
      anchorMarkerRef.current.setLatLng(pos);
    }
    if (!radiusCircleRef.current) {
      radiusCircleRef.current = L.circle(pos, {
        radius: radiusKm * 1000,
        color: '#0f172a',
        weight: 1,
        dashArray: '4 6',
        fillOpacity: 0.03,
        interactive: false,
      }).addTo(map);
    } else {
      radiusCircleRef.current.setLatLng(pos).setRadius(radiusKm * 1000);
    }
  }, [anchor, radiusKm]);

  // parcours : couches créées une fois par jeu de résultats / sélection
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = L.layerGroup().addTo(map);
    const items = new Map<string, RouteLayers>();

    const ordered = [...routes].sort((a, b) => {
      if (a.id === selectedId) return 1;
      if (b.id === selectedId) return -1;
      return 0;
    });

    for (const route of ordered) {
      if (route.path.length < 2) continue;
      const latlngs = route.path.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      const select = () => cbRef.current.onSelectRoute(route);

      const halo = L.polyline(latlngs, {
        color: '#ffffff',
        opacity: 0,
        weight: 7,
        interactive: false,
      }).addTo(group);
      const line = L.polyline(latlngs, { color: '#475569', weight: 3.5 }).addTo(group);
      line.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        select();
      });

      const isSelected = route.id === selectedId;
      const marker = L.marker([route.startPoint.lat, route.startPoint.lng], {
        icon: startIcon(isSelected),
        title: route.name,
        alt: route.name,
        zIndexOffset: isSelected ? 400 : 250,
      }).addTo(group);
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        select();
      });

      const layers = { route, halo, line };
      styleLayers(layers, isSelected, route.id === hoveredRef.current);
      items.set(route.id, layers);
    }

    routeLayersRef.current = items;
    return () => {
      group.remove();
      routeLayersRef.current = new Map();
    };
  }, [routes, selectedId]);

  // survol : on ne modifie que le style, sans rien reconstruire
  useEffect(() => {
    routeLayersRef.current.forEach((layers, id) => {
      styleLayers(layers, id === selectedRef.current, id === hoveredRouteId);
    });
  }, [hoveredRouteId]);

  // bulle d'information du parcours sélectionné
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedRoute) {
      map.closePopup();
      return;
    }
    const popup = L.popup({
      autoPan: false,
      closeOnClick: false,
      maxWidth: 240,
      offset: [0, -8],
    })
      .setLatLng([selectedRoute.startPoint.lat, selectedRoute.startPoint.lng])
      .setContent(popupContent(selectedRoute));
    popup.openOn(map);
    return () => {
      map.closePopup(popup);
    };
  }, [selectedRoute]);

  // cadrage : sur le parcours sélectionné, sinon sur le repère
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedRoute && selectedRoute.path.length >= 2) {
      const bounds = L.latLngBounds(
        selectedRoute.path.map((p) => [p.lat, p.lng] as L.LatLngTuple)
      );
      map.fitBounds(bounds, {
        paddingTopLeft: [32, 64],
        paddingBottomRight: [32, 48 + bottomInset],
        maxZoom: 17,
      });
      return;
    }

    const key = `${anchor.lat.toFixed(4)},${anchor.lng.toFixed(4)}`;
    if (key !== prevAnchorRef.current || centerTrigger !== prevTriggerRef.current) {
      prevAnchorRef.current = key;
      prevTriggerRef.current = centerTrigger;
      map.setView([anchor.lat, anchor.lng], Math.max(map.getZoom(), 13), { animate: false });
      // remonte le repère dans la partie visible quand le panneau mobile est ouvert
      if (bottomInset > 0) map.panBy([0, bottomInset / 2], { animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, selectedRoute, centerTrigger, bottomInset]);

  // curseur du profil d'altitude
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    hoverMarkerRef.current?.remove();
    hoverMarkerRef.current = null;
    if (elevationHoverPoint) {
      hoverMarkerRef.current = L.circleMarker(
        [elevationHoverPoint.lat, elevationHoverPoint.lng],
        {
          radius: 7,
          color: '#ffffff',
          weight: 2.5,
          fillColor: '#10b981',
          fillOpacity: 1,
          interactive: false,
        }
      ).addTo(map);
    }
  }, [elevationHoverPoint]);

  return (
    <div className="relative w-full h-full min-h-[280px]">
      {/* isolate : contient les z-index internes de Leaflet sous les contrôles flottants */}
      <div
        ref={containerRef}
        className="absolute inset-0 isolate"
        role="application"
        aria-label="Carte des parcours. Cliquez pour déplacer le point de départ."
      />

      {/* Rayon de recherche et fond de carte */}
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
              aria-pressed={radiusKm === r}
              onClick={() => onRadiusChange(r)}
              className={`px-3 py-2 md:px-2.5 md:py-1 text-xs font-mono tabular-nums font-medium rounded-md transition-colors cursor-pointer ${
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
              { id: 'plan', label: 'Plan' },
              { id: 'relief', label: 'Relief' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={mapType === mode.id}
              onClick={() => setMapType(mode.id)}
              className={`px-3 py-2 md:px-2.5 md:py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
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

      {/* Légende */}
      <div className="hidden sm:flex items-center gap-3 absolute bottom-7 left-3 z-10 px-3 py-1.5 rounded-lg bg-white/95 backdrop-blur-md border border-slate-200 shadow-sm text-[11px] text-slate-700">
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
