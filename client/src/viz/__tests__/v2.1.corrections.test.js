import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalFromRows } from '../model.js';
import { detectDatasetMapping, parseUnitFromField } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities, pairedLatLonCount, pairedXYZCount } from '../capabilities.js';
import { readCnv } from '../readers/cnv.js';
import { DB_VERSION } from '../../offline/constants.js';

function dataset(headers, rows, options = {}) {
  return canonicalFromRows(headers, rows, {
    contentId: options.contentId || 'content-v21',
    datasetFingerprint: options.datasetFingerprint || 'sha256:v21',
    fileName: options.fileName || 'v21.csv',
  });
}

function ready(headers, rows) {
  const data = dataset(headers, rows);
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  return { data, detection, normalized, capabilities: evaluateCapabilities(normalized) };
}

test('V2.1 detects ISO string time automatically', () => {
  const data = dataset(['time', 'temperature'], [
    ['2026-01-01T00:00:00Z', 1],
    ['2026-01-01T00:01:00Z', 2],
    ['2026-01-01T00:02:00Z', 3],
  ]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.time, 'field_0');
  assert.equal(detection.needsMapping, false);
});

test('V2.1 detects Unix seconds by semantic name and plausible magnitude', () => {
  const data = dataset(['timestamp', 'temperature'], [[1704067200, 1], [1704067260, 2], [1704067320, 3]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.time, 'field_0');
  assert.equal(detection.needsMapping, false);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
  assert.equal(normalized.normalizedCoords.time[0], 1704067200000);
});

test('V2.1 detects Unix milliseconds by semantic name and plausible magnitude', () => {
  const data = dataset(['time', 'temperature'], [[1704067200000, 1], [1704067260000, 2], [1704067320000, 3]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.time, 'field_0');
  assert.equal(detection.needsMapping, false);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
  assert.equal(normalized.normalizedCoords.time[0], 1704067200000);
});

test('V2.1 ambiguous numeric time requires mapping confirmation', () => {
  const data = dataset(['time', 'temperature'], [[1, 10], [2, 11], [3, 12], [4, 13]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.time, null);
  assert.equal(detection.needsMapping, true);
  assert.ok(detection.ambiguousRoles.includes('time'));
});

test('V2.1 arbitrary numeric index is never silently classified as time', () => {
  const data = dataset(['index', 'temperature'], [[1704067200, 1], [1704067260, 2], [1704067320, 3]]);
  const detection = detectDatasetMapping(data);
  assert.equal(detection.mapping.roles.time, null);
  assert.equal(detection.ambiguousRoles.includes('time'), false);
});

test('V2.1 requires latitude and longitude on the same observations for map capability', () => {
  const { normalized, capabilities } = ready(
    ['lat', 'lon', 'temperature'],
    [[60, null, 1], [61, null, 2], [null, 10, 3], [null, 11, 4]],
  );
  assert.equal(pairedLatLonCount(normalized.normalizedCoords.lat, normalized.normalizedCoords.lon), 0);
  assert.equal(capabilities.map.enabled, false);
  assert.equal(capabilities.surfaceMap.enabled, false);
});

test('V2.1 paired XYZ helper counts only rows containing all three coordinates', () => {
  assert.equal(
    pairedXYZCount(
      new Float64Array([60, 61, Number.NaN, 63]),
      new Float64Array([10, Number.NaN, 12, 13]),
      new Float64Array([0, 10, 20, Number.NaN]),
    ),
    1,
  );
});

test('V2.1 keeps volume disabled for three casts', () => {
  const rows = [];
  for (let cast = 0; cast < 3; cast += 1) {
    for (let depth = 0; depth < 20; depth += 1) rows.push([60 + cast * 0.2, 10 + cast * 0.2, depth * 10, `S${cast}`, depth]);
  }
  const { capabilities } = ready(['lat', 'lon', 'depth', 'station', 'temperature'], rows);
  assert.equal(capabilities.volume.enabled, false);
});

test('V2.1 keeps volume disabled for four collinear CTD casts while curtain may remain enabled', () => {
  const rows = [];
  for (let cast = 0; cast < 4; cast += 1) {
    const lat = 60 + cast * 0.2;
    const lon = 10 + cast * 0.2;
    for (let depth = 0; depth < 20; depth += 1) rows.push([lat, lon, depth * 10, `S${cast}`, depth]);
  }
  const { capabilities } = ready(['lat', 'lon', 'depth', 'station', 'temperature'], rows);
  assert.equal(capabilities.curtain.enabled, true);
  assert.equal(capabilities.volume.enabled, false);
  assert.equal(capabilities.volume.evidence.uniqueXY, 4);
  assert.equal(capabilities.volume.evidence.normalizedArea, 0);
});

test('V2.1 enables volume for a dense 4x4 XY grid with multiple depths', () => {
  const rows = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      for (let z = 0; z < 5; z += 1) rows.push([60 + y * 0.1, 10 + x * 0.1, z * 25, x + y + z]);
    }
  }
  const { capabilities } = ready(['lat', 'lon', 'depth', 'temperature'], rows);
  assert.equal(capabilities.volume.enabled, true);
  assert.equal(capabilities.volume.evidence.uniqueXY, 16);
  assert.ok(capabilities.volume.evidence.normalizedArea >= 0.9);
});

test('V2.1 metre suffix parsing is token/boundary aware', () => {
  assert.equal(parseUnitFromField({ originalName: 'beam' }).unit, null);
  assert.equal(parseUnitFromField({ originalName: 'rpm' }).unit, null);
  assert.equal(parseUnitFromField({ originalName: 'datum' }).unit, null);
  assert.equal(parseUnitFromField({ originalName: 'depth_m' }).unit, 'm');
  assert.equal(parseUnitFromField({ originalName: 'height_m' }).unit, 'm');
  assert.equal(parseUnitFromField({ originalName: 'Depth (m)' }).unit, 'm');
  assert.equal(parseUnitFromField({ originalName: 'Depth [m]' }).unit, 'm');
});

test('V2.1 CNV header cast coordinates enable map only as a cast position', async () => {
  const fixture = new URL('./fixtures/basic.cnv', import.meta.url);
  const source = await readFile(fixture, 'utf8');
  const data = await readCnv(source, { fileName: 'basic.cnv', contentId: 'cnv-v21', datasetFingerprint: 'sha256:cnv' });
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  const capabilities = evaluateCapabilities(normalized);

  assert.equal(normalized.casts.length, 1);
  assert.ok(Number.isFinite(normalized.casts[0].latitude));
  assert.ok(Number.isFinite(normalized.casts[0].longitude));
  assert.equal(capabilities.map.enabled, true);
  assert.equal(capabilities.map.positionSource, 'cast-coordinates');
  assert.equal(capabilities.surfaceMap.enabled, false);
  assert.equal(capabilities.volume.enabled, false);
});

test('V2.1 exposes only explicitly mapped scientific variables as visualVariables', () => {
  const data = dataset(
    ['lat', 'lon', 'depth', 'temperature', 'salinity'],
    [[60, 10, 0, 1, 34], [60.1, 10.1, 10, 2, 35], [60.2, 10.2, 20, 3, 36]],
  );
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  assert.deepEqual(
    normalized.visualVariables.map((variable) => variable.name),
    ['temperature', 'salinity'],
  );
  assert.equal(normalized.fields.length, 5);
  assert.equal(normalized.coords.lat, 'field_0');
  assert.equal(normalized.coords.lon, 'field_1');
  assert.equal(normalized.coords.depth, 'field_2');
});

test('V2.1 keeps IndexedDB schema version at 6', () => {
  assert.equal(DB_VERSION, 6);
});
