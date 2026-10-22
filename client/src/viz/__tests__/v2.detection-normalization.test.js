import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalFromRows } from '../model.js';
import { detectDatasetMapping, parseUnitFromField, validateMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import { buildVizMappingKey } from '../storageKeys.js';

function dataset(headers, rows, options = {}) {
  return canonicalFromRows(headers, rows, {
    contentId: options.contentId || 'content-1',
    datasetFingerprint: options.datasetFingerprint || 'sha256:abc',
    fileName: options.fileName || 'test.csv',
  });
}

test('V2 high-confidence coordinate detection uses names plus valid data', () => {
  const data = dataset(
    ['latitude', 'longitude', 'depth_m', 'timestamp', 'station', 'temperature [°C]'],
    [
      [66.1, 12.1, 5, '2026-01-01T00:00:00Z', 'A', -1.2],
      [66.1, 12.1, 10, '2026-01-01T00:01:00Z', 'A', -1.0],
      [67.0, 13.0, 5, '2026-01-02T00:00:00Z', 'B', -0.8],
    ],
  );
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.lat, 'field_0');
  assert.equal(detection.mapping.roles.lon, 'field_1');
  assert.equal(detection.mapping.roles.depth, 'field_2');
  assert.equal(detection.mapping.roles.time, 'field_3');
  assert.equal(detection.mapping.roles.station, 'field_4');
  assert.equal(detection.needsMapping, false);
  assert.equal(detection.classifications.field_5, 'numeric');
  assert.equal(detection.units.field_5.unit, '°C');
});

test('V2 does not trust coordinate names when latitude values are invalid', () => {
  const data = dataset(['latitude', 'temperature'], [[999, 1], [998, 2], [997, 3]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.lat, null);
});

test('V2 weak x/y coordinate names require confirmation rather than guessing', () => {
  const data = dataset(['x', 'y', 'temperature'], [[10, 60, 1], [11, 61, 2], [12, 62, 3]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.lat, null);
  assert.equal(detection.mapping.roles.lon, null);
  assert.equal(detection.needsMapping, true);
  assert.ok(detection.ambiguousRoles.includes('lat') || detection.ambiguousRoles.includes('lon'));
});

test('V2 unit parsing recognizes explicit and header units', () => {
  assert.deepEqual(parseUnitFromField({ unit: 'dbar', originalName: 'Pressure' }), { unit: 'dbar', source: 'metadata' });
  assert.deepEqual(parseUnitFromField({ originalName: 'Temperature [°C]' }), { unit: '°C', source: 'header-brackets' });
  assert.deepEqual(parseUnitFromField({ originalName: 'Depth (m)' }), { unit: 'm', source: 'header-parentheses' });
});

test('V2 normalization handles 0-360 longitude, negative depth and timestamps with warnings', () => {
  const data = dataset(
    ['lat', 'lon', 'depth', 'time', 'temperature'],
    [
      [66, 350, -5, '2026-01-01T00:00:00Z', 1],
      [66, 355, -10, '2026-01-01T00:01:00Z', 2],
      [66, 10, -15, '2026-01-01T00:02:00Z', 3],
    ],
  );
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  assert.deepEqual(Array.from(normalized.normalizedCoords.lon), [-10, -5, 10]);
  assert.deepEqual(Array.from(normalized.normalizedCoords.depth), [5, 10, 15]);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
  assert.ok(Number.isFinite(normalized.normalizedCoords.time[0]));
  assert.ok(normalized.warnings.some((warning) => warning.includes('0–360')));
  assert.ok(normalized.warnings.some((warning) => warning.includes('positive-down')));
});

test('V2 pressure remains pressure when no depth exists', () => {
  const data = dataset(['lat', 'lon', 'pressure', 'temperature'], [[60, 10, 10, 1], [60, 10, 20, 2]]);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  assert.equal(normalized.vertical.kind, 'pressure');
  assert.ok(normalized.warnings.some((warning) => warning.includes('no automatic pressure-to-depth conversion')));
});

test('V2 explicit station grouping takes priority and creates casts', () => {
  const data = dataset(
    ['lat', 'lon', 'depth', 'station', 'temperature'],
    [[60, 10, 0, 'A', 1], [60, 10, 10, 'A', 2], [61, 11, 0, 'B', 3], [61, 11, 10, 'B', 4]],
  );
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  const casts = groupDatasetCasts(normalized);
  assert.equal(casts.length, 2);
  assert.equal(casts[0].station, 'A');
  assert.equal(casts[1].station, 'B');
  assert.equal(casts[0].source, 'station-field');
});

test('V2 mapping validation rejects duplicate coordinate assignments', () => {
  const data = dataset(['lat', 'lon', 'temp'], [[1, 2, 3], [2, 3, 4]]);
  const mapping = detectDatasetMapping(data).mapping;
  mapping.roles.lon = mapping.roles.lat;
  const result = validateMapping(data, mapping);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('both')));
});

