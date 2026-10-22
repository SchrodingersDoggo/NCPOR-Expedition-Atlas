import React from 'react';
import { CircleDot, Layers3 } from 'lucide-react';
import { dataQualityModel } from './workbenchModel.js';

export default function DataQualityPanel({ dataset, variable, view }) {
  const quality = dataQualityModel({ dataset, variable, view });
  const missingTone = quality.missingPercent >= 25 ? 'viz-warn-text' : 'viz-text';
  return <section className="viz-panel-section">
    <h2 className="viz-panel-title">Data Quality</h2>
    <div className="mt-2 space-y-2 text-[12px] viz-text-2">
      <div className="flex items-center gap-2"><CircleDot className="h-3.5 w-3.5 viz-accent-text" aria-hidden="true" /><span>Measured observations</span></div>
      {quality.interpolated && <div className="flex items-center gap-2"><Layers3 className="h-3.5 w-3.5 viz-warn-text" aria-hidden="true" /><span>Includes interpolated estimates</span></div>}
      <div className="viz-card grid grid-cols-2 gap-2 p-2.5">
        <div><div className="viz-label">Coverage</div><div className="mt-0.5 viz-value">{quality.coverageLabel}</div></div>
        <div><div className="viz-label">Missing</div><div className={`mt-0.5 viz-value viz-num ${missingTone}`} style={missingTone === 'viz-warn-text' ? { color: 'var(--viz-warn)' } : undefined}>{variable?.statistics ? `${quality.missingPercent.toFixed(1)}%` : '—'}</div></div>
      </div>
      {quality.interpolated && <p className="viz-note" data-tone="warning">This view contains interpolated values. Measured locations and the coverage mask stay visible so estimates are never mistaken for measurements.</p>}
      {quality.derived3D && <p className="text-[12px] leading-relaxed viz-muted">Derived from a coverage-masked interpolated field — not a directly measured volumetric boundary.</p>}
    </div>
  </section>;
}
