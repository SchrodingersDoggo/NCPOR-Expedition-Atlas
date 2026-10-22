import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readDataset } from '../registry.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
async function text(name) { return readFile(path.join(fixtures, name), 'utf8'); }
async function bytes(name) { return readFile(path.join(fixtures, name)); }

function field(dataset, name) {
  return dataset.fields.find((item) => item.normalizedName === name || item.originalName === name);
}

test('CSV reader produces canonical numeric fields', async () => {
  const dataset = await readDataset(await text('basic.csv'), { fileName: 'basic.csv', contentId: 'csv-1', datasetFingerprint: 'fp-1' });
  assert.equal(dataset.rowCount, 2);
  assert.equal(field(dataset, 'temp').type, 'number');
  assert.ok(field(dataset, 'temp').values instanceof Float64Array);
  assert.equal(field(dataset, 'temp').statistics.count, 2);
});

test('TSV reader uses tab delimiter', async () => {
  const dataset = await readDataset(await text('basic.tsv'), { fileName: 'basic.tsv' });
  assert.equal(dataset.rowCount, 2);
  assert.deepEqual(dataset.fields.map((item) => item.normalizedName), ['station', 'depth', 'temp']);
});

test('CSV reader skips instrument/preamble lines and detects the real header', async () => {
  const dataset = await readDataset(await text('junk-header.csv'), { fileName: 'junk-header.csv' });
  assert.equal(dataset.rowCount, 3);
  assert.equal(dataset.fields[0].normalizedName, 'Depth (m)');
  assert.ok(dataset.warnings.some((warning) => warning.includes('preamble')));
});

test('scientific notation parses and standard missing sentinels become NaN', async () => {
  const dataset = await readDataset(await text('scientific-notation.csv'), { fileName: 'scientific-notation.csv' });
  assert.equal(field(dataset, 'x').values[0], 0.001);
  assert.equal(field(dataset, 'y').values[2], 450);
  assert.equal(field(dataset, 'z').values[0], 5);
  assert.ok(Number.isNaN(field(dataset, 'z').values[1]));
  assert.equal(field(dataset, 'z').statistics.missingCount, 2);
  assert.ok(Number.isNaN(field(dataset, 'w').values[0]));
});

test('JSON array reader works', async () => {
  const dataset = await readDataset(await text('basic.json'), { fileName: 'basic.json' });
  assert.equal(dataset.rowCount, 2);
  assert.ok(field(dataset, 'lat'));
  assert.ok(field(dataset, 'temp'));
});

test('JSON flattens only one obvious object level', async () => {
  const dataset = await readDataset(await text('nested-one-level.json'), { fileName: 'nested-one-level.json' });
  assert.ok(field(dataset, 'position.lat'));
  assert.ok(field(dataset, 'position.lon'));
  assert.equal(dataset.sourceMeta.flattenDepth, 1);
});

test('XLSX reader selects a useful worksheet', async () => {
  const dataset = await readDataset(await bytes('basic.xlsx'), { fileName: 'basic.xlsx' });
  assert.equal(dataset.rowCount, 2);
  assert.equal(dataset.sourceMeta.xlsx.selectedSheet, 'Measurements');
});

test('multi-sheet XLSX avoids a notes-only sheet and suggests the useful sheet', async () => {
  const dataset = await readDataset(await bytes('multi-sheet.xlsx'), { fileName: 'multi-sheet.xlsx' });
  assert.equal(dataset.sourceMeta.xlsx.selectedSheet, 'CTD Data');
  assert.deepEqual(dataset.sourceMeta.xlsx.sheetNames, ['Notes', 'CTD Data']);
});

test('Sea-Bird CNV reader parses one cast, units, coordinates and bad_flag', async () => {
  const dataset = await readDataset(await text('basic.cnv'), { fileName: 'basic.cnv' });
  assert.equal(dataset.rowCount, 3);
  assert.equal(dataset.casts.length, 1);
  assert.ok(Math.abs(dataset.casts[0].latitude + 66.5) < 1e-9);
  assert.ok(Math.abs(dataset.casts[0].longitude - 38.2) < 1e-9);
  assert.equal(field(dataset, 'sal00').unit, 'PSU');
  assert.ok(Number.isNaN(field(dataset, 't090C').values[2]));
});

test('malformed JSON fails readably', async () => {
  await assert.rejects(
    async () => readDataset(await text('malformed.json'), { fileName: 'malformed.json' }),
    /Malformed JSON dataset/
  );
});

test('unsupported extension is rejected by the registry', async () => {
  await assert.rejects(
    () => readDataset('abc', { fileName: 'dataset.grib' }),
    (error) => error?.code === 'VIZ_UNSUPPORTED_FORMAT'
  );
});
