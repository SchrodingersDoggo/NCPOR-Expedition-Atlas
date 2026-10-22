import React from 'react';
import { variableName } from './labels.js';

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e5 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(2);
  return Number(n.toPrecision(5)).toString();
}

export default function VariableRail({ variables = [], selectedKey = '', onSelect }) {
  return <section className="viz-panel-section">
    <div className="flex items-center justify-between"><h2 className="viz-panel-title">Variables</h2>{variables.length > 0 && <span className="text-[11px] viz-muted viz-num">{variables.length}</span>}</div>
    {!variables.length ? <p className="mt-2 text-xs viz-muted">Variables appear here once a dataset is loaded.</p> : <div className="mt-2 space-y-1">
      {variables.map((field) => {
        const selected = field.key === selectedKey;
        const stats = field.statistics || {};
        return <button key={field.key} onClick={() => onSelect?.(field.key)} className="viz-item" aria-pressed={selected}>
          <div className="flex items-center justify-between gap-2"><span className={`truncate text-[13px] font-semibold ${selected ? 'viz-accent-text' : 'viz-text'}`}>{variableName(field)}</span>{field.unit && <span className="shrink-0 text-[11px] viz-muted">{field.unit}</span>}</div>
          {field.description && field.description !== field.originalName && <div className="mt-0.5 truncate text-[11px] viz-text-2" title={field.description}>{field.description}</div>}
          <div className="mt-0.5 text-[11px] viz-muted viz-num">{fmt(stats.min)} … {fmt(stats.max)}{field.unit ? ` ${field.unit}` : ''}</div>
        </button>;
      })}
    </div>}
  </section>;
}
