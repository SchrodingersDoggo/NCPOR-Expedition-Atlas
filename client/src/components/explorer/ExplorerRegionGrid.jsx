import React, { useMemo } from 'react';
import { REGIONS } from './regionMeta.js';

// Replaces the globe's four region-colored point clusters with four
// clickable cards. Selecting one filters the expedition browser below —
// the same "narrow by region" job the globe's colored pins did, minus the
// 550KB of WebGL required to show four colors.
export default function ExplorerRegionGrid({ expeditions, activeRegion, onSelectRegion }) {
  const counts = useMemo(() => {
    const map = Object.fromEntries(REGIONS.map((r) => [r.value, 0]));
    expeditions.forEach((exp) => {
      if (exp.region && map[exp.region] !== undefined) map[exp.region] += 1;
    });
    return map;
  }, [expeditions]);

  return (
    <div className="explorer-region-grid">
      {REGIONS.map((region) => {
        const isActive = activeRegion === region.value;
        return (
          <button
            key={region.value}
            type="button"
            onClick={() => onSelectRegion(isActive ? null : region.value)}
            className={`explorer-region-card${isActive ? ' active' : ''}`}
            style={{ '--region-accent': region.varColor }}
            aria-pressed={isActive}
          >
            <span className="explorer-region-top">
              <span className="explorer-region-dot" />
              <span className="explorer-region-count gauge-text">{counts[region.value]}</span>
            </span>
            <span className="explorer-region-name">{region.label}</span>
            <span className="explorer-region-blurb">{region.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
