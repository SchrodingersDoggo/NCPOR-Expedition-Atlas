import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DB_VERSION } from '../../offline/constants.js';
import { createLoadLifecycle, commitIfCurrent } from '../loadLifecycle.js';
import { describeV4Dataset, mergeCompatibleDatasets } from '../v4Merge.js';
import { assessV4AggregateMerge, V4_AGGREGATE_MERGE_LIMIT } from '../v4Limits.js';
import { castTime, curtainMeasurements, interpolateBoundedGrid } from '../v4Spatial.js';

function field(key, name, unit, values) {
  const finite = values.filter(Number.isFinite);
  return {
    key,
    originalName: name,
    normalizedName: name,
    unit,
    type: 'number',
    values: Float64Array.from(values),
    statistics: {
      count: finite.length,
      missingCount: values.length - finite.length,
      min: Math.min(...finite),
      max: Math.max(...finite),
      mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    },
  };
}

function stationDataset({ id, lat, lon, startTime = null, offset = 0 }) {
  const depth = [0, 100, 200, 300];
  const temperature = [1, 2, 3, 4].map((value) => value + offset);
  const temp = field('field_temp', 'Temperature', '°C', temperature);
  return {
    contentId: id,
    sourceId: `source:${id}`,
    fileName: `station-${id}.cnv`,
    datasetFingerprint: `sha256:${id}`,
    rowCount: depth.length,
    fields: [temp],
    variables: [{ fieldKey: temp.key, name: 'Temperature', originalName: 'Temperature', unit: '°C', type: 'numeric', statistics: temp.statistics }],
    visualVariables: [{ fieldKey: temp.key, name: 'Temperature', originalName: 'Temperature', unit: '°C', type: 'numeric', statistics: temp.statistics }],
    coords: { lat: null, lon: null, depth: 'depth', pressure: null, time: null, station: null },
    normalizedCoords: {
      lat: Float64Array.from(depth, () => Number.NaN),
      lon: Float64Array.from(depth, () => Number.NaN),
      depth: Float64Array.from(depth),
      pressure: null,
      time: null,
      timeNormalized: false,
      timeMode: null,
      station: null,
    },
    vertical: { kind: 'depth', fieldKey: 'depth', unit: 'm' },
    mapping: { fields: { field_temp: 'variable' }, roles: { depth: 'depth' } },
    casts: [{ id: `cast-${id}`, rowStart: 0, rowEnd: 3, rowCount: 4, latitude: lat, longitude: lon, startTime, source: 'reader' }],
    warnings: [],
    provenance: [],
  };
}

function geographicGrid(points) {
  return interpolateBoundedGrid(points, { maxCells: 900, coordinateMode: 'geographic' });
}

test('dateline-crossing points remain spatially local instead of spanning 358 degrees', () => {
  const grid = geographicGrid([
    { x: 179, y: -70, value: 1 },
    { x: -179, y: -70, value: 2 },
    { x: 179, y: -71, value: 3 },
    { x: -179, y: -71, value: 4 },
  ]);
  assert.ok(grid.cells.length > 0);
  assert.ok(grid.geographicBounds.longitudeSpan <= 2.01, `unexpected span ${grid.geographicBounds.longitudeSpan}`);
  assert.ok(grid.bounds.maxX - grid.bounds.minX < 100, 'polar dateline points should be locally close in km');
  assert.ok(grid.cells.every((cell) => Math.abs(cell.lon) > 170), 'interpolation must stay near the dateline, not cross the rest of the globe');
});

test('polar dateline projection remains local around 70S', () => {
  const grid = geographicGrid([
    { x: 179.4, y: -69.8, value: 1 },
    { x: -179.5, y: -69.9, value: 2 },
    { x: 179.2, y: -70.4, value: 3 },
    { x: -179.6, y: -70.5, value: 4 },
  ]);
  assert.ok(grid.cells.length > 0);
  assert.ok(grid.geographicBounds.longitudeSpan < 2);
  assert.ok(grid.bounds.maxX - grid.bounds.minX < 60);
  assert.ok(grid.geographicBounds.minLatitude < -69);
});

test('ordinary non-dateline geographic interpolation still works', () => {
  const grid = geographicGrid([
    { x: 30, y: -65, value: 1 },
    { x: 31, y: -65, value: 2 },
    { x: 30, y: -66, value: 3 },
    { x: 31, y: -66, value: 4 },
  ]);
  assert.ok(grid.cells.length > 0);
  assert.ok(Math.abs(grid.geographicBounds.longitudeSpan - 1) < 1e-9);
  assert.ok(grid.cells.every((cell) => cell.lon >= 29.9 && cell.lon <= 31.1));
});

test('numeric cast timestamps sort curtain casts chronologically', () => {
  const later = stationDataset({ id: 'later', lat: -65, lon: 32, startTime: 1704103200 });
  const earlier = stationDataset({ id: 'earlier', lat: -65, lon: 30, startTime: 1704067200 });
  const merged = mergeCompatibleDatasets([later, earlier]);
  const section = curtainMeasurements(merged, 'field_temp');
  assert.deepEqual(section.track.map((entry) => entry.cast.sourceContentId), ['earlier', 'later']);
  assert.equal(section.orderMode, 'chronological');
  assert.equal(section.warning, null);
});

