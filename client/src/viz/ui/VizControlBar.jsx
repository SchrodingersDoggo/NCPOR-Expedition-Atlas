import React from 'react';
import { RotateCcw } from 'lucide-react';
import { contextualControlModel } from './workbenchModel.js';
import { variableLabel } from './labels.js';

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number(n.toPrecision(7)).toString();
}

function utc(value) {
  const d = new Date(Number(value));
  return Number.isFinite(d.getTime()) ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
}

export default function VizControlBar({
  view, variables = [], variableKey, secondaryKey, onVariable, onSecondary,
  netcdfControls, netcdfTime, netcdfDepth, onTime, onDepth,
  onResetCamera,
}) {
  const controls = contextualControlModel({
    view,
    hasVariables: variables.length > 0,
    isNetcdf: Boolean(netcdfControls?.isNetcdf),
    hasTime: (netcdfControls?.timeLevels?.length || 0) > 1,
    hasDepth: (netcdfControls?.depthLevels?.length || 0) > 1,
  });
  const nothing = !controls.variable && !controls.secondaryVariable && !controls.time && !controls.depth && !controls.camera;
  if (nothing) return null;
  const option = (field) => <option key={field.key} value={field.key}>{variableLabel(field)}</option>;
  return <div className="viz-toolbar">
    <div className="flex flex-wrap items-end gap-4">
      {controls.variable && <label className="viz-label">{view === 'scatter' ? 'X variable' : 'Variable'}<select value={variableKey} onChange={(event) => onVariable(event.target.value)} className="viz-select mt-1">{variables.map(option)}</select></label>}
      {controls.secondaryVariable && <label className="viz-label">Y variable<select value={secondaryKey} onChange={(event) => onSecondary(event.target.value)} className="viz-select mt-1">{variables.map(option)}</select></label>}
      {controls.time && <label className="viz-label min-w-[220px] flex-1"><span className="flex justify-between gap-3"><span>Time</span><span className="viz-num normal-case tracking-normal viz-accent-text">{Number.isFinite(netcdfTime) ? utc(netcdfTime) : '—'}</span></span><input type="range" min="0" max={netcdfControls.timeLevels.length - 1} step="1" value={Math.max(0, netcdfControls.timeLevels.findIndex((value) => value === netcdfTime))} onChange={(event) => onTime(netcdfControls.timeLevels[Number(event.target.value)])} className="viz-range mt-2" aria-label="Time level" /></label>}
      {controls.depth && <label className="viz-label min-w-[220px] flex-1"><span className="flex justify-between gap-3"><span>{netcdfControls.verticalKind === 'pressure' ? 'Pressure' : 'Depth'}</span><span className="viz-num normal-case tracking-normal viz-accent-text">{fmt(netcdfDepth)}{netcdfControls.depthUnit ? ` ${netcdfControls.depthUnit}` : ''}</span></span><input type="range" min="0" max={netcdfControls.depthLevels.length - 1} step="1" value={Math.max(0, netcdfControls.depthLevels.findIndex((value) => value === netcdfDepth))} onChange={(event) => onDepth(netcdfControls.depthLevels[Number(event.target.value)])} className="viz-range mt-2" aria-label="Depth level" /></label>}
      {controls.camera && <div className="ml-auto flex flex-wrap items-center gap-3"><div className="text-[12px] leading-relaxed viz-muted"><span className="font-semibold viz-text-2">3D:</span> drag to rotate · scroll to zoom · Shift+drag to pan</div><button onClick={onResetCamera} className="viz-btn viz-btn-sm"><RotateCcw className="h-3.5 w-3.5" /> Reset camera</button></div>}
    </div>
  </div>;
}
