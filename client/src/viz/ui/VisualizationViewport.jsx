import React from 'react';
import { Download, Maximize2, Minimize2, TriangleAlert, X } from 'lucide-react';
import { ADVANCED_3D_VIEWS, displayViewLabel, INTERPOLATED_VIEWS } from './workbenchModel.js';
import { variableName } from './labels.js';

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number(n.toPrecision(6)).toString();
}

function fmtBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let amount = bytes; let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

const STAGE_LABELS = {
  starting: 'Starting the parser',
  download: 'Downloading dataset',
  analyze: 'Scanning file structure',
  parse: 'Reading measurements',
  normalize: 'Normalizing values',
  complete: 'Finishing',
};

function stageLabel(stage) {
  return STAGE_LABELS[stage] || (stage ? `${String(stage).charAt(0).toUpperCase()}${String(stage).slice(1)}` : 'Preparing scientific data');
}

function LoadingState({ progress, onCancel }) {
  const percent = progress && Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(100, Number(progress.percent))) : null;
  const bytes = progress?.stage === 'download' && progress.loaded != null
    ? `${fmtBytes(progress.loaded) || '0 B'}${progress.total ? ` of ${fmtBytes(progress.total)}` : ''}`
    : null;
  return <div className="viz-empty" role="status" aria-live="polite">
    <div className="viz-empty-title">{stageLabel(progress?.stage)}…</div>
    <p className="viz-empty-text">{bytes || (percent != null ? `${percent}%` : 'Parsing runs in a background worker, so the page stays responsive.')}</p>
    <div className="viz-progress-track">{percent != null ? <div className="viz-progress-fill" style={{ width: `${percent}%` }} /> : <div className="viz-progress-fill viz-progress-indeterminate" />}</div>
    <button onClick={onCancel} className="viz-btn viz-btn-sm mt-4"><X className="h-3.5 w-3.5" /> Cancel</button>
  </div>;
}

function EmptyState({ title, text, action, onAction, disabled = false, secondary = null, tone = null }) {
  return <div className="viz-empty" data-tone={tone || undefined}>
    <div className={`viz-empty-title ${tone === 'warning' ? 'viz-warn-text' : tone === 'danger' ? 'viz-danger-text' : ''}`}>{title}</div>
    {text && <p className="viz-empty-text">{text}</p>}
    {(action || secondary) && <div className="mt-4 flex flex-wrap justify-center gap-2">
      {action && <button disabled={disabled} onClick={onAction} className="viz-btn viz-btn-primary">{action}</button>}
      {secondary}
    </div>}
  </div>;
}

