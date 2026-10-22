import React, { useMemo } from 'react';

// Real bars, grouped by expedition start year from the same expedition list
// the rest of the page uses. Previously a locked "COMING SOON" placeholder;
// now it's a small bar chart, keyboard/hover accessible via each bar's title.
export default function ExplorerTimeline({ expeditions, status }) {
  const years = useMemo(() => {
    const counts = new Map();
    expeditions.forEach((exp) => {
      if (!exp.startDate) return;
      const year = new Date(exp.startDate).getFullYear();
      if (Number.isNaN(year)) return;
      counts.set(year, (counts.get(year) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [expeditions]);

  const max = Math.max(1, ...years.map(([, count]) => count));

  return (
    <section className="explorer-timeline-panel">
      <h3 className="explorer-section-title">Expeditions by year</h3>
      <div className="explorer-timeline brass-plate rounded-xl">
        <span className="rivet-bl" aria-hidden="true" />
        <span className="rivet-br" aria-hidden="true" />

        {status === 'loading' && <p className="explorer-timeline-empty">Charting expeditions…</p>}
        {status === 'error' && <p className="explorer-timeline-empty">Couldn't reach the archive.</p>}
        {status === 'ready' && years.length === 0 && (
          <p className="explorer-timeline-empty">No dated expeditions yet — this fills in as expeditions are logged.</p>
        )}

        {status === 'ready' && years.length > 0 && (
          <div className="explorer-timeline-bars custom-scrollbar">
            {years.map(([year, count]) => (
              <div
                key={year}
                className="explorer-timeline-col"
                title={`${count} expedition${count === 1 ? '' : 's'} in ${year}`}
              >
                <span className="explorer-timeline-count gauge-text">{count}</span>
                <span className="explorer-timeline-bar" style={{ height: `${(count / max) * 100}%` }} />
                <span className="explorer-timeline-year gauge-text">{year}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
