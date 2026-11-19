import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import type { LatLngPoint } from '../types/route';

interface QuickCity {
  name: string;
  point: LatLngPoint;
}

const FRENCH_QUICK_CITIES: QuickCity[] = [
  { name: 'Paris', point: { lat: 48.8588, lng: 2.2945 } },
  { name: 'Lyon', point: { lat: 45.7745, lng: 4.8535 } },
  { name: 'Annecy', point: { lat: 45.8992, lng: 6.1319 } },
  { name: 'Bordeaux', point: { lat: 44.8425, lng: -0.5685 } },
  { name: 'Marseille', point: { lat: 43.2595, lng: 5.377 } },
  { name: 'Nantes', point: { lat: 47.2249, lng: -1.5529 } },
];

interface SearchBarProps {
  onSelectLocation: (point: LatLngPoint, label: string) => void;
  anchorLabel: string;
}

interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

/** Libellé court : « Parc de la Tête d'Or, Lyon » plutôt que l'adresse OSM complète. */
function shortLabel(full: string): string {
  const parts = full.split(',').map((s) => s.trim());
  return parts.length > 2 ? `${parts[0]}, ${parts[1]}` : full;
}

export function SearchBar({ onSelectLocation, anchorLabel }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // ferme la liste au clic extérieur et à Échap
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setResults(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResults(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
    };
  }, []);

  // Nominatim interdit l'autocomplétion à la frappe : la recherche est lancée à la validation.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) {
      setError('Saisissez au moins 3 caractères.');
      setResults(null);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Recherche indisponible.');
      }
      const data = (await res.json()) as { results: GeocodeResult[] };
      setResults(data.results);
      if (data.results.length === 0) setError('Aucun lieu trouvé en France.');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Recherche indisponible.');
      setResults(null);
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  };

  const pick = (r: GeocodeResult) => {
    onSelectLocation({ lat: r.lat, lng: r.lng }, shortLabel(r.label));
    setQuery('');
    setResults(null);
    setError(null);
  };

  return (
    <div className="space-y-2.5" ref={rootRef}>
      <form onSubmit={(e) => void handleSubmit(e)} role="search" className="relative">
        <Search
          className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          placeholder="Ville, parc, rue en France… puis Entrée"
          aria-label="Rechercher un lieu en France"
          aria-controls={results && results.length > 0 ? listId : undefined}
          aria-expanded={Boolean(results && results.length > 0)}
          autoComplete="off"
          maxLength={120}
          className="w-full h-10 pl-9 pr-20 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-colors"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults(null);
                setError(null);
              }}
              aria-label="Effacer la recherche"
              className="p-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading}
            aria-label="Lancer la recherche"
            className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {results && results.length > 0 && (
          <ul
            id={listId}
            aria-label="Résultats de recherche"
            className="absolute left-0 right-0 top-11 bg-white border border-slate-200 rounded-lg shadow-lg z-40 max-h-60 overflow-y-auto divide-y divide-slate-100"
          >
            {results.map((r) => (
              <li key={`${r.lat},${r.lng},${r.label}`}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 focus-visible:bg-emerald-50 focus-visible:outline-none flex items-start gap-2.5 cursor-pointer"
                >
                  <MapPin
                    className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span className="line-clamp-2">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <div role="status" aria-live="polite" className="min-h-0">
        {error && <p className="text-xs text-amber-800">{error}</p>}
      </div>

      {/* Villes rapides */}
      <div className="flex items-center gap-1.5 overflow-x-auto thin-scrollbar pb-0.5">
        {FRENCH_QUICK_CITIES.map((city) => (
          <button
            key={city.name}
            type="button"
            onClick={() => onSelectLocation(city.point, city.name)}
            className="px-2.5 py-1 min-h-[30px] text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {city.name}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
        <MapPin
          className="w-3.5 h-3.5 text-emerald-600 shrink-0"
          aria-hidden="true"
        />
        <span className="truncate">
          Point actif :{' '}
          <strong className="font-medium text-slate-700">{anchorLabel}</strong>{' '}
          · Cliquez sur la carte pour déplacer
        </span>
      </p>
    </div>
  );
}