export default function VisualizationViewport({
  view, variable, status, progress, error, selected, access, sourceMode,
  lowBandwidthGate, canFullLoad, onLoadFull, onCancel, onRetry, retryEnabled,
  oversizeLocal = null, onForceLocal = null,
  downloadAction = null, isFullscreen, onToggleFullscreen, children,
}) {
  const stats = variable?.statistics || null;
  const hasData = Boolean(children);
  const viewLabel = hasData ? displayViewLabel(view) : 'Visualization';
  const interpolated = hasData && INTERPOLATED_VIEWS.has(view);
  const threeD = ADVANCED_3D_VIEWS.has(view);
  let overlay = null;
  if (progress || status === 'loading') overlay = <LoadingState progress={progress} onCancel={onCancel} />;
  else if (status === 'cancelled') overlay = <EmptyState title="Visualization loading was cancelled" text="The same dataset can be loaded again without changing the selection." action="Load dataset" onAction={onRetry} />;
  else if (status === 'offline-blocked') overlay = <EmptyState tone="warning" title="This dataset is not saved on this device" text={retryEnabled ? 'The connection is back. Retry to load this dataset.' : 'Save the expedition for offline use while online to visualize its datasets without a connection. Retry becomes available when the connection returns.'} action="Retry visualization" onAction={onRetry} disabled={!retryEnabled} />;
  else if (status === 'local-too-large' && oversizeLocal) overlay = <EmptyState tone="warning" title="Large file for in-browser visualization" text={`This saved file is ${fmtBytes(oversizeLocal.fileSize)}; the browser limit for ${oversizeLocal.extension || 'this format'} files is ${fmtBytes(oversizeLocal.limit)}. Parsing it may use a lot of memory and could make this tab unresponsive on smaller devices.`} action="Try anyway" onAction={onForceLocal} />;
  else if (status === 'preview-only') overlay = <EmptyState title="Full visualization is not available here" text={error || 'No safe preview exists for this format under the current bandwidth and browser-size limits. The original dataset can still be downloaded.'} secondary={downloadAction} />;
  else if (error) overlay = <EmptyState tone={status === 'blocked' ? 'warning' : 'danger'} title={status === 'blocked' ? 'Visualization unavailable' : 'Could not prepare this visualization'} text={error} action={status === 'error' ? 'Retry visualization' : null} onAction={onRetry} secondary={status === 'blocked' ? downloadAction : null} />;
  else if (status === 'mapping') overlay = <EmptyState title="Confirm the data mapping" text="Some columns could not be identified with confidence. Confirm latitude, longitude, depth and time in the dialog to continue." />;
  else if (!selected) overlay = <EmptyState title="No dataset selected" text="Choose a scientific dataset from the list on the left." />;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="viz-viewport-bar">
      <div className="min-w-0 flex-1">
        <div className="viz-panel-title">{viewLabel}</div>
        <div className="truncate text-[15px] font-semibold viz-text">{variable ? variableName(variable) : (selected ? 'Scientific dataset' : 'No dataset selected')}{variable?.unit ? <span className="ml-1 font-normal viz-muted">({variable.unit})</span> : null}</div>
      </div>
      {stats && <div className="hidden items-center gap-3 text-[12px] viz-muted sm:flex"><span>min <strong className="viz-num viz-text">{fmt(stats.min)}</strong></span><span>max <strong className="viz-num viz-text">{fmt(stats.max)}</strong></span></div>}
      {interpolated && <span className="viz-status-chip" data-tone="warning" title="Includes interpolated estimates between measurements">Interpolated</span>}
      {sourceMode === 'offline' && <span className="viz-status-chip" data-tone="success" title="Loaded from the copy saved on this device">Offline copy</span>}
      {sourceMode === 'cache' && <span className="viz-status-chip" data-tone="info" title="Loaded from the local visualization cache">Cached</span>}
      {sourceMode === 'preview' && <span className="viz-status-chip" data-tone="warning" title="Only part of the dataset is shown">Preview</span>}
      <button onClick={onToggleFullscreen} className="viz-btn viz-btn-sm" aria-label={isFullscreen ? 'Exit fullscreen visualization' : 'Fullscreen visualization'}>{isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{isFullscreen ? 'Exit' : 'Fullscreen'}</button>
    </div>
    {lowBandwidthGate && <div className="viz-lowbw-bar"><div className="flex flex-wrap items-center gap-2"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /><strong>Low Bandwidth Mode</strong><span className="viz-text-2">{sourceMode === 'preview' ? 'Preview is active.' : 'A bounded preview is preferred when available.'} {fmtBytes(access?.fileSize) ? `Full visualization requires downloading ${fmtBytes(access.fileSize)}.` : 'Large datasets and advanced rendering are never triggered silently.'}</span>{canFullLoad && <button onClick={onLoadFull} className="viz-btn viz-btn-sm ml-auto"><Download className="h-3.5 w-3.5" /> Download & Visualize{fmtBytes(access?.fileSize) ? ` ${fmtBytes(access.fileSize)}` : ''}</button>}</div></div>}
    <div className="viz-viewport-stage"><div className={`viz-viewport-inner flex min-h-full flex-col ${overlay || !hasData ? 'justify-center' : ''}`}>{overlay || hasData ? (overlay || children) : <EmptyState title="Scientific visualization" text="Load a dataset to begin." />}</div></div>
    <div className="viz-viewport-footer"><span>{threeD ? '3D scenes are built from bounded, worker-generated products.' : 'Views are enabled only when the data supports them. Every chart draws a bounded sample.'}</span>{downloadAction}</div>
  </div>;
}
