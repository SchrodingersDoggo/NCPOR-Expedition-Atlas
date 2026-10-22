import React from 'react';
import { formatScaleValue } from '../colorScale.js';

// Colour scale legend: gradient bar with tick values, the variable name and
// unit, plus optional keys (e.g. measured vs interpolated). Text uses the
// theme's ink tokens; colour only ever appears in the bar and key swatches.
export default function ColorLegend({ scale, label, unit, keys = [], note = null }) {
  const hasScale = scale && scale.kind !== 'empty' && Number.isFinite(scale.min) && Number.isFinite(scale.max);
  const span = hasScale ? scale.max - scale.min : 0;
  const ticks = hasScale ? (scale.ticks?.length ? scale.ticks : [scale.min, scale.max]) : [];
  const position = (value) => (span > 0 ? ((value - scale.min) / span) * 100 : 50);
  return <div className="viz-legend">
    {hasScale ? <div className="viz-legend-scale" aria-label={`${label || 'Value'} colour scale from ${formatScaleValue(scale.min)} to ${formatScaleValue(scale.max)}${unit ? ` ${unit}` : ''}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3"><span className="font-semibold viz-text">{label || 'Value'}{unit ? <span className="ml-1 font-normal viz-muted">({unit})</span> : null}</span>{scale.kind === 'diverging' ? <span className="text-[11px] viz-muted">diverging around 0</span> : scale.clipped ? <span className="text-[11px] viz-muted">2nd–98th percentile</span> : null}</div>
      <div className="viz-legend-bar" style={{ background: `linear-gradient(to right, ${scale.gradient.join(', ')})` }} />
      <div className="viz-legend-ticks">{ticks.filter((tick) => tick >= scale.min - 1e-12 && tick <= scale.max + 1e-12).map((tick) => <span key={tick} style={{ left: `${Math.max(3, Math.min(97, position(tick)))}%` }}>{formatScaleValue(tick)}</span>)}</div>
    </div> : <div className="viz-muted">{label ? `${label}: no finite values to colour.` : 'No colour scale.'}</div>}
    {(keys.length > 0 || note) && <div className="viz-legend-keys">
      {keys.map((key) => <span key={key.label}>{key.kind === 'swatch'
        ? <span className="viz-key-swatch" style={{ background: key.color || '#5598e7', opacity: key.opacity ?? 0.75 }} />
        : <span className="viz-key-dot" style={{ background: key.color || 'transparent', border: `1.5px solid ${key.stroke || '#ffffff'}` }} />}{key.label}</span>)}
      {note && <span>{note}</span>}
    </div>}
  </div>;
}
