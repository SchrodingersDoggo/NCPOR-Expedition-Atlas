import React, { useMemo } from 'react';
import { Anchor, Compass } from 'lucide-react';

const REGION_LEGEND = [
  { label: 'Arctic', varName: '--region-arctic' },
  { label: 'Antarctic', varName: '--region-antarctic' },
  { label: 'Himalaya', varName: '--region-himalaya' },
  { label: 'Southern Ocean', varName: '--region-southern-ocean' },
];

// Phase 4 — the SLOW/OFFLINE alternative to the 3D globe. No WebGL, no
// three.js, no texture downloads — just the same expedition data (already
// year-filtered by LandingPage) as a scrollable list. Clicking a row drives
// the exact same onSelectPin callback the real globe's onPointClick does,
// so the detail panel, tabs, and everything downstream behaves identically
// regardless of which view is on screen.
//
// This owns a normal in-flow header instead of floating plates, since the
// globe's title/filters/stats/legend plates were positioned to sit in the
// empty corners around a circular globe — there's no such empty space
// around a list that fills the whole box, so LandingPage doesn't render
// those plates (or the porthole ring) at all when this component is shown.
// Nothing they showed is lost — the count, region key, etc. all live here.
export default function ExpeditionListFallback({ expeditions, selectedPin, onSelectPin, statusLabel }) {
  const activeRegionCount = useMemo(
    () => new Set(expeditions.map((exp) => exp.region)).size,
    [expeditions]
  );

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 px-5 pt-5 pb-3" style={{ borderBottom: '1px solid rgba(195,154,94,0.2)' }}>
        <div className="flex items-center gap-2" style={{ color: 'var(--brass-bright)' }}>
          <Compass className="w-4 h-4" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">
            {expeditions.length} expeditions charted · {activeRegionCount} regions
          </span>
        </div>
        <h1 className="mt-1 text-xl italic leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Expedition Atlas
        </h1>
        {statusLabel && (
          <p className="mt-1 text-xs" style={{ color: 'var(--ice-dim)' }}>{statusLabel}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px]" style={{ color: 'var(--ice-dim)' }}>
          {REGION_LEGEND.map(({ label, varName }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: `var(${varName})` }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3">
        {expeditions.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-center px-6" style={{ color: 'var(--ice-dim)' }}>
            No expeditions to show.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {expeditions.map((exp) => {
              const isSelected = selectedPin?.id === exp.id;
              return (
                <li key={exp.id}>
                  <button
                    onClick={() => onSelectPin(exp)}
                    className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg transition-colors"
                    style={{
                      background: isSelected ? 'rgba(195,154,94,0.14)' : 'rgba(7,22,32,0.35)',
                      border: `1px solid ${isSelected ? 'var(--brass-dim)' : 'rgba(195,154,94,0.15)'}`,
                    }}
                  >
                    <span
                      className="shrink-0 w-2.5 h-2.5 rounded-full"
                      style={{ background: exp.hex }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate" style={{ color: 'var(--ice)' }}>{exp.name}</span>
                      <span className="block text-[11px] truncate" style={{ color: 'var(--ice-dim)' }}>
                        {exp.region?.replace('_', ' ')}{exp.year ? ` · ${exp.year}` : ''} · {exp.pi}
                      </span>
                    </span>
                    {isSelected && <Anchor className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brass-bright)' }} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
