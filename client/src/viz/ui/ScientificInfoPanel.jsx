import React, { useState } from 'react';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import DataQualityPanel from './DataQualityPanel.jsx';
import { sourceSummaryModel } from './workbenchModel.js';
import { variableName } from './labels.js';

function fmt(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e5 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(3);
  return Number(n.toPrecision(7)).toString();
}

function provenanceLabel(entry) {
  if (!entry) return '';
  const parts = [entry.role || entry.step, entry.operation].filter(Boolean);
  return `${parts.join(' · ')}${entry.approximate ? ' (approximate)' : ''}`;
}

const MODE_LABELS = { full: 'Full dataset', offline: 'Saved offline copy', preview: 'Preview (partial)', cache: 'Visualization cache', merged: 'Combined casts' };

function Stat({ label, value, unit }) {
  return <div><div className="viz-label">{label}</div><div className="mt-0.5 viz-value viz-num">{value}{unit ? <span className="ml-1 text-[11px] font-normal viz-muted">{unit}</span> : null}</div></div>;
}

export default function ScientificInfoPanel({ dataset, variable, access, sourceMode, sourceRows = 0, displayedRows = 0, view }) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const stats = variable?.statistics || null;
  const unit = variable?.unit || '';
  const warnings = (dataset?.warnings || []).filter(Boolean);
  const provenance = (dataset?.provenance || []).map(provenanceLabel).filter(Boolean);
  const source = sourceSummaryModel(dataset);
  const totalKnown = dataset?.sourceRowCountKnown !== false;
  return <div>
    <section className="viz-panel-section viz-corner-safe">
      <h2 className="viz-panel-title">Data Information</h2>
      <div className="mt-2 text-[15px] font-semibold viz-text">{variable ? variableName(variable) : 'No variable selected'}</div>
      {variable?.description && variable.description !== variable.originalName && <div className="mt-0.5 text-[12px] viz-text-2">{variable.description}</div>}
      <div className="mt-0.5 text-xs viz-muted">Unit <span className="font-semibold viz-text-2">{unit || '—'}</span></div>
      {dataset?.isPreview && <p className="viz-note mt-2" data-tone="warning">Preview statistics — not the complete dataset.</p>}
    </section>

    <section className="viz-panel-section">
      <h2 className="viz-panel-title">Statistics</h2>
      {stats ? <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Minimum" value={fmt(stats.min)} unit={unit} />
        <Stat label="Maximum" value={fmt(stats.max)} unit={unit} />
        <Stat label="Mean" value={fmt(stats.mean)} unit={unit} />
        <Stat label="Valid" value={Number(stats.count || 0).toLocaleString()} />
        <Stat label="p2" value={fmt(stats.p2)} unit={unit} />
        <Stat label="p98" value={fmt(stats.p98)} unit={unit} />
        <Stat label="Missing" value={Number(stats.missingCount || 0).toLocaleString()} />
      </div> : <p className="mt-2 text-xs viz-muted">Select a numeric variable to see its statistics.</p>}
    </section>

    <DataQualityPanel dataset={dataset} variable={variable} view={view} />

    <section className="viz-panel-section">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setSourceOpen((value) => !value)} aria-expanded={sourceOpen}><h2 className="viz-panel-title">Source / Provenance</h2>{sourceOpen ? <ChevronDown className="h-4 w-4 viz-muted" /> : <ChevronRight className="h-4 w-4 viz-muted" />}</button>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Datasets" value={source.sourceCount} />
        <Stat label="Casts" value={source.castCount.toLocaleString()} />
        <Stat label="Measurements" value={totalKnown ? sourceRows.toLocaleString() : 'Unknown'} />
        <Stat label="Parsed" value={displayedRows.toLocaleString()} />
      </div>
      {!totalKnown && <p className="mt-2 text-[11px] viz-muted">The full row count is unknown until the complete file is loaded.</p>}
      <div className="mt-2.5 text-xs viz-muted">Mode: <span className="font-semibold viz-text-2">{MODE_LABELS[sourceMode] || sourceMode || '—'}</span></div>
      {!dataset?.isMerged && (access?.fileName || dataset?.fileName) && <div className="mt-1 break-all text-[11px] viz-muted">{access?.fileName || dataset?.fileName}</div>}
      {sourceOpen && <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--viz-border)' }}>
        {source.sourceNames.length > 0 && <div><div className="viz-label">Source files</div><ul className="mt-1 space-y-1 text-[12px] viz-text-2">{source.sourceNames.map((name, index) => <li key={`${name}-${index}`} className="break-all">{name}</li>)}</ul></div>}
        {provenance.length > 0 && <div><div className="viz-label">Normalization / provenance</div><ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] leading-relaxed viz-text-2">{provenance.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ul></div>}
      </div>}
    </section>

    <section className="viz-panel-section">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setWarningsOpen((value) => !value)} aria-expanded={warningsOpen} disabled={!warnings.length}><span className="inline-flex items-center gap-1.5"><TriangleAlert className={`h-3.5 w-3.5 ${warnings.length ? 'viz-warn-text' : 'viz-muted'}`} aria-hidden="true" /><h2 className="viz-panel-title">Scientific Warnings {warnings.length ? `(${warnings.length})` : ''}</h2></span>{warnings.length > 0 && (warningsOpen ? <ChevronDown className="h-4 w-4 viz-muted" /> : <ChevronRight className="h-4 w-4 viz-muted" />)}</button>
      {!warnings.length ? <p className="mt-2 text-[12px] viz-muted">No scientific warnings recorded.</p> : warningsOpen
        ? <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed viz-warn-text">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        : <p className="mt-2 text-[12px] leading-relaxed viz-warn-text">{warnings[0]}{warnings.length > 1 ? <span className="viz-muted"> · {warnings.length - 1} more</span> : ''}</p>}
    </section>
  </div>;
}
