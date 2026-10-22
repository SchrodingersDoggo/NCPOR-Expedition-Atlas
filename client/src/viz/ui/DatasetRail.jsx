import React from 'react';
import { CheckCircle2, Circle, Database, HardDriveDownload, LoaderCircle, X } from 'lucide-react';
import { datasetStatusModel } from './workbenchModel.js';

function fileLabel(name = '') {
  const ext = String(name).toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  const labels = { '.cnv': 'Sea-Bird CNV', '.csv': 'CSV', '.tsv': 'TSV', '.xlsx': 'Excel', '.xls': 'Excel', '.json': 'JSON', '.nc': 'NetCDF', '.nc4': 'NetCDF-4', '.h5': 'HDF5', '.hdf5': 'HDF5' };
  return labels[ext] || (ext ? ext.slice(1).toUpperCase() : 'Scientific dataset');
}

function itemSize(item, formatBytes) {
  const size = Number(item?.fileSizeBytes ?? item?.file_size_bytes ?? item?.size ?? item?.datasetMeta?.file_size ?? item?.offlineFile?.blob?.size ?? 0);
  return size > 0 ? formatBytes(size) : null;
}

export default function DatasetRail({
  datasets = [], loading = false, selectedId = '', selectedStatus = 'idle', sourceMode = null,
  isSupported, displayName, datasetFileName, formatBytes, onSelect,
  mergeCandidates = [], mergeSelectedIds = [], onToggleMerge, onMerge, onCancelMerge, onClearMerge,
  mergeStatus = 'idle', mergedDataset = null, mergePreflight = null, mergeError = '', sourceIsPreview = false, lowBandwidth = false,
  savedOfflineIds = null, offline = false,
}) {
  const supportedCount = datasets.filter((item) => isSupported(item)).length;
  return <div>
    <section className="viz-panel-section viz-corner-safe">
      <div className="flex items-center gap-2"><Database className="h-4 w-4 viz-accent-text" aria-hidden="true" /><h2 className="viz-panel-title">Datasets</h2>{!loading && datasets.length > 0 && <span className="ml-auto text-[11px] viz-muted viz-num">{supportedCount}/{datasets.length}</span>}</div>
      {loading ? <p className="mt-3 text-xs viz-muted">Loading expedition datasets…</p> : !datasets.length ? <p className="mt-3 text-xs viz-muted">No datasets are published for this expedition yet.</p> : <div className="mt-2 space-y-1">
        {datasets.map((item) => {
          const selected = String(item.id) === String(selectedId);
          const supported = isSupported(item);
          const state = datasetStatusModel({ selected, supported, status: selected ? selectedStatus : 'idle', sourceMode: selected ? sourceMode : null });
          const name = displayName(item);
          const size = itemSize(item, formatBytes);
          const savedOffline = Boolean(savedOfflineIds?.has?.(String(item.id)));
          return <button key={item.id} onClick={() => onSelect(item)} className="viz-item" aria-pressed={selected} title={supported ? name : `${name} — this file format cannot be visualized yet; it can still be downloaded.`}>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden="true">{selected ? (state.tone === 'info' && selectedStatus === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin viz-accent-text" /> : <CheckCircle2 className="h-4 w-4 viz-accent-text" />) : <Circle className={`h-4 w-4 ${supported ? 'viz-muted' : 'viz-faint'}`} />}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] font-semibold ${supported ? 'viz-text' : 'viz-muted'}`}>{name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] viz-muted"><span>{fileLabel(datasetFileName(item))}</span>{size && <span className="viz-num">· {size}</span>}{savedOffline && <span className="inline-flex items-center gap-0.5 viz-ok-text" title="Saved on this device"><HardDriveDownload className="h-3 w-3" aria-hidden="true" /> saved</span>}</span>
                <span className={`mt-1 inline-flex text-[11px] font-semibold viz-tone-${state.tone}`} data-tone={state.tone}>{state.label}</span>
              </span>
            </div>
          </button>;
        })}
      </div>}
    </section>

    {mergeCandidates.length > 0 && <section className="viz-panel-section">
      <div className="flex items-center justify-between gap-2"><h2 className="viz-panel-title">Combine casts</h2>{mergedDataset && <button onClick={onClearMerge} className="viz-btn viz-btn-ghost viz-btn-sm">Primary only</button>}</div>
      <p className="mt-1 text-[12px] leading-relaxed viz-muted">Add other station files with the same variables and units to build curtain sections, depth slices and surface layers.</p>
      {sourceIsPreview ? <p className="viz-note mt-2" data-tone="warning">Load the selected dataset fully before combining casts.</p> : <>
        <div className="mt-2 space-y-1">{mergeCandidates.map((item) => {
          const checked = mergeSelectedIds.includes(String(item.id));
          // Offline, only files saved on this device can be combined.
          const unavailableOffline = offline && !savedOfflineIds?.has?.(String(item.id));
          return <label key={item.id} className="viz-item flex cursor-pointer items-start gap-2.5" data-selected={checked} style={unavailableOffline ? { opacity: 0.55, cursor: 'not-allowed' } : undefined} title={unavailableOffline ? 'Not saved on this device — available when online' : undefined}>
            <input type="checkbox" className="viz-checkbox mt-0.5" checked={checked && !unavailableOffline} onChange={() => onToggleMerge(item.id)} disabled={mergeStatus === 'loading' || unavailableOffline} />
            <span className="min-w-0"><span className="block truncate text-[13px] font-medium viz-text">{displayName(item)}</span><span className="text-[11px] viz-muted">{fileLabel(datasetFileName(item))}{unavailableOffline ? ' · not saved offline' : ''}</span></span>
          </label>;
        })}</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button disabled={!mergeSelectedIds.length || mergeStatus === 'loading'} onClick={onMerge} className="viz-btn viz-btn-primary viz-btn-sm">{mergeStatus === 'loading' ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading…</> : `Load & merge (${mergeSelectedIds.length})`}</button>
          {mergeStatus === 'loading' && <button onClick={onCancelMerge} className="viz-btn viz-btn-sm"><X className="h-3.5 w-3.5" /> Cancel merge</button>}
        </div>
        {lowBandwidth && <p className="mt-2 text-[11px] viz-warn-text">Low Bandwidth Mode: selected files download only when you press Load &amp; merge.</p>}
        {mergedDataset && <p className="viz-note mt-2" data-tone="success">{mergedDataset.sourceDatasets?.length || 1} sources · {Number(mergedDataset.rowCount || 0).toLocaleString()} observations combined</p>}
        {mergePreflight && <p className="viz-note mt-2" data-tone={mergePreflight.allowed ? undefined : 'warning'}>Total {formatBytes(mergePreflight.totalBytes)} · browser limit {formatBytes(mergePreflight.limit)}{!mergePreflight.allowed ? ' — select fewer files.' : ''}</p>}
        {mergeStatus === 'cancelled' && <p className="mt-2 text-[12px] viz-muted">Merge cancelled. The selected dataset is still loaded.</p>}
        {mergeError && <p className="viz-note mt-2" data-tone="danger">{mergeError}</p>}
      </>}
    </section>}
  </div>;
}
