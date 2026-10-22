import test from 'node:test';
import assert from 'node:assert/strict';
import { DB_VERSION } from '../../offline/constants.js';
import { assessMergeCompatibility, mergeCompatibleDatasets } from '../v4Merge.js';
import {
  curtainMeasurements,
  depthSliceMeasurements,
  interpolateBoundedGrid,
  surfaceMeasurements,
} from '../v4Spatial.js';

function field(key, name, unit, values) {
  return {
    key,
    originalName: name,
    normalizedName: name,
    unit,
    type: 'number',
    values: Float64Array.from(values),
    statistics: { count: values.length, missingCount: 0, min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length },
  };
}

function stationDataset({ id, lat, lon, tempUnit = '°C', offset = 0 }) {
  const depth = [0, 100, 200, 300];
  const temperature = [1, 2, 3, 4].map((value) => value + offset);
  const salinity = [34, 34.2, 34.4, 34.6].map((value) => value + offset * 0.01);
  const temp = field('field_temp', 'Temperature', tempUnit, temperature);
  const sal = field('field_sal', 'Salinity', 'PSU', salinity);
  return {
    contentId: id,
    sourceId: `source:${id}`,
    fileName: `station-${id}.cnv`,
    datasetFingerprint: `sha256:${id}`,
    rowCount: depth.length,
    fields: [temp, sal],
    variables: [
      { fieldKey: temp.key, name: 'Temperature', originalName: 'Temperature', unit: tempUnit, type: 'numeric', statistics: temp.statistics },
      { fieldKey: sal.key, name: 'Salinity', originalName: 'Salinity', unit: 'PSU', type: 'numeric', statistics: sal.statistics },
    ],
    visualVariables: [
      { fieldKey: temp.key, name: 'Temperature', originalName: 'Temperature', unit: tempUnit, type: 'numeric', statistics: temp.statistics },
      { fieldKey: sal.key, name: 'Salinity', originalName: 'Salinity', unit: 'PSU', type: 'numeric', statistics: sal.statistics },
    ],
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
    mapping: { fields: { field_temp: 'variable', field_sal: 'variable' }, roles: { depth: 'depth' } },
    casts: [{ id: `cast-${id}`, rowStart: 0, rowEnd: 3, rowCount: 4, latitude: lat, longitude: lon, source: 'reader' }],
    warnings: [],
    provenance: [],
  };
}

test('compatible datasets require matching variable/unit sets', () => {
  const a = stationDataset({ id: 'a', lat: -65, lon: 30 });
  const b = stationDataset({ id: 'b', lat: -65, lon: 31 });
  assert.equal(assessMergeCompatibility(a, b).compatible, true);
  const fahrenheit = stationDataset({ id: 'c', lat: -66, lon: 31, tempUnit: '°F' });
  const result = assessMergeCompatibility(a, fahrenheit);
  assert.equal(result.compatible, false);
  assert.match(result.reasons.join(' '), /variable\/unit/i);
});

test('multi-file merge preserves rows, offsets casts and propagates cast coordinates', () => {
  const datasets = [
    stationDataset({ id: 'a', lat: -65, lon: 30 }),
    stationDataset({ id: 'b', lat: -65, lon: 31, offset: 1 }),
    stationDataset({ id: 'c', lat: -66, lon: 30, offset: 2 }),
    stationDataset({ id: 'd', lat: -66, lon: 31, offset: 3 }),
  ];
  const merged = mergeCompatibleDatasets(datasets);
  assert.equal(merged.rowCount, 16);
  assert.equal(merged.casts.length, 4);
  assert.equal(merged.casts[1].rowStart, 4);
  assert.equal(merged.casts[3].rowEnd, 15);
  assert.equal(merged.normalizedCoords.lat[0], -65);
  assert.equal(merged.normalizedCoords.lon[0], 30);
  assert.equal(merged.normalizedCoords.lat[15], -66);
  assert.equal(merged.normalizedCoords.lon[15], 31);
  assert.equal(merged.capabilities.curtain.enabled, true);
  assert.equal(merged.capabilities.depthSlice.enabled, true);
  assert.equal(merged.capabilities.surfaceMap.enabled, true);
  assert.equal(merged.capabilities.volume.enabled, false, 'four casts are still insufficient for a volume');
});

test('curtain measurements follow cumulative track distance and remain bounded per cast', () => {
  const merged = mergeCompatibleDatasets([
    stationDataset({ id: 'a', lat: -65, lon: 30 }),
    stationDataset({ id: 'b', lat: -65, lon: 31 }),
    stationDataset({ id: 'c', lat: -65, lon: 32 }),
  ]);
  const section = curtainMeasurements(merged, 'field_temp', { maxPerCast: 3 });
  assert.equal(section.track.length, 3);
  assert.ok(section.track[1].distanceKm > section.track[0].distanceKm);
  assert.ok(section.track[2].distanceKm > section.track[1].distanceKm);
  assert.ok(section.points.length <= 15);
  assert.ok(section.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.value)));
});

test('depth slice selects one nearby measured value per cast', () => {
  const merged = mergeCompatibleDatasets([
    stationDataset({ id: 'a', lat: -65, lon: 30 }),
    stationDataset({ id: 'b', lat: -65, lon: 31 }),
    stationDataset({ id: 'c', lat: -66, lon: 30 }),
    stationDataset({ id: 'd', lat: -66, lon: 31 }),
  ]);
  const points = depthSliceMeasurements(merged, 'field_temp', 100);
  assert.equal(points.length, 4);
  assert.ok(points.every((point) => point.depth === 100));
});

test('surface layer uses the shallowest measured value at each cast', () => {
  const merged = mergeCompatibleDatasets([
    stationDataset({ id: 'a', lat: -65, lon: 30 }),
    stationDataset({ id: 'b', lat: -65, lon: 31, offset: 5 }),
  ]);
  const points = surfaceMeasurements(merged, 'field_temp');
  assert.equal(points.length, 2);
  assert.ok(points.every((point) => point.vertical === 0));
  assert.deepEqual(points.map((point) => point.value), [1, 6]);
});

test('interpolation uses a bounded grid, preserves measured points and masks extrapolation', () => {
  const measured = [
    { x: 0, y: 0, value: 1 },
    { x: 1, y: 0, value: 2 },
    { x: 0, y: 1, value: 3 },
    { x: 1, y: 1, value: 4 },
  ];
  const grid = interpolateBoundedGrid(measured, { maxCells: 900 });
  assert.ok(grid.resolution.cells <= 900);
  assert.equal(grid.measured.length, 4);
  assert.ok(grid.cells.length > 0);
  assert.ok(grid.cells.every((cell) => cell.x >= 0 && cell.x <= 1 && cell.y >= 0 && cell.y <= 1));
  assert.ok(grid.cells.every((cell) => cell.confidence > 0 && cell.confidence <= 1));
});

test('collinear spatial points are not turned into an interpolated surface', () => {
  const line = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2, value: i }));
  const grid = interpolateBoundedGrid(line, { maxCells: 900 });
  assert.equal(grid.cells.length, 0);
});

test('V4 does not change the IndexedDB version', () => {
  assert.equal(DB_VERSION, 6);
});
