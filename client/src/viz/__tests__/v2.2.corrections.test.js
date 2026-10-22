import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import {
  collectPairedXY,
  pairedLatLonCount,
  pairedXYZCount,
  validCastPositions,
} from '../spatialEvidence.js';
import { readCnv } from '../readers/cnv.js';
import { DB_VERSION } from '../../offline/constants.js';

async function cnvCapabilities(source, name = 'fixture.cnv') {
  const data = await readCnv(source, {
    fileName: name,
    contentId: `v22-${name}`,
    datasetFingerprint: `sha256:v22-${name}`,
  });
  const detection = detectDatasetMapping(data);
  const normalized = normalizeScientificDataset(data, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  return { data, detection, normalized, capabilities: evaluateCapabilities(normalized) };
}

test('V2.2 CNV with valid header coordinates enables Map from cast coordinates', async () => {
  const source = await readFile(new URL('./fixtures/basic.cnv', import.meta.url), 'utf8');
  const { capabilities } = await cnvCapabilities(source, 'basic.cnv');
  assert.equal(capabilities.map.enabled, true);
  assert.equal(capabilities.map.positionSource, 'cast-coordinates');
});

test('V2.2 CNV without header coordinates does not enable Map', async () => {
  const source = `* Sea-Bird SBE test\n# bad_flag = -9.990e-29\n# name 0 = prDM: Pressure [db]\n# name 1 = t090C: Temperature [deg C]\n# name 2 = sal00: Salinity [PSU]\n*END*\n0.0 -1.20 34.80\n10.0 -1.35 34.85\n20.0 -1.50 34.90\n`;
  const { normalized, capabilities } = await cnvCapabilities(source, 'no-coordinates.cnv');
  assert.equal(normalized.casts.length, 1);
  assert.equal(normalized.casts[0].latitude, null);
  assert.equal(normalized.casts[0].longitude, null);
  assert.deepEqual(validCastPositions(normalized.casts), []);
  assert.equal(capabilities.map.enabled, false);
});

test('V2.2 validCastPositions rejects null coordinates', () => {
  assert.deepEqual(validCastPositions([{ latitude: null, longitude: null }]), []);
});

test('V2.2 validCastPositions rejects empty and whitespace-only coordinates', () => {
  assert.deepEqual(validCastPositions([{ latitude: '', longitude: '' }]), []);
  assert.deepEqual(validCastPositions([{ latitude: '   ', longitude: '\t' }]), []);
});

test('V2.2 validCastPositions preserves genuine numeric zero coordinates', () => {
  assert.deepEqual(
    validCastPositions([{ id: 'zero', latitude: 0, longitude: 0 }]),
    [{ latitude: 0, longitude: 0, castId: 'zero' }],
  );
});

test('V2.2 validCastPositions accepts numeric-string zero coordinates', () => {
  assert.deepEqual(
    validCastPositions([{ id: 'zero-string', latitude: '0', longitude: '0' }]),
    [{ latitude: 0, longitude: 0, castId: 'zero-string' }],
  );
});

test('V2.2 pairedLatLonCount ignores null, blank, non-finite and missing values', () => {
  assert.equal(
    pairedLatLonCount(
      [null, '', '   ', Number.NaN, Infinity, -Infinity, undefined, 0, '0', 12.5],
      [0, 0, 0, 0, 0, 0, 0, 0, '0', null],
    ),
    2,
  );
});

test('V2.2 pairedXYZCount and collectPairedXY inherit missing-coordinate handling', () => {
  assert.equal(
    pairedXYZCount([null, 0, '0', ''], [0, 0, '0', 0], [5, 10, 15, 20]),
    2,
  );
  assert.deepEqual(
    collectPairedXY([null, '', 0, '0'], [0, '', 0, '0']),
    [{ lat: 0, lon: 0 }],
  );
});

test('V2.2 non-finite cast coordinates remain invalid', () => {
  assert.deepEqual(validCastPositions([
    { latitude: Number.NaN, longitude: 0 },
    { latitude: Infinity, longitude: 0 },
    { latitude: 0, longitude: -Infinity },
  ]), []);
});

test('V2.2 keeps IndexedDB schema version at 6', () => {
  assert.equal(DB_VERSION, 6);
});
