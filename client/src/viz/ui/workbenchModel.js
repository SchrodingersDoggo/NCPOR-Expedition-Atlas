export const WORKBENCH_VIEW_GROUPS = [
  { key: 'spatial', label: 'Spatial', views: ['map', 'surfaceMap', 'depthSlice'] },
  { key: 'vertical', label: 'Vertical', views: ['profile', 'curtain'] },
  { key: 'temporal', label: 'Temporal', views: ['timeSeries'] },
  { key: 'currents', label: 'Currents', views: ['vectorField', 'vector3D'] },
  { key: 'threeD', label: '3D', views: ['surface3D', 'curtain3D', 'volume3D', 'isosurface'] },
  { key: 'analysis', label: 'Analysis', views: ['histogram', 'scatter', 'table'] },
];

export const INTERPOLATED_VIEWS = new Set(['curtain', 'depthSlice', 'surfaceMap', 'surface3D', 'volume3D', 'isosurface']);
export const ADVANCED_3D_VIEWS = new Set(['surface3D', 'curtain3D', 'volume3D', 'isosurface', 'vector3D']);

export function displayViewLabel(view, fallback = 'Scientific view') {
  const labels = {
    table: 'Data Table', histogram: 'Histogram', scatter: 'Scatter', timeSeries: 'Time Series',
    profile: 'Vertical Profile', map: 'Map', curtain: 'Curtain Section', depthSlice: 'Depth Slice',
    surfaceMap: 'Surface Layer', vectorField: 'Vector Field', surface3D: '3D Surface',
    curtain3D: '3D Curtain', volume3D: '3D Volume Field', isosurface: 'Isosurface', vector3D: '3D Current Field',
  };
  return labels[view] || fallback;
}

export function datasetStatusModel({ selected = false, supported = true, status = 'idle', sourceMode = null } = {}) {
  if (!supported) return { label: 'Not visualizable', tone: 'muted' };
  if (!selected) return { label: 'Available', tone: 'neutral' };
  if (status === 'loading') return { label: 'Loading', tone: 'info' };
  if (status === 'error') return { label: 'Error', tone: 'danger' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'warning' };
  if (status === 'offline-blocked') return { label: 'Offline · not saved', tone: 'warning' };
  if (status === 'local-too-large') return { label: 'Large file · confirm', tone: 'warning' };
  if (status === 'mapping') return { label: 'Needs mapping', tone: 'info' };
  if (status === 'blocked') return { label: 'Download only', tone: 'muted' };
  if (status === 'preview-only' || sourceMode === 'preview') return { label: 'Preview', tone: 'warning' };
  if (sourceMode === 'offline') return { label: 'Offline', tone: 'success' };
  if (sourceMode === 'cache') return { label: 'Cached', tone: 'success' };
  if (status === 'ready') return { label: 'Loaded', tone: 'success' };
  return { label: 'Selected', tone: 'info' };
}

export function dataQualityModel({ dataset, variable, view } = {}) {
  const stats = variable?.statistics || null;
  const valid = Number(stats?.count || 0);
  const missing = Number(stats?.missingCount || 0);
  const total = valid + missing;
  const missingPercent = total > 0 ? (missing / total) * 100 : 0;
  const interpolated = INTERPOLATED_VIEWS.has(view);
  const derived3D = view === 'volume3D' || view === 'isosurface';
  return {
    interpolated,
    derived3D,
    measured: true,
    missingPercent,
    coverageLabel: interpolated ? 'Coverage-masked' : (dataset?.normalizedCoords?.lat && dataset?.normalizedCoords?.lon ? 'Measured coverage' : 'Variable coverage'),
  };
}

export function sourceSummaryModel(dataset) {
  const sourceDatasets = Array.isArray(dataset?.sourceDatasets) ? dataset.sourceDatasets : [];
  const sourceNames = sourceDatasets.map((source) => source?.fileName || source?.name).filter(Boolean);
  return {
    sourceCount: sourceDatasets.length || (dataset ? 1 : 0),
    sourceNames: sourceNames.length ? sourceNames : (dataset?.fileName ? [dataset.fileName] : []),
    rowCount: Number(dataset?.rowCount || 0),
    castCount: Array.isArray(dataset?.casts) ? dataset.casts.length : 0,
  };
}

export function networkStatusModel({ isOffline = false, isSlow = false, sourceMode = null } = {}) {
  const chips = [];
  if (isOffline) chips.push({ label: 'Offline', tone: 'warning', title: 'No connection — only datasets saved on this device can be visualized' });
  else chips.push({ label: 'Online', tone: 'success', title: 'Connected' });
  if (isSlow) chips.push({ label: 'Low Bandwidth', tone: 'warning', title: 'Large files are never downloaded without your confirmation' });
  if (sourceMode === 'preview') chips.push({ label: 'Preview Mode', tone: 'warning', title: 'Only part of the dataset is shown' });
  if (sourceMode === 'offline') chips.push({ label: 'Saved Offline', tone: 'success', title: 'Loaded from the copy saved on this device' });
  if (sourceMode === 'cache') chips.push({ label: 'Fast Cache', tone: 'info', title: 'Loaded from the local visualization cache' });
  return chips;
}

export function contextualControlModel({ view, hasVariables = false, isNetcdf = false, hasTime = false, hasDepth = false } = {}) {
  return {
    variable: hasVariables && !['table', 'vectorField', 'vector3D'].includes(view),
    secondaryVariable: hasVariables && view === 'scatter',
    time: isNetcdf && hasTime && ['map', 'vectorField', 'surface3D', 'volume3D', 'isosurface', 'vector3D'].includes(view),
    depth: isNetcdf && hasDepth && ['map', 'vectorField', 'surface3D', 'vector3D'].includes(view),
    camera: ADVANCED_3D_VIEWS.has(view),
  };
}

export function nextPanelState(current, panel) {
  if (panel === 'left') return { ...current, leftCollapsed: !current.leftCollapsed };
  if (panel === 'right') return { ...current, rightCollapsed: !current.rightCollapsed };
  return { ...current };
}
