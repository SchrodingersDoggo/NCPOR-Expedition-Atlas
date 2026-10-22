import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { canonicalFromRows } from '../model.js';
import { detectDatasetMapping, MAPPING_VERSION } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import { evaluateAdvanced3DCapabilities } from '../v6Capabilities.js';
import {
  buildCurtain3DProduct,
  buildIsosurfacePoints,
  buildSurface3DProduct,
  buildVector3DProduct,
  buildVolume3DProduct,
  V6_GPU_LIMITS,
} from '../v6Products.js';
import {
  compactPreparedForVizCache,
  VISUALIZER_SCHEMA_VERSION,
  VIZ_CACHE_MAX_SAMPLE_ROWS,
} from '../v6CacheModel.js';
import { buildVizCacheKey } from '../storageKeys.js';

function ready(headers, rows, fileName = 'v6.csv') {
  const canonical = canonicalFromRows(headers, rows, {
    contentId: 'content-v6', datasetFingerprint: 'sha256:v6', fileName,
  });
  const detection = detectDatasetMapping(canonical);
  assert.equal(detection.needsMapping, false);
  const dataset = normalizeScientificDataset(canonical, detection.mapping, detection);
  dataset.casts = groupDatasetCasts(dataset);
  dataset.capabilities = evaluateCapabilities(dataset);
  return { status: 'ready', dataset, detection, mapping: detection.mapping, capabilities: dataset.capabilities };
}

function denseVolumeRows() {
  const rows = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      for (let z = 0; z < 5; z += 1) {
        rows.push([-70 + y * 0.08, 20 + x * 0.1, z * 50, -1 + x * 0.3 + y * 0.2 + z * 0.15]);
      }
    }
  }
  return rows;
}

test('V6 cache key includes owner, fingerprint, mapping version and visualizer schema version', () => {
  const key = buildVizCacheKey({ ownerId: 'u1', contentId: 'c1', datasetFingerprint: 'sha256:abc', mappingVersion: MAPPING_VERSION, visualizerSchemaVersion: VISUALIZER_SCHEMA_VERSION });
  assert.match(key, /u1/);
  assert.match(key, /sha256%3Aabc/);
  assert.match(key, /::m1::v2$/);
});

test('V6 compact vizCache remains bounded and preserves full-source statistics metadata', () => {
  const rows = Array.from({ length: 20000 }, (_, index) => [60 + (index % 100) * 0.001, 10 + (index % 100) * 0.001, index]);
  const prepared = ready(['lat', 'lon', 'temperature'], rows);
  const originalStats = prepared.dataset.fields.find((field) => field.originalName === 'temperature').statistics;
  const compact = compactPreparedForVizCache(prepared, { sourceMode: 'full' });
  assert.ok(compact);
  assert.equal(compact.dataset.isVizCache, true);
  assert.equal(compact.dataset.rowCount, VIZ_CACHE_MAX_SAMPLE_ROWS);
  assert.equal(compact.dataset.sourceRowCount, 20000);
  const field = compact.dataset.fields.find((entry) => entry.originalName === 'temperature');
  assert.equal(field.values.length, VIZ_CACHE_MAX_SAMPLE_ROWS);
  assert.equal(field.statistics.max, originalStats.max);
  assert.equal(field.statistics.mean, originalStats.mean);
  assert.equal(compact.capabilities.surfaceMap.enabled, false, 'full-source-only spatial interpolation is not reconstructed from a bounded cache');
});

test('V6 surface product is bounded and keeps measured observations separate', () => {
  const prepared = ready(['lat', 'lon', 'depth_m', 'temperature'], denseVolumeRows());
  const variable = prepared.dataset.visualVariables[0].fieldKey;
  const product = buildSurface3DProduct(prepared.dataset, variable);
  assert.equal(product.valid, true);
  assert.ok(product.cells.length > 0 && product.cells.length <= V6_GPU_LIMITS.surfaceCells);
  assert.ok(product.measured.length > 0 && product.measured.length <= V6_GPU_LIMITS.surfaceSources);
  assert.ok(product.cells.some((cell) => cell.interpolated));
});

