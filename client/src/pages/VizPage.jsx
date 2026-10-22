import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Activity, BarChart3, LineChart as LineIcon, Map as MapIcon, ScatterChart as ScatterIcon, Table2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchExpeditionById } from '../api/expeditions.js';
import { fetchExpeditionContent } from '../api/content.js';
import DatasetDownloadButton from '../components/DatasetDownloadButton.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useNetwork } from '../context/NetworkContext.jsx';
import { getSavedExpedition } from '../offline/savedExpeditions.js';
import { resolveOfflineDatasetFingerprint } from '../offline/datasetFingerprint.js';
import MappingDialog from '../viz/components/MappingDialog.jsx';
import { DataTableView, HistogramView, MapView, ProfileView, ScatterView, SeriesView } from '../viz/components/VizRenderers.jsx';
import { CurtainSectionView, DepthSliceView, SurfaceLayerView } from '../viz/components/V4Renderers.jsx';
import { VectorFieldView } from '../viz/components/V5Renderers.jsx';
import { getDatasetAccess, fetchDataset } from '../viz/datasetAccess.js';
import { getDatasetPreview } from '../viz/preview.js';
import { canonicalFromDatasetMeta } from '../viz/previewCanonical.js';
import { parseDatasetInWorker } from '../viz/workerClient.js';
import { prepareScientificDataset, acceptDatasetMapping } from '../viz/pipeline.js';
import { canFullyVisualizeInBrowser, formatBytes, fullVisualizationLimit, vizExtension } from '../viz/limits.js';
import { readBlobWithProgress } from '../viz/downloadProgress.js';
import { createLoadLifecycle, commitIfCurrent } from '../viz/loadLifecycle.js';
import { datasetFileName, isV3SupportedDataset, resolveDatasetSelection } from '../viz/selection.js';
import { canRestartVisualization, canUseRetryAction } from '../viz/retryState.js';
import { mergeCompatibleDatasets } from '../viz/v4Merge.js';
import { assessV4AggregateMerge, V4_AGGREGATE_MERGE_LIMIT } from '../viz/v4Limits.js';
import { netcdfDimensionControls, sliceNetcdfDataset } from '../viz/netcdfSlice.js';
import { advancedProductCacheKey, loadVizCache, saveVizAdvancedProduct, saveVizCache } from '../viz/v6Cache.js';
import { evaluateAdvanced3DCapabilities, fallbackForAdvancedView } from '../viz/v6Capabilities.js';
import VizWorkbench from '../viz/ui/VizWorkbench.jsx';
import DatasetRail from '../viz/ui/DatasetRail.jsx';
import VariableRail from '../viz/ui/VariableRail.jsx';
import VisualizationViewport from '../viz/ui/VisualizationViewport.jsx';
import ScientificInfoPanel from '../viz/ui/ScientificInfoPanel.jsx';
import ViewModeBar from '../viz/ui/ViewModeBar.jsx';
import VizControlBar from '../viz/ui/VizControlBar.jsx';
import { networkStatusModel } from '../viz/ui/workbenchModel.js';


const Advanced3DView = lazy(() => import('../viz/components/V6Renderers.jsx'));
const VIEWS = [
  ['table', 'Table', Table2], ['histogram', 'Histogram', BarChart3], ['scatter', 'Scatter', ScatterIcon],
  ['timeSeries', 'Time Series', LineIcon], ['profile', 'Profile', Activity], ['map', 'Map', MapIcon],
  ['curtain', 'Curtain Section', Activity], ['depthSlice', 'Depth Slice', MapIcon], ['surfaceMap', 'Surface Layer', MapIcon],
  ['vectorField', 'Vector Field', Activity],
  ['surface3D', '3D Surface', Activity], ['curtain3D', '3D Curtain', Activity],
  ['volume3D', '3D Volume Field', Activity], ['isosurface', 'Isosurface', Activity], ['vector3D', '3D Vectors', Activity],
];

function findOfflineDataset(saved, contentId) {
  return (saved?.content?.data || []).find((item) => String(item.id) === String(contentId) && item?.offlineFile?.blob) || null;
}

function formatLabel(fileName) {
  const ext = vizExtension(fileName);
  return ext ? `${ext.slice(1).toUpperCase()} (${ext})` : 'This file type';
}

function findOfflineDatasetInSet(ids, item) {
  return Boolean(item && ids?.has?.(String(item.id)));
}

function displayName(item) {
  return item?.title || item?.originalFileName || item?.fileName || `Dataset ${item?.id || ''}`;
}

function extensionSupported(item, access) {
  return isV3SupportedDataset({ ...item, originalFileName: access?.fileName || datasetFileName(item) });
}

function variableOptions(dataset) {
  const keys = new Set((dataset?.visualVariables || []).map((variable) => variable.fieldKey));
  return (dataset?.fields || []).filter((field) => keys.has(field.key) && field.type === 'number');
}


