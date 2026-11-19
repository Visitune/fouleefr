import { useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export type SheetState = 'peek' | 'half' | 'full';

const ORDER: SheetState[] = ['peek', 'half', 'full'];

interface SheetHandleProps {
  state: SheetState;
  onChange: (next: SheetState) => void;
  summary: ReactNode;
}

/**
 * Poignée du panneau mobile : glisser vers le haut/bas change de hauteur,
 * un simple appui replie ou déplie. Seule la poignée capte le geste, le contenu
 * du panneau garde son défilement natif.
 */
export function SheetHandle({ state, onChange, summary }: SheetHandleProps) {
  const startY = useRef<number | null>(null);

  const step = (dir: 1 | -1) => {
    const next = ORDER[Math.min(2, Math.max(0, ORDER.indexOf(state) + dir))];
    if (next !== state) onChange(next);
  };
  const toggle = () => onChange(state === 'half' ? 'peek' : 'half');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={state !== 'peek'}
      aria-label={
        state === 'peek'
          ? 'Ouvrir le panneau des parcours'
          : 'Réduire le panneau des parcours'
      }
      onPointerDown={(e) => {
        startY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        if (startY.current === null) return;
        const dy = e.clientY - startY.current;
        startY.current = null;
        if (dy < -24) step(1);
        else if (dy > 24) step(-1);
        else toggle();
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          step(-1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      className="md:hidden shrink-0 h-16 px-4 flex flex-col items-center justify-center gap-1.5 border-b border-slate-100 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 rounded-t-2xl"
    >
      <span className="block w-10 h-1.5 rounded-full bg-slate-300" aria-hidden="true" />
      <div className="w-full flex items-center justify-between gap-2 min-w-0 text-sm font-medium text-slate-800">
        <div className="min-w-0 flex-1 truncate">{summary}</div>
        {state === 'peek' ? (
          <ChevronUp className="w-5 h-5 shrink-0 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-5 h-5 shrink-0 text-slate-500" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
