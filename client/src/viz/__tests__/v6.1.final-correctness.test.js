import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { canonicalFromRows } from '../model.js';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import { sliceNetcdfDataset } from '../netcdfSlice.js';
import { fullVisualizationLimit } from '../limits.js';
import { compactPreparedForVizCache, sampleVizCacheIndexes } from '../v6CacheModel.js';
import { evaluateAdvanced3DCapabilities, fallbackForAdvancedView } from '../v6Capabilities.js';
import {
  buildIsosurfaceMesh,
  buildVolume3DProduct,
  chooseVolumeResolution,
  depthUnitToKmScale,
  prepareV6ProductInput,
  V6_GPU_LIMITS,
} from '../v6Products.js';
import { createV6ProductLifecycle } from '../v6ProductLifecycle.js';
import { hasPendingVizBaseCacheWrite, trackVizBaseCacheWrite, waitForVizBaseCacheWrite } from '../v6CacheRace.js';

function ready(headers, rows, fileName = 'v61.csv') {
  const canonical = canonicalFromRows(headers, rows, { contentId: 'content-v61', datasetFingerprint: 'sha256:v61', fileName });
  const detection = detectDatasetMapping(canonical);
  assert.equal(detection.needsMapping, false);
  const dataset = normalizeScientificDataset(canonical, detection.mapping, detection);
  dataset.casts = groupDatasetCasts(dataset);
  dataset.capabilities = evaluateCapabilities(dataset);
  return { status: 'ready', dataset, detection, mapping: detection.mapping, capabilities: dataset.capabilities };
}

function denseRows(depthLevels = 4) {
  const rows = [];
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) for (let z = 0; z < depthLevels; z += 1) {
    rows.push([-70 + y * 0.08, 20 + x * 0.1, z * 100, -1 + x * 0.3 + y * 0.2 + z * 0.15]);
  }
  return rows;
}

function sparseFourByFourDepthRows() {
  const positions = [[-70,20],[-70,20.2],[-69.8,20],[-69.8,20.2]];
  const rows = [];
  for (const [lat, lon] of positions) for (let z = 0; z < 4; z += 1) rows.push([lat, lon, z * 100, lat + lon + z]);
  return rows;
}

function syntheticVolume(nx = 3, ny = 3, nz = 3, removeKey = null) {
  const cells = [];
  for (let iz = 0; iz < nz; iz += 1) for (let iy = 0; iy < ny; iy += 1) for (let ix = 0; ix < nx; ix += 1) {
    const key = `${ix}:${iy}:${iz}`;
    if (key === removeKey) continue;
    cells.push({ ix, iy, iz, x: ix, y: iy, z: iz, value: ix + iy + iz, confidence: 1 });
  }
  return { valid: true, cells, resolution: { nx, ny, nz, cells: nx * ny * nz }, bounds: { minX: 0, maxX: nx - 1, minY: 0, maxY: ny - 1, minZ: 0, maxZ: nz - 1, units: 'km' }, valueRange: { min: 0, max: nx + ny + nz - 3 }, measured: [] };
}

test('V6.1 hard-gates sparse 4-XY x 4-depth volume but permits genuinely dense XYZ volume', () => {
  const sparse = ready(['lat', 'lon', 'depth_m', 'temperature'], sparseFourByFourDepthRows());
  assert.equal(sparse.capabilities.volume.enabled, false);
  const sparseVariable = sparse.dataset.visualVariables[0].fieldKey;
  assert.equal(buildVolume3DProduct(sparse.dataset, sparseVariable).valid, false);

  const dense = ready(['lat', 'lon', 'depth_m', 'temperature'], denseRows());
  assert.equal(dense.capabilities.volume.enabled, true);
  const denseVariable = dense.dataset.visualVariables[0].fieldKey;
  const product = buildVolume3DProduct(dense.dataset, denseVariable);
  assert.equal(product.valid, true);
  assert.equal(product.coordinateUnits.horizontal, 'km');
  assert.equal(product.coordinateUnits.vertical, 'km');
});