test('V6 dense volume product and isosurface are bounded by GPU safety limits', () => {
  const prepared = ready(['lat', 'lon', 'depth_m', 'temperature'], denseVolumeRows());
  assert.equal(prepared.capabilities.volume.enabled, true);
  const variable = prepared.dataset.visualVariables[0].fieldKey;
  const product = buildVolume3DProduct(prepared.dataset, variable);
  assert.equal(product.valid, true);
  assert.ok(product.cells.length > 0 && product.cells.length <= V6_GPU_LIMITS.volumeCells);
  assert.ok(product.measured.length <= 900);
  const iso = (product.valueRange.min + product.valueRange.max) / 2;
  const shell = buildIsosurfacePoints(product, iso);
  assert.ok(shell.length > 0 && shell.length <= V6_GPU_LIMITS.isosurfacePoints);
});

test('V6 never upgrades a four-cast transect into a volume while 3D curtain remains possible', () => {
  const rows = [];
  for (let cast = 0; cast < 4; cast += 1) {
    for (let depth = 0; depth < 14; depth += 1) rows.push([60 + cast * 0.2, 10 + cast * 0.2, depth * 20, `S${cast}`, depth + cast]);
  }
  const prepared = ready(['lat', 'lon', 'depth_m', 'station', 'temperature'], rows);
  assert.equal(prepared.capabilities.curtain.enabled, true);
  assert.equal(prepared.capabilities.volume.enabled, false);
  const variable = prepared.dataset.visualVariables[0].fieldKey;
  const curtain = buildCurtain3DProduct(prepared.dataset, variable);
  assert.equal(curtain.valid, true);
  assert.ok(curtain.points.length <= V6_GPU_LIMITS.curtainPoints);
  const caps = evaluateAdvanced3DCapabilities(prepared.dataset, prepared.capabilities, { completeSource: true });
  assert.equal(caps.curtain3D.enabled, true);
  assert.equal(caps.volume3D.enabled, false);
  assert.equal(caps.isosurface.enabled, false);
});

test('V6 vector 3D product uses the bounded valid-vector sampler', () => {
  const rows = [];
  for (let index = 0; index < 5000; index += 1) rows.push([60 + (index % 100) * 0.002, 10 + (index % 80) * 0.002, index % 30, 0.2 + index * 1e-5, -0.1]);
  const prepared = ready(['lat', 'lon', 'depth_m', 'u', 'v'], rows);
  assert.equal(prepared.capabilities.vectorField.enabled, true);
  const pair = prepared.capabilities.vectorField.pair;
  const product = buildVector3DProduct(prepared.dataset, pair);
  assert.equal(product.valid, true);
  assert.ok(product.arrows.length > 0 && product.arrows.length <= V6_GPU_LIMITS.vectorArrows);
});

test('V6 cached advanced product may enable its 3D mode without pretending sampled cache supports new volume inference', () => {
  const prepared = ready(['lat', 'lon', 'depth_m', 'temperature'], denseVolumeRows());
  const variable = prepared.dataset.visualVariables[0].fieldKey;
  const product = buildVolume3DProduct(prepared.dataset, variable);
  const productKey = 'volume-product';
  const cachedBase = {
    ...prepared.capabilities,
    volume: { enabled: false, reason: 'bounded cache', cachedSourceCapability: true },
  };
  const caps = evaluateAdvanced3DCapabilities(prepared.dataset, cachedBase, {
    completeSource: false,
    cachedProducts: { [productKey]: product },
    productKeys: { volume3D: productKey, isosurface: productKey },
  });
  assert.equal(caps.volume3D.enabled, true);
  assert.equal(caps.isosurface.enabled, true);
  assert.equal(caps.volume3D.cachedProduct, true);
});

test('V6 load order checks vizCache before parsing an existing offline Blob and before full network fetch', async () => {
  const source = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const cacheLookup = source.indexOf('const cached = await loadVizCache');
  const offlineParse = source.indexOf("parseSource(offlineDataset.offlineFile.blob");
  const fullFetch = source.indexOf('const { response, access: refreshed } = await fetchDataset');
  assert.ok(cacheLookup >= 0 && cacheLookup < offlineParse);
  assert.ok(source.lastIndexOf('const cached = await loadVizCache', fullFetch) >= 0);
});

test('V6 WebGL renderer has an explicit context-loss fallback path', async () => {
  const source = await readFile(new URL('../components/V6Renderers.jsx', import.meta.url), 'utf8');
  assert.match(source, /webglcontextlost/);
  assert.match(source, /onFallback/);
  assert.match(source, /BufferGeometry/);
  assert.doesNotMatch(source, /InstancedMesh/);
  assert.doesNotMatch(source, /new THREE\.ArrowHelper/);
});

test('V6 keeps IndexedDB DB_VERSION at 6', () => {
  assert.equal(DB_VERSION, 6);
});
