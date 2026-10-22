import React from 'react';

// Real counts, wired to useExplorerData() in ExplorerPage. Previously this
// was a "COMING SOON" locked overlay over five dashes — now it's five
// numbers pulled from the same endpoints Archive/Researchers already use.
export default function ExplorerStats({
  status,
  expeditionsTotal,
  researchersCount,
  datasetsCount,
  photosCount,
  regionsActive,
}) {
  const stats = [
    { key: 'expeditions', label: 'Expeditions', value: expeditionsTotal },
    { key: 'researchers', label: 'Researchers', value: researchersCount },
    { key: 'datasets', label: 'Datasets', value: datasetsCount },
    { key: 'photographs', label: 'Photographs', value: photosCount },
    { key: 'regions', label: 'Regions active', value: regionsActive },
  ];

  return (
    <div className="explorer-stats-grid">
      {stats.map((stat) => (
        <div key={stat.key} className="brass-plate explorer-stat-card rounded-lg">
          <span className="rivet-bl" aria-hidden="true" />
          <span className="rivet-br" aria-hidden="true" />
          <p className="explorer-stat-label">{stat.label}</p>
          <p className="explorer-stat-value gauge-text">
            {status === 'loading' ? '···' : status === 'error' ? '—' : (stat.value ?? 0).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
