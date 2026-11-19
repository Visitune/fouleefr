import { Bookmark, Compass, Route as RouteIcon } from 'lucide-react';
import type { ActiveTab } from './TopBar';

interface BottomNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  favoritesCount: number;
}

const TABS = [
  { id: 'explore', label: 'Explorer', Icon: Compass },
  { id: 'loop', label: 'Créer', Icon: RouteIcon },
  { id: 'favorites', label: 'Favoris', Icon: Bookmark },
] as const;

/** Navigation principale mobile, à portée de pouce (zone sûre iPhone incluse). */
export function BottomNav({ activeTab, onTabChange, favoritesCount }: BottomNavProps) {
  return (
    <nav
      aria-label="Navigation principale"
      className="md:hidden shrink-0 z-30 grid grid-cols-3 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={active ? 'page' : undefined}
            className={`relative h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${
              active ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <span
              className={`absolute top-0 h-0.5 w-10 rounded-b-full ${
                active ? 'bg-emerald-600' : 'bg-transparent'
              }`}
              aria-hidden="true"
            />
            <span className="relative">
              <Icon
                className={`w-6 h-6 ${active && id === 'favorites' ? 'fill-emerald-600' : ''}`}
                aria-hidden="true"
              />
              {id === 'favorites' && favoritesCount > 0 && (
                <span className="absolute -top-1 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-4 text-center tabular-nums">
                  {favoritesCount}
                </span>
              )}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
