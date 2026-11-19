import { LocateFixed, Loader2 } from 'lucide-react';

export type ActiveTab = 'explore' | 'loop' | 'favorites';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onGeolocate: () => void;
  isGeolocating: boolean;
  favoritesCount: number;
}

export function TopBar({
  activeTab,
  onTabChange,
  onGeolocate,
  isGeolocating,
  favoritesCount,
}: TopBarProps) {
  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between gap-8 z-30">
      {/* Zone 1: Single-line brand wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onTabChange('explore');
        }}
        className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-md"
      >
        Foulée France
      </a>

      {/* Zone 2: Concise single-line navigation links */}
      <nav
        aria-label="Navigation principale"
        className="hidden sm:flex items-center gap-6 h-full"
      >
        <button
          type="button"
          onClick={() => onTabChange('explore')}
          className={`h-full px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
            activeTab === 'explore'
              ? 'border-emerald-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Explorer
        </button>
        <button
          type="button"
          onClick={() => onTabChange('loop')}
          className={`h-full px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
            activeTab === 'loop'
              ? 'border-emerald-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Créer une boucle
        </button>
        <button
          type="button"
          onClick={() => onTabChange('favorites')}
          className={`h-full px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
            activeTab === 'favorites'
              ? 'border-emerald-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Favoris{favoritesCount > 0 ? ` (${favoritesCount})` : ''}
        </button>
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onGeolocate}
          disabled={isGeolocating}
          className="inline-flex items-center gap-2 py-2 px-4 min-h-[40px] rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60 text-white text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          {isGeolocating ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <LocateFixed className="w-4 h-4" aria-hidden="true" />
          )}
          <span>Ma position</span>
        </button>
      </div>
    </header>
  );
}
