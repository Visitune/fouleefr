import { useMemo, useState } from 'react';
import type { ElevationPoint, LatLngPoint } from '../types/route';

interface ElevationChartProps {
  profile: ElevationPoint[];
  onHoverPoint?: (point: LatLngPoint | null) => void;
}

export function ElevationChart({ profile, onHoverPoint }: ElevationChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (profile.length < 2) return null;
    const eles = profile.map((p) => p.ele);
    const minEle = Math.min(...eles);
    const maxEle = Math.max(...eles);
    const range = Math.max(8, maxEle - minEle);
    const padMin = minEle - range * 0.15;
    const padMax = maxEle + range * 0.15;
    const maxDist = Math.max(0.1, profile[profile.length - 1].distKm);
    return { minEle, maxEle, padMin, padMax, maxDist };
  }, [profile]);

  if (!stats || profile.length < 2) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        Profil altimétrique indisponible pour ce tracé.
      </div>
    );
  }

  const width = 360;
  const height = 112;
  const padX = 8;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const coords = profile.map((pt) => {
    const x = padX + (pt.distKm / stats.maxDist) * innerW;
    const y =
      padY +
      innerH -
      ((pt.ele - stats.padMin) / (stats.padMax - stats.padMin)) * innerH;
    return { x, y, pt };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`;

  const activeCoord = hoverIdx !== null ? coords[hoverIdx] : null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let closestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.abs(coords[i].x - relX);
      if (d < bestDist) {
        bestDist = d;
        closestIdx = i;
      }
    }
    setHoverIdx(closestIdx);
    onHoverPoint?.({
      lat: coords[closestIdx].pt.lat,
      lng: coords[closestIdx].pt.lng,
    });
  };

  const handlePointerLeave = () => {
    setHoverIdx(null);
    onHoverPoint?.(null);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">Profil altimétrique</span>
        <span className="font-mono tabular-nums text-slate-600">
          {activeCoord
            ? `${activeCoord.pt.distKm.toFixed(1).replace('.', ',')} km · ${Math.round(activeCoord.pt.ele)} m`
            : `Min ${Math.round(stats.minEle)} m · Max ${Math.round(stats.maxEle)} m`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-28 touch-none cursor-crosshair select-none"
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
        role="img"
        aria-label="Graphique du profil altimétrique du parcours"
      >
        <defs>
          <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal subtle baseline */}
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="#cbd5e1"
          strokeWidth="1"
        />

        <path d={areaPath} fill="url(#eleFill)" />
        <path
          d={linePath}
          fill="none"
          stroke="#059669"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {activeCoord && (
          <>
            <line
              x1={activeCoord.x}
              y1={padY}
              x2={activeCoord.x}
              y2={height - padY}
              stroke="#0f172a"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={activeCoord.x}
              cy={activeCoord.y}
              r="4.5"
              fill="#059669"
              stroke="#ffffff"
              strokeWidth="2"
            />
          </>
        )}
      </svg>

      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
        <span>0 km</span>
        <span>{(stats.maxDist / 2).toFixed(1).replace('.', ',')} km</span>
        <span>{stats.maxDist.toFixed(1).replace('.', ',')} km</span>
      </div>
    </div>
  );
}
