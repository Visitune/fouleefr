import { useCallback, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
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
  mapsEnabled: boolean;
}

function PlacesAutocompleteField({
  onSelectLocation,
}: {
  onSelectLocation: (point: LatLngPoint, label: string) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { suggestions, isLoading, resetSession } =
    useAutocompleteSuggestions(inputValue);

  const handleSuggestionSelect = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });
        if (place.location) {
          const lat = place.location.lat();
          const lng = place.location.lng();
          const label =
            place.displayName ||
            place.formattedAddress ||
            suggestion.placePrediction.text.text;
          onSelectLocation({ lat, lng }, label);
          setInputValue('');
          setIsOpen(false);
          resetSession();
        }
      } catch (err: unknown) {
        const msg = String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
    },
    [placesLib, onSelectLocation, resetSession]
  );

  return (
    <div className="relative">
      <Search
        className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Ville, parc, rue en France..."
        aria-label="Rechercher un lieu en France"
        className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition-colors"
      />
      {inputValue && (
        <button
          type="button"
          onClick={() => {
            setInputValue('');
            resetSession();
          }}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {isOpen && (suggestions.length > 0 || isLoading) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-11 bg-white border border-slate-200 rounded-lg shadow-lg z-40 max-h-60 overflow-y-auto divide-y divide-slate-100"
        >
          {isLoading && suggestions.length === 0 && (
            <li className="px-3.5 py-2.5 text-xs text-slate-500">
              Recherche en cours...
            </li>
          )}
          {suggestions.map((suggestion, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => void handleSuggestionSelect(suggestion)}
                className="w-full text-left px-3.5 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 flex items-start gap-2.5 cursor-pointer"
              >
                <MapPin
                  className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span className="line-clamp-2">
                  {suggestion.placePrediction?.text.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchBar({
  onSelectLocation,
  anchorLabel,
  mapsEnabled,
}: SearchBarProps) {
  return (
    <div className="space-y-2.5">
      {mapsEnabled ? (
        <PlacesAutocompleteField onSelectLocation={onSelectLocation} />
      ) : null}

      {/* Quick French cities */}
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
