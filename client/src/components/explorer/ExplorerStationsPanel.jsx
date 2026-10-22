import React from 'react';

// The globe used to mark these three stations with solid-black 3D pillars.
// Same three real stations (Maitri, Bharati, Dakshin Gangotri), now plain
// cards — clicking one previews it in the same detail panel an expedition
// card opens.
export default function ExplorerStationsPanel({ stations, onSelect }) {
  if (!stations || stations.length === 0) return null;

  return (
    <section className="explorer-stations-panel">
      <h3 className="explorer-section-title">Indian research stations</h3>
      <div className="explorer-stations-grid">
        {stations.map((s) => (
          <button
            key={s.id}
            type="button"
            className="explorer-station-card brass-plate rounded-lg"
            onClick={() => onSelect?.({ ...s, isStation: true })}
          >
            <span className="rivet-bl" aria-hidden="true" />
            <span className="rivet-br" aria-hidden="true" />
            <h4>{s.name}</h4>
            <p className="explorer-station-coords gauge-text">{s.lat.toFixed(2)}°, {s.lng.toFixed(2)}°</p>
            <p className="explorer-station-desc">{s.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