test('V6.1 dynamic NetCDF-like time slice disables stale volume and selects a valid fallback', () => {
  const rows = [];
  const timeA = 1704067200;
  const timeB = 1704070800;
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) for (let z = 0; z < 4; z += 1) rows.push([timeA, -70 + y * 0.08, 20 + x * 0.1, z * 100, x + y + z]);
  for (const row of sparseFourByFourDepthRows()) rows.push([timeB, ...row]);
  const prepared = ready(['time', 'lat', 'lon', 'depth_m', 'temperature'], rows, 'time.nc');
  prepared.dataset.sourceMeta = { ...(prepared.dataset.sourceMeta || {}), netcdf: { coordinateLevels: {} } };
  const a = sliceNetcdfDataset(prepared.dataset, { time: timeA * 1000, depth: null });
  const b = sliceNetcdfDataset(prepared.dataset, { time: timeB * 1000, depth: null });
  assert.equal(a.capabilities.volume.enabled, true);
  assert.equal(b.capabilities.volume.enabled, false);
  const advanced = evaluateAdvanced3DCapabilities(b, b.capabilities, { completeSource: true });
  assert.equal(advanced.volume3D.enabled, false);
  assert.notEqual(fallbackForAdvancedView('volume3D', b.capabilities), 'volume3D');
});

test('V6.1 converts geometric depth units to km for volume resolution and rejects unknown units', () => {
  assert.equal(depthUnitToKmScale('m'), 0.001);
  assert.equal(depthUnitToKmScale('metres'), 0.001);
  assert.equal(depthUnitToKmScale('km'), 1);
  assert.equal(depthUnitToKmScale('cm'), 1e-5);
  assert.equal(depthUnitToKmScale('mm'), 1e-6);
  const resolution = chooseVolumeResolution(1000, { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 1 });
  assert.ok(resolution.nz <= resolution.nx && resolution.nz <= resolution.ny, '1000 m must behave like 1 km, not 1000 km');

  const unknown = ready(['lat', 'lon', 'depth', 'temperature'], denseRows());
  assert.equal(unknown.capabilities.volume.enabled, true, 'base capability is intentionally unit-agnostic');
  const input = prepareV6ProductInput('volume3D', unknown.dataset, unknown.dataset.visualVariables[0].fieldKey);
  assert.equal(input.valid, false);
  assert.match(input.reason, /recognized geometric depth unit/i);
});

test('V6.1 prepares only bounded source inputs before handing heavy generation to a worker', async () => {
  const dense = ready(['lat', 'lon', 'depth_m', 'temperature'], denseRows(8));
  const input = prepareV6ProductInput('volume3D', dense.dataset, dense.dataset.visualVariables[0].fieldKey);
  assert.equal(input.valid, true);
  assert.ok(input.source.length <= V6_GPU_LIMITS.volumeSourcePoints);
  const rendererSource = await readFile(new URL('../components/V6Renderers.jsx', import.meta.url), 'utf8');
  const workerClientSource = await readFile(new URL('../v6ProductWorkerClient.js', import.meta.url), 'utf8');
  assert.match(rendererSource, /buildV6ProductInWorker/);
  assert.doesNotMatch(rendererSource, /useMemo\(\(\) => cachedProduct \|\| buildProduct/);
  assert.match(workerClientSource, /new Worker/);
});

test('V6.1 generation lifecycle cancels stale worker results and remains reusable', () => {
  const lifecycle = createV6ProductLifecycle();
  const first = lifecycle.begin();
  const second = lifecycle.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(lifecycle.isCurrent(first.generation), false);
  assert.equal(lifecycle.isCurrent(second.generation), true);
  lifecycle.cancel();
  assert.equal(second.signal.aborted, true);
  const third = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(third.generation), true);
});

