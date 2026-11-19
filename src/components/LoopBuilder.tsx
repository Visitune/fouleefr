import { useState } from 'react';
import { Lightbulb, Loader2, Route, TrendingUp, Waves } from 'lucide-react';
import type { LatLngPoint, LoopGenerationRequest } from '../types/route';

interface LoopBuilderProps {
  anchor: LatLngPoint;
  anchorLabel: string;
  isGenerating: boolean;
  onGenerateLoop: (req: LoopGenerationRequest) => void;
}

const PRESET_DISTANCES = [3, 5, 8, 10, 15, 21];

export function LoopBuilder({
  anchor,
  anchorLabel,
  isGenerating,
  onGenerateLoop,
}: LoopBuilderProps) {
  const [targetKm, setTargetKm] = useState(6);
  const [preferWater, setPreferWater] = useState(true);
  const [preferLit, setPreferLit] = useState(false);
  const [preferFlat, setPreferFlat] = useState(true);
  const [terrainPreference, setTerrainPreference] =
    useState<LoopGenerationRequest['terrainPreference']>('any');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerateLoop({
      lat: anchor.lat,
      lng: anchor.lng,
      targetKm,
      preferWater,
      preferLit,
      preferFlat,
      terrainPreference,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-4">
      <div className="space-y-1">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Générateur de boucle automatique
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Trace un itinéraire piéton réel en boucle depuis votre point posé (
          <strong className="font-medium text-slate-800">{anchorLabel}</strong>).
        </p>
      </div>

      {/* Distance Selector */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <label
            htmlFor="loop-distance-slider"
            className="text-xs font-medium text-slate-700"
          >
            Distance souhaitée
          </label>
          <span className="font-mono text-base font-bold tabular-nums text-emerald-700">
            {targetKm.toFixed(1).replace('.', ',')} km
          </span>
        </div>

        <input
          id="loop-distance-slider"
          type="range"
          min={2}
          max={25}
          step={0.5}
          value={targetKm}
          onChange={(e) => setTargetKm(Number(e.target.value))}
          className="w-full h-9 md:h-5 accent-emerald-600 cursor-pointer"
        />

        <div className="flex flex-wrap gap-1.5">
          {PRESET_DISTANCES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setTargetKm(d)}
              className={`px-3 py-2 min-h-[44px] md:px-2.5 md:py-1 md:min-h-[32px] rounded-md text-sm md:text-xs font-mono tabular-nums border transition-colors cursor-pointer ${
                targetKm === d
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500'
              }`}
            >
              {d} km
            </button>
          ))}
        </div>
      </div>

      {/* Preferences */}
      <div className="space-y-2">
        <span className="block text-xs font-medium text-slate-700">
          Priorités du tracé
        </span>
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => setPreferWater((v) => !v)}
            className={`w-full min-h-[52px] md:min-h-[42px] px-3 py-2 rounded-lg border text-left text-sm md:text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              preferWater
                ? 'bg-sky-50 border-sky-400 text-sky-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Waves className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Orienter vers un cours d&apos;eau à proximité</span>
            </span>
            <span className="text-[11px] font-semibold">
              {preferWater ? 'Activé' : 'Off'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPreferLit((v) => !v)}
            className={`w-full min-h-[52px] md:min-h-[42px] px-3 py-2 rounded-lg border text-left text-sm md:text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              preferLit
                ? 'bg-amber-50 border-amber-400 text-amber-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Lightbulb className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Course de nuit / privilégier voies éclairées</span>
            </span>
            <span className="text-[11px] font-semibold">
              {preferLit ? 'Activé' : 'Off'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPreferFlat((v) => !v)}
            className={`w-full min-h-[52px] md:min-h-[42px] px-3 py-2 rounded-lg border text-left text-sm md:text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              preferFlat
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <TrendingUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Privilégier un profil plat</span>
            </span>
            <span className="text-[11px] font-semibold">
              {preferFlat ? 'Activé' : 'Off'}
            </span>
          </button>
        </div>
      </div>

      {/* Terrain Preference */}
      <div className="space-y-2">
        <span className="block text-xs font-medium text-slate-700">
          Surface souhaitée
        </span>
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'any', label: 'Mixte' },
              { id: 'bitume', label: 'Bitume' },
              { id: 'nature', label: 'Parc / Chemin' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTerrainPreference(opt.id)}
              className={`py-3 md:py-2 px-2 text-sm md:text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                terrainPreference === opt.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={isGenerating}
        className="sticky bottom-1 z-10 shadow-lg w-full min-h-[52px] md:min-h-[44px] py-3 md:py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 text-white text-base md:text-sm font-medium inline-flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>Calcul du tracé en cours...</span>
          </>
        ) : (
          <>
            <Route className="w-4 h-4" aria-hidden="true" />
            <span>Générer une boucle de {targetKm.toFixed(1).replace('.', ',')} km</span>
          </>
        )}
      </button>
    </form>
  );
}