test('ISO and common CNV date strings are parsed and sorted chronologically', () => {
  assert.ok(castTime({ startTime: 'Jan 12 2026 10:42:13' }) < castTime({ startTime: '2026-01-12T11:42:13Z' }));
  const later = stationDataset({ id: 'later', lat: -65, lon: 32, startTime: '2026-01-12T11:42:13Z' });
  const earlier = stationDataset({ id: 'earlier', lat: -65, lon: 30, startTime: 'Jan 12 2026 10:42:13' });
  const section = curtainMeasurements(mergeCompatibleDatasets([later, earlier]), 'field_temp');
  assert.deepEqual(section.track.map((entry) => entry.cast.sourceContentId), ['earlier', 'later']);
  assert.equal(section.orderMode, 'chronological');
});

test('missing cast times preserve deterministic selected-source order and expose warning', () => {
  const secondSelected = stationDataset({ id: 'second-selected', lat: -65, lon: 32 });
  const firstSelected = stationDataset({ id: 'first-selected', lat: -65, lon: 30 });
  const section = curtainMeasurements(mergeCompatibleDatasets([secondSelected, firstSelected]), 'field_temp');
  assert.deepEqual(section.track.map((entry) => entry.cast.sourceContentId), ['second-selected', 'first-selected']);
  assert.equal(section.orderMode, 'source-order');
  assert.match(section.warning, /source order/i);
});

test('aggregate merge size over the centralized limit is rejected before downloads', () => {
  const mib = 1024 * 1024;
  const result = assessV4AggregateMerge(Array.from({ length: 4 }, (_, index) => ({ fileName: `${index}.csv`, fileSize: 100 * mib, local: false })));
  assert.equal(result.allowed, false);
  assert.equal(result.totalBytes, 400 * mib);
  assert.equal(result.networkBytes, 400 * mib);
  assert.equal(result.limit, V4_AGGREGATE_MERGE_LIMIT);
});

test('aggregate merge size below the limit is allowed', () => {
  const mib = 1024 * 1024;
  const result = assessV4AggregateMerge([
    { fileName: 'primary.csv', fileSize: 50 * mib, local: true },
    { fileName: 'station2.csv', fileSize: 50 * mib, local: false },
    { fileName: 'station3.csv', fileSize: 50 * mib, local: false },
  ]);
  assert.equal(result.allowed, true);
  assert.equal(result.totalBytes, 150 * mib);
  assert.equal(result.networkBytes, 100 * mib);
});

test('cancelling a merge invalidates the active generation', () => {
  const lifecycle = createLoadLifecycle();
  const first = lifecycle.start();
  let committed = false;
  lifecycle.cancel();
  assert.equal(first.signal.aborted, true);
  assert.equal(commitIfCurrent(first, () => { committed = true; }), false);
  assert.equal(committed, false);
});

test('cancelled merge generation cannot overwrite a later retry generation', () => {
  const lifecycle = createLoadLifecycle();
  const oldLoad = lifecycle.start();
  lifecycle.cancel();
  const retry = lifecycle.start();
  let state = 'primary';
  commitIfCurrent(oldLoad, () => { state = 'stale-merged'; });
  commitIfCurrent(retry, () => { state = 'retry-merged'; });
  assert.equal(state, 'retry-merged');
  assert.ok(retry.generation > oldLoad.generation);
});

test('merged dataset information reports merged rows, casts, sources and merged variable statistics', () => {
  const merged = mergeCompatibleDatasets([
    stationDataset({ id: 'a', lat: -65, lon: 30, offset: 0 }),
    stationDataset({ id: 'b', lat: -66, lon: 31, offset: 10 }),
  ]);
  const info = describeV4Dataset(merged, 'field_temp');
  assert.equal(info.sourceCount, 2);
  assert.equal(info.rowCount, 8);
  assert.equal(info.castCount, 2);
  assert.deepEqual(info.sourceFileNames, ['station-a.cnv', 'station-b.cnv']);
  assert.equal(info.variableStatistics.count, 8);
  assert.equal(info.variableStatistics.min, 1);
  assert.equal(info.variableStatistics.max, 14);
  assert.ok(info.provenance.some((entry) => entry.operation === 'compatible-dataset-concatenation'));
});


test('V4.1 VizPage preflights aggregate size before full merge downloads and exposes Cancel merge', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const rail = await readFile(new URL('../ui/DatasetRail.jsx', import.meta.url), 'utf8');
  const preflightIndex = page.indexOf('assessV4AggregateMerge([');
  const loadIndex = page.indexOf('loaded.push(await loadPreparedMergeDataset');
  assert.ok(preflightIndex >= 0 && loadIndex > preflightIndex, 'aggregate preflight must occur before full merge loads');
  assert.match(rail, /Cancel merge/);
  assert.match(page, /mergeLifecycleRef\.current\.cancel\(\)/);
  assert.match(page, /const\s+targets\s*=\s*mergeSelectedIds\.map/);
});

test('V4.1 V4 information panel switches to advanced/merged dataset for V4 views', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../ui/ScientificInfoPanel.jsx', import.meta.url), 'utf8');
  assert.match(page, /const\s+infoDataset\s*=.*advancedViewActive\s*\?\s*advancedDataset\s*:/);
  assert.match(page, /ScientificInfoPanel dataset=\{infoDataset\}/);
  assert.match(panel, /Datasets/);
  assert.match(panel, /Casts/);
});

test('V4.1 keeps IndexedDB DB_VERSION at 6', () => {
  assert.equal(DB_VERSION, 6);
});