test('V6.1 marching-tetrahedra isosurface returns bounded triangle geometry', () => {
  const mesh = buildIsosurfaceMesh(syntheticVolume(4, 4, 4), 4.5);
  assert.equal(mesh.valid, true);
  assert.ok(mesh.triangleCount > 0 && mesh.triangleCount <= V6_GPU_LIMITS.maxIsoTriangles);
  assert.equal(mesh.positions.length, mesh.triangleCount * 9);
});

test('V6.1 isosurface never bridges a cube with a missing coverage corner', () => {
  const mesh = buildIsosurfaceMesh(syntheticVolume(2, 2, 2, '1:1:1'), 1.5);
  assert.equal(mesh.valid, false);
  assert.equal(mesh.triangleCount, 0);
});

test('V6.1 isosurface obeys configured triangle budget', () => {
  const mesh = buildIsosurfaceMesh(syntheticVolume(8, 8, 8), 9, { maxTriangles: 25 });
  assert.ok(mesh.triangleCount <= 25);
  assert.equal(mesh.positions.length, mesh.triangleCount * 9);
});

test('V6.1 delayed base-cache write is awaited before advanced-product attachment', async () => {
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const key = 'race-key';
  trackVizBaseCacheWrite(key, deferred);
  assert.equal(hasPendingVizBaseCacheWrite(key), true);
  let finished = false;
  const waiter = waitForVizBaseCacheWrite(key).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  release('base-written');
  await waiter;
  assert.equal(finished, true);
  assert.equal(hasPendingVizBaseCacheWrite(key), false);
  const cacheSource = await readFile(new URL('../v6Cache.js', import.meta.url), 'utf8');
  assert.match(cacheSource, /await waitForVizBaseCacheWrite\(cacheKey\)/);
});

test('V6.1 bounded vizCache re-evaluates render capabilities on sampled rows', () => {
  const sampled = new Set(sampleVizCacheIndexes(20000));
  const rows = Array.from({ length: 20000 }, (_, index) => {
    const validVector = !sampled.has(index);
    return [60 + (index % 100) * 0.001, 10 + (index % 100) * 0.001, validVector ? 0.2 : null, validVector ? -0.1 : null];
  });
  const prepared = ready(['lat', 'lon', 'u', 'v'], rows);
  assert.equal(prepared.capabilities.vectorField.enabled, true);
  const compact = compactPreparedForVizCache(prepared, { sourceMode: 'full' });
  assert.equal(compact.dataset.fullSourceCapabilities.vectorField.enabled, true);
  assert.equal(compact.capabilities.vectorField.enabled, false, 'bounded sample has no valid vector and must not copy the full-source capability');
});

test('V6.1 cached advanced product remains renderable without inferring a new volume from cache samples', () => {
  const prepared = ready(['lat', 'lon', 'depth_m', 'temperature'], denseRows());
  const variable = prepared.dataset.visualVariables[0].fieldKey;
  const product = buildVolume3DProduct(prepared.dataset, variable);
  const key = 'cached-volume';
  const caps = evaluateAdvanced3DCapabilities(prepared.dataset, { ...prepared.capabilities, volume: { enabled: false, reason: 'bounded sample' } }, {
    completeSource: false,
    cachedProducts: { [key]: product },
    productKeys: { volume3D: key, isosurface: key },
  });
  assert.equal(caps.volume3D.enabled, true);
  assert.equal(caps.volume3D.cachedProduct, true);
});

test('V6.1 WebGL fallback remains explicit and renderer callback is stabilized', async () => {
  const source = await readFile(new URL('../components/V6Renderers.jsx', import.meta.url), 'utf8');
  assert.match(source, /webglcontextlost/);
  assert.match(source, /useCallback/);
  assert.match(source, /buildIsoMeshObject/);
  assert.doesNotMatch(source, /InstancedMesh/);
});

test('V6.1 keeps DB_VERSION at 6 and NetCDF browser limit at 25 MiB', () => {
  assert.equal(DB_VERSION, 6);
  assert.equal(fullVisualizationLimit('ocean.nc'), 25 * 1024 * 1024);
});
