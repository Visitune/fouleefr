import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  Lightbulb,
  Waves,
} from 'lucide-react';
import type { RouteReport, RunningRoute } from '../types/route';
import {
  DIFFICULTY_LABELS,
  ENVIRONMENT_LABELS,
  FLATNESS_LABELS,
  LIGHTING_LABELS,
  PRACTICABILITY_LABELS,
  TERRAIN_LABELS,
  formatDistanceKm,
  straightnessInfo,
} from '../utils/formatters';

interface RouteCardProps {
  route: RunningRoute;
  report?: RouteReport;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: (route: RunningRoute) => void;
  onHover?: (routeId: string | null) => void;
  onToggleFavorite: (route: RunningRoute) => void;
}

export function RouteCard({
  route,
  report,
  isSelected,
  isFavorite,
  onSelect,
  onHover,
  onToggleFavorite,
}: RouteCardProps) {
  const straight = straightnessInfo(route.turnsPerKm);
  const effectiveLighting = report?.lightingOverride ?? route.lighting;
  const effectivePracticable = report
    ? report.practicability === 'praticable'
    : route.practicable;

  return (
    <article
      onMouseEnter={() => onHover?.(route.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`rounded-lg border bg-white transition-colors ${
        isSelected
          ? 'border-emerald-600 ring-1 ring-emerald-600/20'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="p-3.5 flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelect(route)}
          className="text-left flex-1 min-w-0 space-y-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
        >
          {/* Lead directly with route title */}
          <h3 className="font-display text-[15px] font-semibold text-slate-900 leading-snug line-clamp-2">
            {route.name}
          </h3>

          {/* Primary unboxed tabular metrics */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-700 font-mono tabular-nums">
            <span className="font-semibold text-slate-900">
              {formatDistanceKm(route.distanceKm)}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              {route.elevationAvailable ? `+${route.elevationGainM} m` : 'D+ n/d'}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-sans">{FLATNESS_LABELS[route.flatness]}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-sans">
              {route.isLoop ? 'Boucle' : 'Aller-retour'}
            </span>
          </div>

          {/* Secondary unboxed attributes */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
            <span>{DIFFICULTY_LABELS[route.difficulty]}</span>
            <span aria-hidden="true">·</span>
            <span>{TERRAIN_LABELS[route.terrain]}</span>
            <span aria-hidden="true">·</span>
            <span>{ENVIRONMENT_LABELS[route.environment]}</span>
            {straight && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    straight.tone === 'good'
                      ? 'text-emerald-700 font-medium'
                      : straight.tone === 'bad'
                        ? 'text-amber-800'
                        : ''
                  }
                >
                  {straight.label}
                </span>
              </>
            )}
            {route.distanceFromAnchorKm !== undefined &&
              route.distanceFromAnchorKm > 0.1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    à {formatDistanceKm(route.distanceFromAnchorKm)}
                  </span>
                </>
              )}
          </div>

          {/* Explicit lighting, waterway, and practicability indicators (icon + text, never hue-only) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
            <span
              className={`inline-flex items-center gap-1 ${
                effectiveLighting === 'eclaire'
                  ? 'text-amber-800 font-medium'
                  : 'text-slate-500'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{LIGHTING_LABELS[effectiveLighting]}</span>
            </span>

            {route.alongWater && (
              <span className="inline-flex items-center gap-1 text-sky-800 font-medium">
                <Waves className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{route.waterName || "Cours d'eau"}</span>
              </span>
            )}

            {report ? (
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  effectivePracticable ? 'text-emerald-700' : 'text-amber-800'
                }`}
              >
                {effectivePracticable ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{PRACTICABILITY_LABELS[report.practicability]}</span>
              </span>
            ) : !route.practicable ? (
              <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Terrain irrégulier</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-600">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Aucun obstacle signalé (OSM)</span>
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(route);
          }}
          aria-label={
            isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'
          }
          className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
            isFavorite
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Bookmark
            className={`w-4 h-4 ${isFavorite ? 'fill-emerald-600' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </article>
  );
}
