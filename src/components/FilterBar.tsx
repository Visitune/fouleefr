import {
  CheckCircle2,
  Lightbulb,
  Repeat,
  RotateCcw,
  TrendingUp,
  Waves,
} from 'lucide-react';
import type {
  DifficultyLevel,
  EnvironmentType,
  RouteFilters,
  TerrainType,
} from '../types/route';
import { DEFAULT_FILTERS } from '../utils/formatters';

interface FilterBarProps {
  filters: RouteFilters;
  onChange: (next: RouteFilters) => void;
  totalCount: number;
  filteredCount: number;
}

export function FilterBar({
  filters,
  onChange,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  const hasActiveFilters =
    filters.onlyLit ||
    filters.onlyWater ||
    filters.onlyFlat ||
    filters.onlyLoop ||
    filters.onlyPracticable ||
    filters.environment !== 'all' ||
    filters.terrain !== 'all' ||
    filters.difficulty !== 'all' ||
    filters.distanceBucket !== 'all';

  return (
    <div className="space-y-2.5 pt-2.5 border-t border-slate-100">
      {/* Primary toggle buttons */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyLit: !filters.onlyLit })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            filters.onlyLit
              ? 'bg-amber-50 border-amber-400 text-amber-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Éclairé</span>
        </button>

        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyWater: !filters.onlyWater })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            filters.onlyWater
              ? 'bg-sky-50 border-sky-400 text-sky-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Waves className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Cours d&apos;eau</span>
        </button>

        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyFlat: !filters.onlyFlat })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            filters.onlyFlat
              ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Plat</span>
        </button>

        <button
          type="button"
          onClick={() => onChange({ ...filters, onlyLoop: !filters.onlyLoop })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            filters.onlyLoop
              ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Boucle</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onChange({ ...filters, onlyPracticable: !filters.onlyPracticable })
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            filters.onlyPracticable
              ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Praticable</span>
        </button>
      </div>

      {/* Attribute selects */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <select
          aria-label="Filtrer par cadre"
          value={filters.environment}
          onChange={(e) =>
            onChange({
              ...filters,
              environment: e.target.value as EnvironmentType | 'all',
            })
          }
          className="h-9 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
        >
          <option value="all">Cadre : Tous</option>
          <option value="ville">En ville</option>
          <option value="parc">Parc urbain</option>
          <option value="campagne">Campagne</option>
          <option value="foret">Forêt</option>
        </select>

        <select
          aria-label="Filtrer par terrain"
          value={filters.terrain}
          onChange={(e) =>
            onChange({
              ...filters,
              terrain: e.target.value as TerrainType | 'all',
            })
          }
          className="h-9 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
        >
          <option value="all">Terrain : Tous</option>
          <option value="bitume">Bitume</option>
          <option value="stabilise">Stabilisé</option>
          <option value="terre">Sentier / Terre</option>
          <option value="mixte">Mixte</option>
        </select>

        <select
          aria-label="Filtrer par difficulté"
          value={filters.difficulty}
          onChange={(e) =>
            onChange({
              ...filters,
              difficulty: e.target.value as DifficultyLevel | 'all',
            })
          }
          className="h-9 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
        >
          <option value="all">Niveau : Tous</option>
          <option value="facile">Facile</option>
          <option value="modere">Modéré</option>
          <option value="sportif">Sportif</option>
        </select>

        <select
          aria-label="Filtrer par distance"
          value={filters.distanceBucket}
          onChange={(e) =>
            onChange({
              ...filters,
              distanceBucket: e.target.value as RouteFilters['distanceBucket'],
            })
          }
          className="h-9 px-2 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
        >
          <option value="all">Distance : Toutes</option>
          <option value="short">Moins de 5 km</option>
          <option value="medium">5 à 10 km</option>
          <option value="long">Plus de 10 km</option>
        </select>
      </div>

      {/* Results count & reset */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="tabular-nums">
          {filteredCount} parcours{filteredCount > 1 ? '' : ''} affiché
          {filteredCount !== totalCount ? ` sur ${totalCount}` : ''}
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-medium cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Réinitialiser</span>
          </button>
        )}
      </div>
    </div>
  );
}
