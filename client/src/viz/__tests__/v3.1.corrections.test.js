import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import {
  legacyOfflineDatasetFingerprint,
  resolveOfflineDatasetFingerprint,
  stableSavedDatasetFingerprint,
} from '../../offline/datasetFingerprint.js';
import { createLoadLifecycle, commitIfCurrent } from '../loadLifecycle.js';
import { castMapPoints } from '../mapPoints.js';
import { boundedScatterSample, minMaxDownsample } from '../sampling.js';
import { resolveDatasetSelection } from '../selection.js';

test('V3.1 direct dataset query becomes resolvable after the dataset list arrives', () => {
  assert.equal(resolveDatasetSelection([], 'csv-2').selectedId, '');
  const datasets = [
    { id: 'csv-1', originalFileName: 'first.csv' },
    { id: 'csv-2', originalFileName: 'requested.csv' },
  ];
  const resolved = resolveDatasetSelection(datasets, 'csv-2');
  assert.equal(resolved.selectedId, 'csv-2');
  assert.equal(resolved.reason, 'requested');
  assert.equal(resolved.supported, true);
});

test('V3.1 no-query selection skips unsupported first dataset in favor of supported data', () => {
  const datasets = [
    { id: 'zip-1', originalFileName: 'bundle.zip' },
    { id: 'csv-1', originalFileName: 'observations.csv' },
  ];
  const resolved = resolveDatasetSelection(datasets, '');
  assert.equal(resolved.selectedId, 'csv-1');
  assert.equal(resolved.reason, 'first-supported');

  const explicitUnsupported = resolveDatasetSelection(datasets, 'zip-1');
  assert.equal(explicitUnsupported.selectedId, 'zip-1');
  assert.equal(explicitUnsupported.supported, false);
});

test('V3.1 invalid query safely falls back to the first supported dataset', () => {
  const datasets = [
    { id: 'zip-1', originalFileName: 'bundle.zip' },
    { id: 'json-1', originalFileName: 'records.json' },
  ];
  const resolved = resolveDatasetSelection(datasets, 'missing-id');
  assert.equal(resolved.selectedId, 'json-1');
});

test('V3.1 map cast point generation rejects missing coordinates and preserves genuine zero', () => {
  const points = castMapPoints([
    { id: 'valid', latitude: -66.5, longitude: 38.2 },
    { id: 'missing-null', latitude: null, longitude: null },
    { id: 'missing-empty', latitude: '', longitude: '' },
    { id: 'zero', latitude: 0, longitude: 0 },
  ]);
  assert.deepEqual(points, [
    { lat: -66.5, lon: 38.2, value: null, count: 1, castId: 'valid' },
    { lat: 0, lon: 0, value: null, count: 1, castId: 'zero' },
  ]);
});

test('V3.1 scatter sampling stays bounded with one million observations', () => {
  const count = 1_000_000;
  const x = Float64Array.from({ length: count }, (_, i) => i);
  const y = Float64Array.from({ length: count }, (_, i) => Math.sin(i / 500));
  const sample = boundedScatterSample(x, y, 5000);
  assert.equal(sample.length, 5000);
  assert.equal(sample[0].x, 0);
  assert.equal(sample.at(-1).x, count - 1);
});

test('V3.1 million-point time/profile reduction is bounded, X ordered and preserves extrema', () => {
  const count = 1_000_000;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = count - 1 - i; // deliberately reverse chronological/source order
    y[i] = Math.sin(i / 1000);
  }
  y[123456] = 12345;
  y[765432] = -9876;

  const sample = minMaxDownsample(x, y, 4000);
  assert.ok(sample.length <= 4000);
  assert.ok(sample.some((point) => point.y === 12345));
  assert.ok(sample.some((point) => point.y === -9876));
  for (let i = 1; i < sample.length; i += 1) {
    assert.ok(sample[i - 1].x <= sample[i].x, `X order broke at ${i}`);
  }
});

test('V3.1 sampler implementation does not create an unbounded full valid-point object array', async () => {
  const source = await readFile(new URL('../sampling.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /const\s+valid\s*=\s*\[\]/);
  assert.doesNotMatch(source, /valid\.push\s*\(\s*\{\s*x\s*,\s*y/);
});

test('V3.1 stale/aborted load cannot commit over the current load', () => {
  const lifecycle = createLoadLifecycle();
  const first = lifecycle.start();
  let state = 'initial';
  const second = lifecycle.start();

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  assert.equal(commitIfCurrent(first, () => { state = 'dataset-a'; }), false);
  assert.equal(state, 'initial');
  assert.equal(commitIfCurrent(second, () => { state = 'dataset-b'; }), true);
  assert.equal(state, 'dataset-b');

  lifecycle.cancel();
  assert.equal(second.isCurrent(), false);
});


test('V3.1 load path threads one AbortSignal through full download, preview and worker parsing', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const preview = await readFile(new URL('../preview.js', import.meta.url), 'utf8');
  assert.match(page, /fetchDataset\(target\.id,\s*\{\s*signal:\s*load\.signal\s*\}\)/);
  assert.match(page, /getDatasetPreview\(target\.id,\s*\{\s*signal:\s*load\.signal\s*\}\)/);
  assert.match(page, /signal:\s*load\.signal/);
  assert.match(preview, /fetchDatasetRange\(contentId,\s*\{\s*start:\s*0,\s*end,\s*signal\s*\}\)/);
});

test('V3.1 stable online fingerprint is the value persisted/reused offline', () => {
  const item = { id: 'dataset-1', updatedAt: '2026-09-25T00:00:00Z' };
  const download = { datasetFingerprint: 'sha256:authoritative-file-version' };
  const persisted = stableSavedDatasetFingerprint(item, download);
  assert.equal(persisted, 'sha256:authoritative-file-version');

  const saved = { ...item, datasetFingerprint: persisted, offlineFile: { blob: { size: 42 } } };
  assert.equal(resolveOfflineDatasetFingerprint(saved, item), 'sha256:authoritative-file-version');
});

test('V3.1 legacy offline records without fingerprint retain synthetic fallback compatibility', () => {
  const saved = { id: 'dataset-legacy', updatedAt: '2026-09-20T00:00:00Z', offlineFile: { blob: { size: 1234 } } };
  const expected = legacyOfflineDatasetFingerprint(saved, saved);
  assert.match(expected, /^offline:dataset-legacy:/);
  assert.equal(resolveOfflineDatasetFingerprint(saved, saved), expected);
});

test('V3.1 Save Offline source persists the secure-download dataset fingerprint', async () => {
  const source = await readFile(new URL('../../offline/savedExpeditions.js', import.meta.url), 'utf8');
  assert.match(source, /datasetFingerprint\s*=\s*stableSavedDatasetFingerprint\(item,\s*download\)/);
  assert.match(source, /item\.type\s*===\s*'dataset'\s*&&\s*datasetFingerprint/);
});

test('V3.1 keeps IndexedDB DB_VERSION at 6', () => {
  assert.equal(DB_VERSION, 6);
});
