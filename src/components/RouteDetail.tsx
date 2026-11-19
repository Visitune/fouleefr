import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Crosshair,
  Download,
  Lightbulb,
  Star,
  Waves,
} from 'lucide-react';
import type {
  LatLngPoint,
  LightingStatus,
  PracticabilityStatus,
  RouteReport,
  RunningRoute,
} from '../types/route';
import {
  DIFFICULTY_LABELS,
  ENVIRONMENT_LABELS,
  FLATNESS_LABELS,
  LIGHTING_LABELS,
  PRACTICABILITY_LABELS,
  TERRAIN_LABELS,
  exportRouteToGpx,
  formatDistanceKm,
  formatDurationMin,
} from '../utils/formatters';
import { ElevationChart } from './ElevationChart';

interface RouteDetailProps {
  route: RunningRoute;
  report?: RouteReport;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: (route: RunningRoute) => void;
  onCenterMap: (route: RunningRoute) => void;
  onHoverElevationPoint: (point: LatLngPoint | null) => void;
  onSubmitReport: (report: RouteReport) => void;
}

export function RouteDetail({
  route,
  report,
  isFavorite,
  onBack,
  onToggleFavorite,
  onCenterMap,
  onHoverElevationPoint,
  onSubmitReport,
}: RouteDetailProps) {
  const [practicability, setPracticability] = useState<PracticabilityStatus>(
    report?.practicability ?? (route.practicable ? 'praticable' : 'boueux')
  );
  const [lightingOverride, setLightingOverride] = useState<LightingStatus>(
    report?.lightingOverride ?? route.lighting
  );
  const [rating, setRating] = useState<number>(report?.rating ?? 5);
  const [comment, setComment] = useState<string>(report?.comment ?? '');
  const [savedNotice, setSavedNotice] = useState(false);

  const effectiveLighting = report?.lightingOverride ?? route.lighting;
  const effectivePracticable = report
    ? report.practicability === 'praticable'
    : route.practicable;

  const sourceLabel =
    route.source === 'generated_loop'
      ? 'Boucle calculée sur le réseau piéton OpenStreetMap'
      : 'Parcours calculé via un lieu OpenStreetMap';
  const dq = route.dataQuality;

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitReport({
      routeId: route.id,
      practicability,
      lightingOverride,
      rating,
      comment: comment.trim(),
      updatedAt: new Date().toISOString(),
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header / Back */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[44px] md:min-h-[38px] px-2.5 -ml-2 rounded-md text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Tous les parcours</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCenterMap(route)}
            className="inline-flex items-center gap-1.5 min-h-[44px] md:min-h-[38px] px-2.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Centrer</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(route)}
            aria-label={
              isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'
            }
            className={`inline-flex items-center gap-1.5 min-h-[44px] md:min-h-[38px] px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              isFavorite
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Bookmark
              className={`w-3.5 h-3.5 ${isFavorite ? 'fill-emerald-600' : ''}`}
              aria-hidden="true"
            />
            <span>{isFavorite ? 'Enregistré' : 'Favori'}</span>
          </button>
        </div>
      </div>

      {/* Title & Subtitle */}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">
          {route.city} · {sourceLabel}
        </p>
        <h2 className="font-display text-lg font-bold text-slate-900 leading-snug">
          {route.name}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed pt-1">
          {route.description}
        </p>
      </div>

      {/* 4-column tabular metrics strip */}
      <div className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
        <div>
          <div className="text-[11px] text-slate-500">Distance</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
            {formatDistanceKm(route.distanceKm)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Dénivelé +</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
            {route.elevationAvailable ? `+${route.elevationGainM} m` : 'n/d'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Durée est.</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
            {formatDurationMin(route.estimatedMinutes)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Niveau</div>
          <div className="text-sm font-semibold text-slate-900">
            {DIFFICULTY_LABELS[route.difficulty]}
          </div>
        </div>
      </div>

      {/* Primary GPX Export CTA */}
      <button
        type="button"
        onClick={() => exportRouteToGpx(route)}
        className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
      >
        <Download className="w-4 h-4" aria-hidden="true" />
        <span>Exporter le tracé (.GPX)</span>
      </button>

      {/* Practicability & Safety Audit */}
      {route.safetyNotes && route.safetyNotes.length > 0 && (
        <div
          className={`rounded-lg border p-3.5 space-y-2 text-xs ${
            effectivePracticable
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-amber-200 bg-amber-50/70'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-semibold text-slate-900 inline-flex items-center gap-1.5">
              {effectivePracticable ? (
                <CheckCircle2
                  className="w-4 h-4 text-emerald-700 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className="w-4 h-4 text-amber-700 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>Points de vigilance (OpenStreetMap)</span>
            </span>
          </div>

          {route.surfaceSummary && (
            <p className="text-slate-700 font-medium">{route.surfaceSummary}</p>
          )}

          {route.safetyNotes && route.safetyNotes.length > 0 && (
            <ul className="space-y-1 text-slate-600">
              {route.safetyNotes.map((note, idx) => (
                <li key={idx} className="leading-relaxed">
                  · {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Interactive Elevation Profile — uniquement si l'altitude a été mesurée */}
      {route.elevationAvailable && route.elevationProfile.length >= 2 ? (
        <ElevationChart
          profile={route.elevationProfile}
          onHoverPoint={onHoverElevationPoint}
        />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Profil d’altitude indisponible : le service d’altimétrie n’a pas répondu.
          Aucune valeur n’est estimée.
        </p>
      )}

      {/* Traçabilité des données */}
      <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
        <p className="font-medium text-slate-800">Origine des données</p>
        <p>
          Tracé : réseau piéton OpenStreetMap · Altitude :{' '}
          {dq.elevation === 'measured' ? 'mesurée (modèle de terrain)' : 'indisponible'}
        </p>
        <p>
          Éclairage renseigné sur {dq.lightingCoveragePct}% du tracé · Revêtement
          renseigné sur {dq.surfaceCoveragePct}%
          {dq.osmTags === 'unavailable' ? ' (analyse OpenStreetMap indisponible)' : ''}
        </p>
        <p>
          Les attributs absents d’OpenStreetMap sont affichés « non renseigné » et
          non déduits.
        </p>
      </div>

      {/* Detailed Attributes Grid */}
      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Type de terrain</span>
          <span className="font-medium text-slate-900 text-right">
            {TERRAIN_LABELS[route.terrain]}
          </span>
        </div>
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Éclairage nocturne</span>
          <span
            className={`font-medium text-right inline-flex items-center justify-end gap-1 ${
              effectiveLighting === 'eclaire'
                ? 'text-amber-800'
                : 'text-slate-900'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{LIGHTING_LABELS[effectiveLighting]}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Environnement</span>
          <span className="font-medium text-slate-900 text-right">
            {ENVIRONMENT_LABELS[route.environment]}
          </span>
        </div>
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Cours d&apos;eau</span>
          <span
            className={`font-medium text-right inline-flex items-center justify-end gap-1 ${
              route.alongWater ? 'text-sky-800' : 'text-slate-600'
            }`}
          >
            {route.alongWater && (
              <Waves className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {route.alongWater
                ? route.waterName || "Le long d'un cours d'eau"
                : 'Non'}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Forme & Relief</span>
          <span className="font-medium text-slate-900 text-right">
            {route.isLoop ? 'Boucle' : 'Aller-retour'} ·{' '}
            {FLATNESS_LABELS[route.flatness]}
          </span>
        </div>
        <div className="grid grid-cols-2 p-3 gap-2">
          <span className="text-slate-500">Praticabilité actuelle</span>
          <span
            className={`font-medium text-right inline-flex items-center justify-end gap-1 ${
              effectivePracticable ? 'text-emerald-700' : 'text-amber-800'
            }`}
          >
            {effectivePracticable ? (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {report
                ? PRACTICABILITY_LABELS[report.practicability]
                : route.practicable
                  ? 'Terrain praticable'
                  : 'Terrain irrégulier'}
            </span>
          </span>
        </div>
      </div>

      {/* Community / Local Reporting & Rating Form */}
      <form
        onSubmit={handleReportSubmit}
        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Noter &amp; signaler le terrain
          </h3>
          {report && (
            <span className="text-[11px] text-slate-500">
              Mis à jour localement
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs">
            <span className="block text-slate-600 font-medium">
              Praticabilité
            </span>
            <select
              value={practicability}
              onChange={(e) =>
                setPracticability(e.target.value as PracticabilityStatus)
              }
              className="w-full h-11 md:h-9 px-2 rounded-md border border-slate-200 bg-white text-base md:text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="praticable">Praticable</option>
              <option value="boueux">Boueux / Dégradé</option>
              <option value="travaux">Travaux</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-slate-600 font-medium">
              Éclairage constaté
            </span>
            <select
              value={lightingOverride}
              onChange={(e) =>
                setLightingOverride(e.target.value as LightingStatus)
              }
              className="w-full h-11 md:h-9 px-2 rounded-md border border-slate-200 bg-white text-base md:text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="eclaire">Éclairé</option>
              <option value="partiel">Partiellement éclairé</option>
              <option value="non_eclaire">Non éclairé</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">Note du parcours</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                aria-label={`Noter ${star} sur 5`}
                aria-pressed={star <= rating}
                className="p-2 md:p-1 cursor-pointer"
              >
                <Star
                  className={`w-6 h-6 md:w-4 md:h-4 ${
                    star <= rating
                      ? 'text-amber-500 fill-amber-400'
                      : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Remarque courte (ex. flaques après pluie, fontaine active...)"
          className="w-full h-11 md:h-9 px-3 rounded-md border border-slate-200 bg-white text-base md:text-xs text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="submit"
            className="px-4 py-2 min-h-[44px] md:min-h-[38px] rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            Enregistrer le signalement
          </button>
          {savedNotice && (
            <span className="text-xs font-medium text-emerald-700">
              Signalement enregistré
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
