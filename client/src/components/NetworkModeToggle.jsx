import React from 'react';
import { useNetwork } from '../context/NetworkContext.jsx';
import { NETWORK_MODES } from '../offline/networkPreference.js';

// Phase 7 — Manual Mode. Three explicit choices; 'auto' restores today's
// detection-driven behavior. Lives in the navbar so it's reachable from
// every page, not just the landing page's globe.
const OPTIONS = [
  { value: NETWORK_MODES.AUTO, label: 'Auto' },
  { value: NETWORK_MODES.FULL, label: 'Full Quality' },
  { value: NETWORK_MODES.LOW_BANDWIDTH, label: 'Low Bandwidth' },
];

export default function NetworkModeToggle() {
  const { mode, setMode, isOffline } = useNetwork();

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-white/15 p-0.5 text-xs"
      role="group"
      aria-label="Network rendering mode"
      title={isOffline ? 'Offline overrides any manual choice until connection returns' : undefined}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setMode(opt.value)}
          aria-pressed={mode === opt.value}
          className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
            mode === opt.value
              ? 'bg-white/20 text-white'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