test('V2 mapping key changes when the dataset fingerprint changes', () => {
  const first = buildVizMappingKey({ ownerId: 'user-1', contentId: 'c1', datasetFingerprint: 'sha256:a' });
  const second = buildVizMappingKey({ ownerId: 'user-1', contentId: 'c1', datasetFingerprint: 'sha256:b' });
  assert.notEqual(first, second);
  assert.match(first, /c1/);
});

test('V2 refuses volumetric capability for a few CTD casts', () => {
  const rows = [];
  for (let cast = 0; cast < 3; cast += 1) {
    for (let depth = 0; depth < 20; depth += 1) rows.push([60 + cast, 10 + cast, depth * 10, `S${cast + 1}`, depth]);
  }
  const data = dataset(['lat', 'lon', 'depth', 'station', 'temperature'], rows);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  const capabilities = evaluateCapabilities(normalized);
  assert.equal(capabilities.profile.enabled, true);
  assert.equal(capabilities.curtain.enabled, true);
  assert.equal(capabilities.volume.enabled, false);
});

test('V2 enables volume only for demonstrated dense XYZ coverage', () => {
  const rows = [];
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      for (let z = 0; z < 4; z += 1) rows.push([60 + y * 0.1, 10 + x * 0.1, z * 10, x + y + z]);
    }
  }
  const data = dataset(['lat', 'lon', 'depth', 'temperature'], rows);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  const capabilities = evaluateCapabilities(normalized);
  assert.equal(capabilities.volume.enabled, true);
  assert.ok(capabilities.volume.evidence.occupancy >= 0.2);
});

test('V2 vector fields require a known U/V pair', () => {
  const data = dataset(['lat', 'lon', 'u_east', 'v_north'], [[60, 10, 1, 2], [61, 11, 2, 3], [62, 12, 3, 4]]);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = [];
  const capabilities = evaluateCapabilities(normalized);
  assert.equal(capabilities.vectorField.enabled, true);
  assert.deepEqual(capabilities.vectorField.pair, { u: 'field_2', v: 'field_3' });
});

test('V2 field classification distinguishes identifiers, categorical, numeric and ignored fields', () => {
  const rows = Array.from({ length: 100 }, (_, index) => [
    index + 1,
    index % 2 ? 'ice' : 'water',
    index * 0.5,
    index === 0 ? 'present' : null,
  ]);
  const data = dataset(['sample_id', 'type', 'temperature', 'mostly_missing'], rows);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.classifications.field_0, 'identifier');
  assert.equal(detection.classifications.field_1, 'categorical');
  assert.equal(detection.classifications.field_2, 'numeric');
  assert.equal(detection.classifications.field_3, 'ignored');
});

test('V2 cautiously infers casts only from near location plus time continuity', () => {
  const data = dataset(
    ['lat', 'lon', 'time', 'depth', 'temperature'],
    [
      [60.000, 10.000, '2026-01-01T00:00:00Z', 0, 1],
      [60.001, 10.001, '2026-01-01T00:01:00Z', 10, 2],
      [61.000, 11.000, '2026-01-02T00:00:00Z', 0, 3],
      [61.001, 11.001, '2026-01-02T00:01:00Z', 10, 4],
    ],
  );
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  const casts = groupDatasetCasts(normalized);
  assert.equal(casts.length, 2);
  assert.equal(casts[0].source, 'near-location+time-continuity');
  assert.equal(casts[0].inferred, true);
});

test('V2 recognizes vector pairs even when headers include units', () => {
  const data = dataset(['lat', 'lon', 'u_east [m/s]', 'v_north [m/s]'], [[60, 10, 1, 2], [61, 11, 2, 3], [62, 12, 3, 4]]);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = [];
  const capabilities = evaluateCapabilities(normalized);
  assert.equal(capabilities.vectorField.enabled, true);
});
