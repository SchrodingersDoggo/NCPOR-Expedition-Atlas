import { evaluateCapabilities } from './capabilities.js';
export const VISUALIZER_SCHEMA_VERSION = 2;
export const VIZ_CACHE_MAX_SAMPLE_ROWS = 12000;
export const VIZ_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sampleVizCacheIndexes(rowCount, limit = VIZ_CACHE_MAX_SAMPLE_ROWS) {
  const count = Math.max(0, Number(rowCount) || 0);
  const cap = Math.max(1, Math.floor(limit));
  if (count <= cap) return Array.from({ length: count }, (_, index) => index);
  const out = new Array(cap);
  for (let index = 0; index < cap; index += 1) out[index] = Math.round((index * (count - 1)) / (cap - 1));
  return out;
}

function subsetValues(values, indexes, numeric) {
  if (!values) return numeric ? new Float64Array(0) : [];
  if (numeric) {
    const out = new Float64Array(indexes.length);
    for (let i = 0; i < indexes.length; i += 1) {
      const value = finiteNumber(values[indexes[i]]);
      out[i] = value == null ? Number.NaN : value;
    }
    return out;
  }
  return indexes.map((index) => values[index] ?? null);
}

function compactField(field, indexes) {
  return { ...field, values: subsetValues(field.values, indexes, field.type === 'number'), cacheSampled: indexes.length < (field.values?.length || 0) };
}

function compactCoordinate(values, indexes) {
  if (!values) return null;
  return subsetValues(values, indexes, ArrayBuffer.isView(values));
}

function compactCasts(casts = []) {
  return casts.map((cast) => ({ ...cast, rowStart: 0, rowEnd: 0, segments: [], cacheMetadataOnly: true }));
}

function clonePlain(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cacheCapabilities(sampleCapabilities = {}, fullSourceCapabilities = {}) {
  const next = clonePlain(sampleCapabilities || {});
  for (const key of ['curtain', 'depthSlice', 'surfaceMap', 'volume']) {
    next[key] = {
      enabled: false,
      reason: 'This derived visualization cache contains bounded render samples only. Load the full source dataset for this full-source spatial view.',
      cachedSourceCapability: Boolean(fullSourceCapabilities?.[key]?.enabled),
      evidence: fullSourceCapabilities?.[key]?.evidence || next[key]?.evidence || null,
    };
  }
  return next;
}

export function compactPreparedForVizCache(prepared, { sourceMode = null } = {}) {
  const dataset = prepared?.dataset;
  if (!dataset?.contentId || !dataset?.datasetFingerprint || dataset?.isPreview) return null;
  const indexes = sampleVizCacheIndexes(dataset.rowCount);
  const sourceRowCount = Number(dataset.sourceRowCount || dataset.rowCount || 0);
  const fields = (dataset.fields || []).map((field) => compactField(field, indexes));
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const variables = (dataset.variables || []).map((variable) => ({ ...variable, statistics: fieldByKey.get(variable.fieldKey)?.statistics || variable.statistics || null }));
  const visualVariables = (dataset.visualVariables || []).map((variable) => ({ ...variable, statistics: fieldByKey.get(variable.fieldKey)?.statistics || variable.statistics || null }));
  const fullSourceCapabilities = clonePlain(prepared.capabilities || dataset.capabilities || {});
  const compactDataset = {
    ...dataset,
    fields,
    variables,
    visualVariables,
    rowCount: indexes.length,
    sourceRowCount,
    casts: compactCasts(dataset.casts || []),
    normalizedCoords: {
      ...dataset.normalizedCoords,
      lat: compactCoordinate(dataset.normalizedCoords?.lat, indexes),
      lon: compactCoordinate(dataset.normalizedCoords?.lon, indexes),
      depth: compactCoordinate(dataset.normalizedCoords?.depth, indexes),
      pressure: compactCoordinate(dataset.normalizedCoords?.pressure, indexes),
      time: compactCoordinate(dataset.normalizedCoords?.time, indexes),
      station: dataset.normalizedCoords?.station ? indexes.map((index) => dataset.normalizedCoords.station[index] ?? null) : null,
    },
    capabilities: null,
    fullSourceCapabilities,
    isVizCache: true,
    cacheSampleCount: indexes.length,
    cacheSourceMode: sourceMode,
    cacheSampled: indexes.length < Number(dataset.rowCount || 0),
    warnings: [
      ...(dataset.warnings || []),
      ...(indexes.length < Number(dataset.rowCount || 0)
        ? ['Loaded a bounded derived visualization cache. Statistics describe the original parsed dataset, while rendered points/rows are cached samples.']
        : []),
    ],
  };
  const sampleCapabilities = evaluateCapabilities(compactDataset);
  const capabilities = cacheCapabilities(sampleCapabilities, fullSourceCapabilities);
  compactDataset.capabilities = capabilities;
  return { status: 'ready', dataset: compactDataset, detection: prepared.detection || null, mapping: prepared.mapping || dataset.mapping || null, capabilities };
}

export function estimateVizCacheBytes(value, seen = new WeakSet()) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + estimateVizCacheBytes(entry, seen), 24 + value.length * 8);
  let total = 64;
  for (const [key, entry] of Object.entries(value)) total += key.length * 2 + estimateVizCacheBytes(entry, seen);
  return total;
}
