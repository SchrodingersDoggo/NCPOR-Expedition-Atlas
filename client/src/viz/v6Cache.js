import { getDb } from '../offline/db.js';
import { STORE_VIZ_CACHE } from '../offline/constants.js';
import { ensureSpaceFor, withStorageErrors } from '../offline/storage.js';
import { MAPPING_VERSION } from './detection.js';
import { buildVizCacheKey } from './storageKeys.js';
import { trackVizBaseCacheWrite, waitForVizBaseCacheWrite } from './v6CacheRace.js';
import {
  compactPreparedForVizCache,
  estimateVizCacheBytes,
  VISUALIZER_SCHEMA_VERSION,
  VIZ_CACHE_BUDGET_BYTES,
} from './v6CacheModel.js';

export { VISUALIZER_SCHEMA_VERSION, VIZ_CACHE_BUDGET_BYTES, VIZ_CACHE_MAX_SAMPLE_ROWS } from './v6CacheModel.js';

function recordKey({ ownerId, contentId, datasetFingerprint }) {
  return buildVizCacheKey({ ownerId: ownerId || 'shared', contentId, datasetFingerprint, mappingVersion: MAPPING_VERSION, visualizerSchemaVersion: VISUALIZER_SCHEMA_VERSION });
}

async function enforceBudget(db, incomingBytes, keepKey = null) {
  const records = await db.getAll(STORE_VIZ_CACHE);
  let total = records.reduce((sum, record) => sum + Number(record.estimatedBytes || 0), 0);
  if (keepKey) {
    const existing = records.find((record) => record.cacheKey === keepKey);
    if (existing) total -= Number(existing.estimatedBytes || 0);
  }
  const candidates = records
    .filter((record) => record.cacheKey !== keepKey)
    .sort((a, b) => Date.parse(a.lastAccessedAt || a.updatedAt || 0) - Date.parse(b.lastAccessedAt || b.updatedAt || 0));
  for (const record of candidates) {
    if (total + incomingBytes <= VIZ_CACHE_BUDGET_BYTES) break;
    await db.delete(STORE_VIZ_CACHE, record.cacheKey);
    total -= Number(record.estimatedBytes || 0);
  }
}

export async function loadVizCache({ ownerId = null, contentId, datasetFingerprint }) {
  if (!contentId || !datasetFingerprint) return null;
  const db = await getDb();
  const cacheKey = recordKey({ ownerId, contentId, datasetFingerprint });
  await waitForVizBaseCacheWrite(cacheKey);
  const record = await db.get(STORE_VIZ_CACHE, cacheKey);
  if (!record) return null;
  if (record.mappingVersion !== MAPPING_VERSION || record.visualizerSchemaVersion !== VISUALIZER_SCHEMA_VERSION) return null;
  const touched = { ...record, lastAccessedAt: new Date().toISOString() };
  try { await db.put(STORE_VIZ_CACHE, touched); } catch { /* best-effort cache touch */ }
  return touched;
}

async function performSaveVizCache(compactPrepared, { ownerId = null, sourceMode = null, access = null, advancedProducts = {} } = {}) {
  const dataset = compactPrepared?.dataset;
  if (!dataset?.contentId || !dataset?.datasetFingerprint) return null;
  const db = await getDb();
  const cacheKey = recordKey({ ownerId, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint });
  const previous = await db.get(STORE_VIZ_CACHE, cacheKey);
  const now = new Date().toISOString();
  const record = {
    cacheKey,
    ownerId: ownerId || 'shared',
    contentId: dataset.contentId,
    datasetFingerprint: dataset.datasetFingerprint,
    mappingVersion: MAPPING_VERSION,
    visualizerSchemaVersion: VISUALIZER_SCHEMA_VERSION,
    sourceMode,
    accessMeta: access ? {
      fileName: access.fileName || dataset.fileName,
      fileSize: Number(access.fileSize || 0) || null,
      storageProvider: access.storageProvider || null,
      datasetFingerprint: dataset.datasetFingerprint,
    } : previous?.accessMeta || null,
    prepared: compactPrepared,
    advancedProducts: { ...(previous?.advancedProducts || {}), ...(advancedProducts || {}) },
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    lastAccessedAt: now,
  };
  record.estimatedBytes = estimateVizCacheBytes(record);
  if (record.estimatedBytes > VIZ_CACHE_BUDGET_BYTES / 2) return null;
  try {
    await enforceBudget(db, record.estimatedBytes, cacheKey);
    await ensureSpaceFor(record.estimatedBytes);
    await withStorageErrors(() => db.put(STORE_VIZ_CACHE, record), 'visualization cache');
    return record;
  } catch {
    return null;
  }
}

export function saveVizCache(prepared, options = {}) {
  const compactPrepared = compactPreparedForVizCache(prepared, { sourceMode: options.sourceMode || null });
  const dataset = compactPrepared?.dataset;
  if (!dataset?.contentId || !dataset?.datasetFingerprint) return Promise.resolve(null);
  const cacheKey = recordKey({ ownerId: options.ownerId || null, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint });
  // Track the base write so an immediately generated advanced product can wait
  // for its parent cache record without blocking visualization itself.
  const promise = performSaveVizCache(compactPrepared, options);
  return trackVizBaseCacheWrite(cacheKey, promise);
}

export async function saveVizAdvancedProduct({ ownerId = null, contentId, datasetFingerprint }, productKey, product) {
  if (!contentId || !datasetFingerprint || !productKey || !product) return null;
  const db = await getDb();
  const cacheKey = recordKey({ ownerId, contentId, datasetFingerprint });
  await waitForVizBaseCacheWrite(cacheKey);
  const record = await db.get(STORE_VIZ_CACHE, cacheKey);
  if (!record) return null;
  const next = {
    ...record,
    advancedProducts: { ...(record.advancedProducts || {}), [productKey]: product },
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };
  next.estimatedBytes = estimateVizCacheBytes(next);
  if (next.estimatedBytes > VIZ_CACHE_BUDGET_BYTES / 2) return null;
  try {
    await enforceBudget(db, next.estimatedBytes, cacheKey);
    await ensureSpaceFor(Math.max(0, next.estimatedBytes - Number(record.estimatedBytes || 0)));
    await withStorageErrors(() => db.put(STORE_VIZ_CACHE, next), 'advanced visualization cache');
    return next;
  } catch {
    return null;
  }
}

export function advancedProductCacheKey({ view, variableKey = '', time = null, depth = null, pair = null, datasetFingerprint = '' }) {
  const pairKey = pair ? `${pair.u || ''}:${pair.v || ''}` : '';
  return [view, datasetFingerprint || '', variableKey || '', time ?? '', depth ?? '', pairKey].map((part) => encodeURIComponent(String(part))).join('|');
}