export default function VizPage() {
  const { id: expeditionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDatasetId = searchParams.get('dataset') || '';
  const { user } = useAuth();
  const network = useNetwork();
  const [expedition, setExpedition] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [access, setAccess] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [mappingState, setMappingState] = useState(null);
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [sourceMode, setSourceMode] = useState(null);
  const [view, setView] = useState('table');
  const [variableKey, setVariableKey] = useState('');
  const [secondaryKey, setSecondaryKey] = useState('');
  const [mergeSelectedIds, setMergeSelectedIds] = useState([]);
  const [mergedDataset, setMergedDataset] = useState(null);
  const [mergeStatus, setMergeStatus] = useState('idle');
  const [mergeError, setMergeError] = useState('');
  const [mergePreflight, setMergePreflight] = useState(null);
  const [netcdfTime, setNetcdfTime] = useState(null);
  const [netcdfDepth, setNetcdfDepth] = useState(null);
  const [advancedProducts, setAdvancedProducts] = useState({});
  const [resetCameraToken, setResetCameraToken] = useState(0);
  const [oversizeLocal, setOversizeLocal] = useState(null);
  const [savedOfflineIds, setSavedOfflineIds] = useState(() => new Set());
  const mergeLifecycleRef = useRef(null);
  const loadLifecycleRef = useRef(null);
  if (!loadLifecycleRef.current) loadLifecycleRef.current = createLoadLifecycle();
  if (!mergeLifecycleRef.current) mergeLifecycleRef.current = createLoadLifecycle();

  useEffect(() => {
    let active = true;
    setLoadingList(true);
    void (async () => {
      try {
        let exp = null;
        let data = [];
        if (!network.isOffline) {
          try {
            const contentResult = await Promise.all([fetchExpeditionById(expeditionId), fetchExpeditionContent(expeditionId)]);
            exp = contentResult[0];
            data = contentResult[1]?.data || [];
          } catch (networkError) {
            const saved = user?.id ? await getSavedExpedition(user.id, expeditionId) : null;
            if (!saved) throw networkError;
            exp = saved.expedition;
            data = saved.content?.data || [];
          }
        } else {
          const saved = user?.id ? await getSavedExpedition(user.id, expeditionId) : null;
          if (!saved) throw new Error('This expedition is not saved offline on this device.');
          exp = saved.expedition;
          data = saved.content?.data || [];
        }
        if (!active) return;
        setExpedition(exp);
        setDatasets(data);
        setError('');
      } catch (err) {
        if (active) setError(err?.message || 'Could not load expedition datasets.');
      } finally {
        if (active) setLoadingList(false);
      }
    })();
    return () => { active = false; };
  }, [expeditionId, network.isOffline, user?.id]);

  // Which datasets have a complete copy saved on this device (shown in the
  // dataset list, so offline availability is visible before selecting).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = user?.id ? await getSavedExpedition(user.id, expeditionId) : null;
        if (!active) return;
        setSavedOfflineIds(new Set((saved?.content?.data || []).filter((item) => item?.offlineFile?.blob).map((item) => String(item.id))));
      } catch {
        if (active) setSavedOfflineIds(new Set());
      }
    })();
    return () => { active = false; };
  }, [expeditionId, user?.id]);

  useEffect(() => {
    if (loadingList) return;
    const resolution = resolveDatasetSelection(datasets, requestedDatasetId);
    const nextId = resolution.selectedId;
    setSelectedId((current) => current === nextId ? current : nextId);

    if (nextId && requestedDatasetId !== nextId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('dataset', nextId);
        return next;
      }, { replace: true });
    } else if (!nextId && requestedDatasetId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('dataset');
        return next;
      }, { replace: true });
    }
  }, [datasets, loadingList, requestedDatasetId, setSearchParams]);

  const selected = useMemo(() => datasets.find((item) => String(item.id) === String(selectedId)) || null, [datasets, selectedId]);
  const vars = useMemo(() => variableOptions(prepared?.dataset), [prepared]);

  useEffect(() => {
    if (!vars.length) { setVariableKey(''); setSecondaryKey(''); return; }
    setVariableKey((current) => vars.some((v) => v.key === current) ? current : vars[0].key);
    setSecondaryKey((current) => vars.some((v) => v.key === current && v.key !== vars[0].key) ? current : (vars[1]?.key || vars[0].key));
  }, [vars]);

  useEffect(() => {
    if (!selected?.id) {
      loadLifecycleRef.current.cancel();
      return undefined;
    }
    void loadSelected(false, selected);
    return () => loadLifecycleRef.current.cancel();
    // The resolved dataset identity is the trigger. Query/list timing changes
    // that resolve to the same dataset do not start a duplicate download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    mergeLifecycleRef.current.cancel();
    setMergeSelectedIds([]);
    setMergedDataset(null);
    setMergeStatus('idle');
    setMergeError('');
    setMergePreflight(null);
    return () => mergeLifecycleRef.current.cancel();
  }, [selected?.id, prepared?.dataset?.datasetFingerprint]);

  function chooseDataset(item) {
    const nextId = String(item.id);
    const sameDataset = nextId === String(selectedId);
    if (sameDataset && canRestartVisualization(status)) {
      void loadSelected(false, item);
      return;
    }
    setSelectedId(nextId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('dataset', nextId);
      return next;
    });
  }

  function cancelCurrentLoad() {
    loadLifecycleRef.current.cancel();
    setProgress(null);
    setError('');
    setStatus('cancelled');
  }

  function retrySelectedDataset() {
    if (!selected || !canUseRetryAction(status, { isOffline: network.isOffline })) return;
    void loadSelected(false, selected);
  }

  async function parseSource(source, currentAccess, mode, target, load) {
    commitIfCurrent(load, () => setProgress({ stage: 'starting', percent: 0 }));
    const canonical = await parseDatasetInWorker(source, {
      fileName: currentAccess.fileName,
      contentId: target.id,
      sourceId: `${mode}:${target.id}`,
      datasetFingerprint: currentAccess.datasetFingerprint,
    }, {
      signal: load.signal,
      onProgress: (nextProgress) => commitIfCurrent(load, () => setProgress(nextProgress)),
    });
    if (!load.isCurrent()) throw new DOMException('Visualization load superseded.', 'AbortError');
    if (mode === 'preview') canonical.isPreview = true;
    return canonical;
  }

  async function prepare(canonical, mode, target, load, currentAccess = null) {
    const result = await prepareScientificDataset(canonical, { ownerId: user?.id || null });
    if (!load.isCurrent()) return false;
    if (result.status === 'mapping-required') {
      commitIfCurrent(load, () => {
        setMappingState({ canonical, detection: result.detection, suggestedMapping: result.suggestedMapping, mode, contentId: target.id, access: currentAccess });
        setStatus('mapping');
        setProgress(null);
      });
      return true;
    }
    result.dataset.capabilities = result.capabilities;
    commitIfCurrent(load, () => {
      setPrepared(result);
      setSourceMode(mode);
      setAdvancedProducts({});
      setView(result.capabilities.table?.enabled ? 'table' : VIEWS.find(([key]) => result.capabilities[key]?.enabled)?.[0] || 'table');
      setStatus('ready');
      setProgress(null);
    });
    if ((mode === 'full' || mode === 'offline') && result.dataset?.datasetFingerprint) {
      void saveVizCache(result, { ownerId: user?.id || null, sourceMode: mode, access: currentAccess });
    }
    return true;
  }

  async function loadPreview(currentAccess, target, load) {
    const metadataCanonical = canonicalFromDatasetMeta(target, { datasetFingerprint: currentAccess.datasetFingerprint, fileName: currentAccess.fileName });
    if (metadataCanonical) {
      await prepare(metadataCanonical, 'preview', target, load, currentAccess);
      return true;
    }
    const preview = await getDatasetPreview(target.id, { signal: load.signal });
    if (!load.isCurrent()) return false;
    if (preview.access) commitIfCurrent(load, () => setAccess(preview.access));
    if (preview.source === 'range' && preview.text) {
      const mime = vizExtension(currentAccess.fileName) === '.tsv' ? 'text/tab-separated-values' : 'text/plain';
      const canonical = await parseSource(new Blob([preview.text], { type: mime }), preview.access || currentAccess, 'preview', target, load);
      const knownRows = Number(currentAccess.datasetMeta?.row_count || 0);
      canonical.sourceRowCount = knownRows || canonical.rowCount;
      // A byte-range preview only knows how many rows it parsed; never present
      // that as the size of the whole dataset.
      canonical.sourceRowCountKnown = knownRows > 0;
      await prepare(canonical, 'preview', target, load, preview.access || currentAccess);
      return true;
    }
    return false;
  }

  function applyCachedRecord(record, target, load, currentAccess = null) {
    const cached = record?.prepared;
    if (!cached?.dataset || !load.isCurrent()) return false;
    cached.dataset.capabilities = cached.capabilities || cached.dataset.capabilities || {};
    commitIfCurrent(load, () => {
      setAccess(currentAccess || record.accessMeta || {
        fileName: cached.dataset.fileName || datasetFileName(target),
        fileSize: null,
        storageProvider: 'vizCache',
        datasetFingerprint: cached.dataset.datasetFingerprint,
      });
      setPrepared(cached);
      setSourceMode('cache');
      setAdvancedProducts(record.advancedProducts || {});
      setView(cached.capabilities?.table?.enabled ? 'table' : VIEWS.find(([key]) => cached.capabilities?.[key]?.enabled)?.[0] || 'table');
      setStatus('ready');
      setProgress(null);
      setError('');
    });
    return true;
  }

  async function loadSelected(forceFull, target = selected, { allowOversizeLocal = false } = {}) {
    if (!target?.id) return;
    const load = loadLifecycleRef.current.start();
    commitIfCurrent(load, () => {
      setPrepared(null); setMappingState(null); setAccess(null); setError(''); setProgress(null); setSourceMode(null); setAdvancedProducts({}); setOversizeLocal(null); setStatus('loading');
    });

    try {
      const saved = user?.id ? await getSavedExpedition(user.id, expeditionId) : null;
      if (!load.isCurrent()) return;
      const offlineDataset = findOfflineDataset(saved, target.id);
      if (offlineDataset?.offlineFile?.blob) {
        const offlineFileName = offlineDataset.originalFileName || offlineDataset.fileName || target.originalFileName || target.fileName || target.title || 'dataset';
        const offlineAccess = {
          fileName: offlineFileName,
          fileSize: offlineDataset.offlineFile.blob.size,
          storageProvider: 'offline',
          datasetMeta: offlineDataset.datasetMeta || target.datasetMeta || null,
          datasetFingerprint: resolveOfflineDatasetFingerprint(offlineDataset, target),
        };
        if (!forceFull && offlineAccess.datasetFingerprint) {
          const cached = await loadVizCache({ ownerId: user?.id || null, contentId: target.id, datasetFingerprint: offlineAccess.datasetFingerprint });
          if (!load.isCurrent()) return;
          if (cached && applyCachedRecord(cached, target, load, offlineAccess)) return;
        }
        commitIfCurrent(load, () => setAccess(offlineAccess));
        if (!extensionSupported(target, offlineAccess)) {
          commitIfCurrent(load, () => {
            setStatus('blocked');
            setError(`${formatLabel(offlineAccess.fileName)} files cannot be visualized in the browser yet.`);
          });
          return;
        }
        // The same per-format browser limits as online apply to saved copies
        // (JSON/XLSX/NetCDF/HDF5 expand a lot in memory). Offline there is no
        // server preview to fall back to, so the user may still choose to try.
        if (!allowOversizeLocal && !canFullyVisualizeInBrowser(offlineAccess.fileName, offlineAccess.fileSize)) {
          commitIfCurrent(load, () => {
            setOversizeLocal({
              fileSize: offlineAccess.fileSize,
              limit: fullVisualizationLimit(offlineAccess.fileName),
              extension: vizExtension(offlineAccess.fileName),
            });
            setStatus('local-too-large');
            setProgress(null);
          });
          return;
        }
        const canonical = await parseSource(offlineDataset.offlineFile.blob, offlineAccess, 'offline', target, load);
        await prepare(canonical, 'offline', target, load, offlineAccess);
        return;
      }

      if (network.isOffline) {
        commitIfCurrent(load, () => {
          setStatus('offline-blocked');
          setError('');
          setProgress(null);
        });
        return;
      }

      // Unsupported V3 datasets remain selectable so the user can download
      // the original, but they do not trigger a scientific file download.
      if (!extensionSupported(target, null)) {
        commitIfCurrent(load, () => {
          setAccess({
            fileName: datasetFileName(target),
            fileSize: Number(target.fileSizeBytes ?? target.file_size_bytes ?? 0) || null,
            storageProvider: target.storageProvider || null,
            datasetMeta: target.datasetMeta || null,
            datasetFingerprint: null,
          });
          setStatus('blocked');
          setError(`${formatLabel(datasetFileName(target))} files cannot be visualized in the browser yet. The original dataset can still be downloaded.`);
        });
        return;
      }

      const currentAccess = await getDatasetAccess(target.id, { signal: load.signal });
      if (!load.isCurrent()) return;
      commitIfCurrent(load, () => setAccess(currentAccess));
      if (!extensionSupported(target, currentAccess)) {
        commitIfCurrent(load, () => {
          setStatus('blocked');
          setError(`${formatLabel(currentAccess.fileName)} files cannot be visualized in the browser yet. The original dataset can still be downloaded.`);
        });
        return;
      }

      if (!forceFull && currentAccess.datasetFingerprint) {
        const cached = await loadVizCache({ ownerId: user?.id || null, contentId: target.id, datasetFingerprint: currentAccess.datasetFingerprint });
        if (!load.isCurrent()) return;
        if (cached && applyCachedRecord(cached, target, load, currentAccess)) return;
      }

      const fullAllowed = canFullyVisualizeInBrowser(currentAccess.fileName, currentAccess.fileSize);
      if (!forceFull && (network.isSlow || !fullAllowed)) {
        const previewed = await loadPreview(currentAccess, target, load);
        if (!load.isCurrent() || previewed) return;
        commitIfCurrent(load, () => setStatus('preview-only'));
        return;
      }
      if (!fullAllowed) {
        commitIfCurrent(load, () => {
          setStatus('preview-only');
          setError(`In-browser visualization is limited to ${formatBytes(fullVisualizationLimit(currentAccess.fileName))} for ${vizExtension(currentAccess.fileName)} files, and this dataset is ${formatBytes(currentAccess.fileSize)}. Download the original to analyse it locally.`);
        });
        return;
      }

      const { response, access: refreshed } = await fetchDataset(target.id, { signal: load.signal });
      if (!load.isCurrent()) return;
      commitIfCurrent(load, () => setAccess(refreshed));
      const blob = await readBlobWithProgress(response, {
        expectedSize: refreshed.fileSize,
        signal: load.signal,
        onProgress: (nextProgress) => commitIfCurrent(load, () => setProgress(nextProgress)),
      });
      if (!load.isCurrent()) return;
      const canonical = await parseSource(blob, refreshed, 'full', target, load);
      await prepare(canonical, 'full', target, load, refreshed);
    } catch (err) {
      if (err?.name === 'AbortError' || !load.isCurrent()) return;
      console.error(err);
      commitIfCurrent(load, () => {
        setError(err?.message || 'Could not prepare this dataset for visualization.');
        setStatus('error');
        setProgress(null);
      });
    }
  }

  async function inspectMergeSource(target, signal) {
    const saved = user?.id ? await getSavedExpedition(user.id, expeditionId) : null;
    const offlineDataset = findOfflineDataset(saved, target.id);
    if (offlineDataset?.offlineFile?.blob) {
      const fileName = offlineDataset.originalFileName || offlineDataset.fileName || datasetFileName(target);
      if (!isV3SupportedDataset({ ...target, originalFileName: fileName })) {
        throw new Error(`${displayName(target)} is not supported by the current readers.`);
      }
      if (!canFullyVisualizeInBrowser(fileName, offlineDataset.offlineFile.blob.size)) {
        throw new Error(`${displayName(target)} exceeds the ${formatBytes(fullVisualizationLimit(fileName))} browser-processing limit and cannot be merged client-side.`);
      }
      return {
        target,
        local: true,
        fileName,
        fileSize: offlineDataset.offlineFile.blob.size,
        offlineDataset,
      };
    }

    if (network.isOffline) throw new Error(`${displayName(target)} is not saved offline on this device.`);
    if (!isV3SupportedDataset(target)) throw new Error(`${displayName(target)} is not supported by the current readers.`);
    const currentAccess = await getDatasetAccess(target.id, { signal });
    if (!canFullyVisualizeInBrowser(currentAccess.fileName, currentAccess.fileSize)) {
      throw new Error(`${displayName(target)} exceeds the ${formatBytes(fullVisualizationLimit(currentAccess.fileName))} browser-processing limit and cannot be merged client-side.`);
    }
    return {
      target,
      local: false,
      fileName: currentAccess.fileName,
      fileSize: Number(currentAccess.fileSize || 0),
      access: currentAccess,
    };
  }

  async function loadPreparedMergeDataset(target, signal, inspected = null) {
    const source = inspected || await inspectMergeSource(target, signal);
    if (source.offlineDataset?.offlineFile?.blob) {
      const offlineDataset = source.offlineDataset;
      const canonical = await parseDatasetInWorker(offlineDataset.offlineFile.blob, {
        fileName: source.fileName,
        contentId: target.id,
        sourceId: `offline-merge:${target.id}`,
        datasetFingerprint: resolveOfflineDatasetFingerprint(offlineDataset, target),
      }, { signal });
      const result = await prepareScientificDataset(canonical, { ownerId: user?.id || null });
      if (result.status === 'mapping-required') throw new Error(`${displayName(target)} needs scientific mapping confirmation. Open it individually once and accept its mapping before merging.`);
      result.dataset.capabilities = result.capabilities;
      return result.dataset;
    }

    const { response, access: refreshed } = await fetchDataset(target.id, { signal });
    const blob = await response.blob();
    if (signal.aborted) throw new DOMException('Merge loading cancelled.', 'AbortError');
    const canonical = await parseDatasetInWorker(blob, {
      fileName: refreshed.fileName,
      contentId: target.id,
      sourceId: `merge:${target.id}`,
      datasetFingerprint: refreshed.datasetFingerprint,
    }, { signal });
    const result = await prepareScientificDataset(canonical, { ownerId: user?.id || null });
    if (result.status === 'mapping-required') throw new Error(`${displayName(target)} needs scientific mapping confirmation. Open it individually once and accept its mapping before merging.`);
    result.dataset.capabilities = result.capabilities;
    return result.dataset;
  }

  function toggleMergeDataset(contentId) {
    const key = String(contentId);
    setMergePreflight(null);
    setMergeError('');
    setMergeSelectedIds((current) => current.includes(key) ? current.filter((id) => id !== key) : [...current, key]);
  }

  async function mergeSelectedDatasets() {
    if (!prepared?.dataset || !mergeSelectedIds.length || sourceMode === 'preview') return;
    const load = mergeLifecycleRef.current.start();
    setMergeStatus('loading');
    setMergeError('');
    setMergePreflight(null);
    try {
      const datasetById = new Map(datasets.map((item) => [String(item.id), item]));
      // Preserve the explicit checkbox-selection order. If reliable cast times
      // exist, curtainMeasurements will later override this with chronology.
      const targets = mergeSelectedIds.map((id) => datasetById.get(String(id))).filter(Boolean);
      const inspected = [];
      for (const target of targets) {
        if (!load.isCurrent()) throw new DOMException('Merge loading cancelled.', 'AbortError');
        inspected.push(await inspectMergeSource(target, load.signal));
      }

      const primarySize = Number(access?.fileSize || 0);
      const preflight = assessV4AggregateMerge([
        {
          fileName: access?.fileName || dataset?.fileName,
          fileSize: primarySize,
          local: true,
          primary: true,
        },
        ...inspected,
      ], V4_AGGREGATE_MERGE_LIMIT);
      commitIfCurrent(load, () => setMergePreflight(preflight));
      if (!preflight.allowed) {
        commitIfCurrent(load, () => {
          setMergeStatus('blocked');
          setMergeError(preflight.reason || 'The selected datasets cannot be merged safely in this browser.');
        });
        return;
      }

      const loaded = [];
      for (let index = 0; index < targets.length; index += 1) {
        if (!load.isCurrent()) throw new DOMException('Merge loading cancelled.', 'AbortError');
        loaded.push(await loadPreparedMergeDataset(targets[index], load.signal, inspected[index]));
      }
      if (!load.isCurrent()) throw new DOMException('Merge loading cancelled.', 'AbortError');
      const merged = mergeCompatibleDatasets([prepared.dataset, ...loaded]);
      commitIfCurrent(load, () => {
        setMergedDataset(merged);
        setMergeStatus('ready');
        setMergeError('');
      });
      if (load.isCurrent()) toast.success(`Merged ${loaded.length + 1} compatible scientific datasets.`);
    } catch (err) {
      if (err?.name === 'AbortError' || !load.isCurrent()) return;
      console.error(err);
      commitIfCurrent(load, () => {
        setMergedDataset(null);
        setMergeStatus('error');
        setMergeError(err?.message || 'Could not merge the selected datasets.');
      });
    }
  }

  function cancelMerge() {
    mergeLifecycleRef.current.cancel();
    setMergeStatus('cancelled');
    setMergeError('');
  }

  function clearMergedDataset() {
    mergeLifecycleRef.current.cancel();
    setMergedDataset(null);
    setMergeSelectedIds([]);
    setMergeStatus('idle');
    setMergeError('');
    setMergePreflight(null);
    if (['curtain', 'depthSlice', 'surfaceMap', 'surface3D', 'curtain3D', 'volume3D', 'isosurface'].includes(view)) setView('table');
  }

  async function acceptMapping(mapping) {
    if (!mappingState || String(mappingState.contentId) !== String(selected?.id)) return;
    try {
      const result = await acceptDatasetMapping(mappingState.canonical, mapping, { ownerId: user?.id || null });
      if (String(mappingState.contentId) !== String(selected?.id)) return;
      result.dataset.capabilities = result.capabilities;
      setPrepared(result);
      setSourceMode(mappingState.mode);
      setAdvancedProducts({});
      setMappingState(null);
      setStatus('ready');
      setProgress(null);
      if ((mappingState.mode === 'full' || mappingState.mode === 'offline') && result.dataset?.datasetFingerprint) {
        void saveVizCache(result, { ownerId: user?.id || null, sourceMode: mappingState.mode, access: mappingState.access || access });
      }
      toast.success('Scientific mapping saved for this dataset version.');
    } catch (err) {
      toast.error(err?.message || 'Could not apply mapping.');
    }
  }

  const capabilities = prepared?.capabilities || {};
  const dataset = prepared?.dataset;
  const netcdfControls = useMemo(() => netcdfDimensionControls(dataset), [dataset]);
  useEffect(() => {
    setNetcdfTime(netcdfControls.timeLevels.length ? netcdfControls.timeLevels[0] : null);
    setNetcdfDepth(netcdfControls.depthLevels.length ? netcdfControls.depthLevels[0] : null);
  }, [dataset?.datasetFingerprint]);
  const netcdfSlice = useMemo(() => netcdfControls.isNetcdf ? sliceNetcdfDataset(dataset, {
    time: netcdfControls.timeLevels.length ? netcdfTime : null,
    depth: netcdfControls.depthLevels.length ? netcdfDepth : null,
  }) : dataset, [dataset, netcdfControls.isNetcdf, netcdfControls.timeLevels.length, netcdfControls.depthLevels.length, netcdfTime, netcdfDepth]);
  const netcdfVolumeSlice = useMemo(() => netcdfControls.isNetcdf ? sliceNetcdfDataset(dataset, {
    time: netcdfControls.timeLevels.length ? netcdfTime : null,
    depth: null,
  }) : dataset, [dataset, netcdfControls.isNetcdf, netcdfControls.timeLevels.length, netcdfTime]);
  const advancedDataset = mergedDataset || dataset;
  const advancedCapabilities = advancedDataset?.capabilities || capabilities;
  const v4Keys = new Set(['curtain', 'depthSlice', 'surfaceMap']);
  const v6Keys = new Set(['surface3D', 'curtain3D', 'volume3D', 'isosurface', 'vector3D']);
  const surface3DDataset = netcdfControls.isNetcdf ? netcdfSlice : advancedDataset;
  const volume3DDataset = netcdfControls.isNetcdf ? netcdfVolumeSlice : advancedDataset;
  const vector3DDataset = netcdfControls.isNetcdf ? netcdfSlice : dataset;
  const vectorPair = (vector3DDataset?.capabilities || capabilities).vectorField?.pair || null;
  const v6ProductKeys = {
    surface3D: advancedProductCacheKey({ view: 'surface3D', datasetFingerprint: surface3DDataset?.datasetFingerprint, variableKey, time: netcdfTime, depth: netcdfDepth }),
    curtain3D: advancedProductCacheKey({ view: 'curtain3D', datasetFingerprint: advancedDataset?.datasetFingerprint, variableKey }),
    volume3D: advancedProductCacheKey({ view: 'volume3D', datasetFingerprint: volume3DDataset?.datasetFingerprint, variableKey, time: netcdfTime }),
    isosurface: advancedProductCacheKey({ view: 'volume3D', datasetFingerprint: volume3DDataset?.datasetFingerprint, variableKey, time: netcdfTime }),
    vector3D: advancedProductCacheKey({ view: 'vector3D', datasetFingerprint: vector3DDataset?.datasetFingerprint, time: netcdfTime, depth: netcdfDepth, pair: vectorPair }),
  };
  const v6BaseCapabilities = {
    surfaceMap: surface3DDataset?.capabilities?.surfaceMap || advancedCapabilities.surfaceMap,
    curtain: advancedCapabilities.curtain,
    volume: volume3DDataset?.capabilities?.volume || advancedCapabilities.volume,
    vectorField: vector3DDataset?.capabilities?.vectorField || capabilities.vectorField,
  };
  const v6Capabilities = evaluateAdvanced3DCapabilities(volume3DDataset || dataset, v6BaseCapabilities, {
    completeSource: sourceMode !== 'cache' && sourceMode !== 'preview',
    cachedProducts: advancedProducts,
    productKeys: v6ProductKeys,
  });
  const capabilityForView = (key) => {
    if (v6Keys.has(key)) return v6Capabilities[key];
    if (key === 'vectorField') return netcdfSlice?.capabilities?.vectorField || capabilities.vectorField;
    if (key === 'map' && netcdfControls.isNetcdf) return netcdfSlice?.capabilities?.map || capabilities.map;
    if (!v4Keys.has(key)) return capabilities[key];
    if (dataset?.isPreview || dataset?.isVizCache) return { enabled: false, reason: 'Spatial interpolation needs the complete dataset. Load the full file (or its saved offline copy) — a preview or cached sample is not enough.' };
    return advancedCapabilities[key];
  };
  const mergeCandidates = datasets.filter((item) => String(item.id) !== String(selected?.id) && isV3SupportedDataset(item));
  const advancedViewActive = v4Keys.has(view);
  const advanced3DViewActive = v6Keys.has(view);
  const netcdfSliceActive = netcdfControls.isNetcdf && ['map', 'vectorField'].includes(view);
  const v6InfoDataset = ['surface3D'].includes(view) ? surface3DDataset : ['volume3D', 'isosurface'].includes(view) ? volume3DDataset : view === 'vector3D' ? vector3DDataset : advancedDataset;
  const infoDataset = advanced3DViewActive ? v6InfoDataset : advancedViewActive ? advancedDataset : netcdfSliceActive ? netcdfSlice : dataset;
  const infoVariable = variableOptions(infoDataset).find((field) => field.key === variableKey) || variableOptions(infoDataset)[0] || null;
  const sourceRows = Number(infoDataset?.sourceRowCount || infoDataset?.rowCount || 0);
  const displayedRows = Number(infoDataset?.rowCount || 0);
  const infoSourceMode = (advancedViewActive || advanced3DViewActive) && mergedDataset ? 'merged' : sourceMode;
  const infoAccess = (advancedViewActive || advanced3DViewActive) && mergedDataset ? null : access;
  // Only meaningful for files the visualizer can read at all; an unsupported
  // format is download-only and must not suggest a bigger download.
  const lowBandwidthGate = access && !network.isOffline && status !== 'blocked' && isV3SupportedDataset({ originalFileName: access.fileName }) && (network.isSlow || !canFullyVisualizeInBrowser(access.fileName, access.fileSize));
  const showRetryAction = selected && canRestartVisualization(status);
  const retryEnabled = showRetryAction && canUseRetryAction(status, { isOffline: network.isOffline });
  const activeV6ProductKey = v6ProductKeys[view] || null;
  const activeV6CachedProduct = activeV6ProductKey ? advancedProducts[activeV6ProductKey] || null : null;
  const activeV6Dataset = view === 'surface3D' ? surface3DDataset
    : view === 'curtain3D' ? advancedDataset
      : (view === 'volume3D' || view === 'isosurface') ? volume3DDataset
        : view === 'vector3D' ? vector3DDataset : null;
  const activeV6Pair = view === 'vector3D' ? vectorPair : null;
  const v6FallbackCapabilities = {
    table: capabilities.table,
    map: netcdfControls.isNetcdf ? (netcdfSlice?.capabilities?.map || capabilities.map) : capabilities.map,
    surfaceMap: netcdfControls.isNetcdf ? netcdfSlice?.capabilities?.surfaceMap : advancedCapabilities.surfaceMap,
    curtain: advancedCapabilities.curtain,
    profile: capabilities.profile,
    vectorField: netcdfControls.isNetcdf ? (netcdfSlice?.capabilities?.vectorField || capabilities.vectorField) : capabilities.vectorField,
  };
  const v6FallbackView = fallbackForAdvancedView(view, v6FallbackCapabilities);
  const activeV6Capability = v6Keys.has(view) ? v6Capabilities[view] : null;

  useEffect(() => {
    if (!v6Keys.has(view) || activeV6Capability?.enabled !== false) return;
    // Dynamic NetCDF slicing can invalidate a previously valid advanced mode.
    // Never keep rendering the stale product after the exact current slice
    // fails the scientific capability gate.
    setView(v6FallbackView);
  }, [view, activeV6Capability?.enabled, v6FallbackView, netcdfTime, netcdfDepth, variableKey]);

  const persistAdvancedProduct = useCallback((product) => {
    if (!activeV6ProductKey || !product) return;
    setAdvancedProducts((current) => ({ ...current, [activeV6ProductKey]: product }));
    // Multi-file products depend on the complete merged fingerprint and must not
    // be persisted under the primary content record's cache identity.
    if (activeV6Dataset?.isMerged || !dataset?.contentId || !dataset?.datasetFingerprint) return;
    void saveVizAdvancedProduct({ ownerId: user?.id || null, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint }, activeV6ProductKey, product);
  }, [activeV6ProductKey, activeV6Dataset?.isMerged, dataset?.contentId, dataset?.datasetFingerprint, user?.id]);

  const workstationStatuses = networkStatusModel({ isOffline: network.isOffline, isSlow: network.isSlow, sourceMode });
  const canLoadFullSource = Boolean(access && canFullyVisualizeInBrowser(access.fileName, access.fileSize) && !network.isOffline);
  const downloadAction = selected && !network.isOffline ? <DatasetDownloadButton itemId={selected.id} label="Download original" className="viz-link inline-flex items-center gap-1" /> : null;

  const visualizationContent = prepared && dataset ? <>
    {sourceMode === 'cache' && <div className="viz-note mb-3 flex flex-wrap items-center justify-between gap-2" data-tone="success"><span><strong>Loaded from the local visualization cache.</strong> This is a bounded sample of the dataset; views that need every measurement stay locked until the full source is loaded.</span>{!network.isOffline || findOfflineDatasetInSet(savedOfflineIds, selected) ? <button onClick={() => loadSelected(true, selected)} className="viz-btn viz-btn-sm">Load full source</button> : null}</div>}
    {view === 'table' && <DataTableView dataset={dataset} />}
    {view === 'histogram' && <HistogramView dataset={dataset} variableKey={variableKey} />}
    {view === 'scatter' && <ScatterView dataset={dataset} xKey={variableKey} yKey={secondaryKey} />}
    {view === 'timeSeries' && <SeriesView dataset={dataset} xValues={dataset.normalizedCoords?.time} variableKey={variableKey} xLabel="Time" formatTime />}
    {view === 'profile' && <ProfileView dataset={dataset} verticalValues={dataset.vertical?.kind === 'depth' ? dataset.normalizedCoords?.depth : dataset.normalizedCoords?.pressure} variableKey={variableKey} verticalLabel={dataset.vertical?.kind === 'depth' ? 'Depth' : 'Pressure'} />}
    {view === 'map' && <MapView dataset={netcdfControls.isNetcdf ? netcdfSlice : dataset} variableKey={variableKey} />}
    {view === 'vectorField' && <VectorFieldView dataset={netcdfSlice} pair={(netcdfSlice?.capabilities || capabilities).vectorField?.pair} />}
    {view === 'curtain' && <CurtainSectionView dataset={advancedDataset} variableKey={variableKey} />}
    {view === 'depthSlice' && <DepthSliceView dataset={advancedDataset} variableKey={variableKey} />}
    {view === 'surfaceMap' && <SurfaceLayerView dataset={advancedDataset} variableKey={variableKey} />}
    {v6Keys.has(view) && <Suspense fallback={<div className="viz-empty"><div className="viz-empty-title">Loading the 3D renderer…</div><div className="viz-progress-track"><div className="viz-progress-fill viz-progress-indeterminate" /></div></div>}><Advanced3DView view={view} dataset={activeV6Dataset} variableKey={variableKey} pair={activeV6Pair} cachedProduct={activeV6CachedProduct} productKey={activeV6ProductKey || ''} onProductReady={persistAdvancedProduct} onFallback={() => setView(v6FallbackView)} resetCameraToken={resetCameraToken} /></Suspense>}
  </> : null;

  const leftRail = <>
    <DatasetRail
      datasets={datasets}
      loading={loadingList}
      selectedId={selectedId}
      selectedStatus={status}
      sourceMode={sourceMode}
      isSupported={isV3SupportedDataset}
      displayName={displayName}
      datasetFileName={datasetFileName}
      formatBytes={formatBytes}
      onSelect={chooseDataset}
      mergeCandidates={mergeCandidates}
      mergeSelectedIds={mergeSelectedIds}
      onToggleMerge={toggleMergeDataset}
      onMerge={mergeSelectedDatasets}
      onCancelMerge={cancelMerge}
      onClearMerge={clearMergedDataset}
      mergeStatus={mergeStatus}
      mergedDataset={mergedDataset}
      mergePreflight={mergePreflight}
      mergeError={mergeError}
      sourceIsPreview={sourceMode === 'preview'}
      lowBandwidth={network.isSlow}
      savedOfflineIds={savedOfflineIds}
      offline={network.isOffline}
    />
    <VariableRail variables={vars} selectedKey={variableKey} onSelect={setVariableKey} />
  </>;

  const rightRail = <ScientificInfoPanel dataset={infoDataset} variable={infoVariable} access={infoAccess} sourceMode={infoSourceMode} sourceRows={sourceRows} displayedRows={displayedRows} view={view} />;

  const viewport = <VisualizationViewport
    view={view}
    variable={infoVariable}
    status={status}
    progress={progress}
    error={error}
    selected={selected}
    access={access}
    sourceMode={sourceMode}
    lowBandwidthGate={Boolean(lowBandwidthGate)}
    canFullLoad={canLoadFullSource}
    onLoadFull={() => selected && loadSelected(true, selected)}
    onCancel={cancelCurrentLoad}
    onRetry={retrySelectedDataset}
    retryEnabled={retryEnabled}
    oversizeLocal={oversizeLocal}
    onForceLocal={() => selected && loadSelected(false, selected, { allowOversizeLocal: true })}
    downloadAction={downloadAction}
  >{visualizationContent}</VisualizationViewport>;

  const modeBar = <ViewModeBar views={VIEWS} activeView={view} capabilityForView={capabilityForView} onSelect={setView} />;
  const controlBar = <VizControlBar
    view={view}
    variables={vars}
    variableKey={variableKey}
    secondaryKey={secondaryKey}
    onVariable={setVariableKey}
    onSecondary={setSecondaryKey}
    netcdfControls={netcdfControls}
    netcdfTime={netcdfTime}
    netcdfDepth={netcdfDepth}
    onTime={setNetcdfTime}
    onDepth={setNetcdfDepth}
    onResetCamera={() => setResetCameraToken((value) => value + 1)}
  />;

  return <>
    <VizWorkbench
      expeditionName={expedition?.name || 'Expedition'}
      backHref={`/expeditions/${expeditionId}#data`}
      statuses={workstationStatuses}
      left={leftRail}
      right={rightRail}
      viewport={viewport}
      modeBar={modeBar}
      controlBar={controlBar}
    />
    {mappingState && <MappingDialog dataset={mappingState.canonical} detection={mappingState.detection} initialMapping={mappingState.suggestedMapping} onAccept={acceptMapping} onCancel={() => { setMappingState(null); setStatus('idle'); }} />}
  </>;
}
