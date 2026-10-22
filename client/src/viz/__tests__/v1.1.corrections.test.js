import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { parseCoordinateValue } from '../readers/cnv.js';
import { statisticsFromNumericValues } from '../statistics.js';

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function field(dataset, name) {
  return dataset.fields.find((item) => item.normalizedName === name || item.originalName === name);
}

function parseInWorker(source, fileName) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-node-wrapper.js', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker parse timed out.'));
    }, 30000);

    worker.on('message', (message) => {
      if (message?.id !== 'v11-large') return;
      if (message.type === 'complete') {
        clearTimeout(timeout);
        worker.terminate();
        resolve(message.dataset);
      } else if (message.type === 'error') {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(message.error));
      }
    });
    worker.on('error', (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(error);
    });
    worker.postMessage({
      type: 'start',
      id: 'v11-large',
      source,
      options: { fileName },
    });
  });
}

test('small-sample percentiles are exact for one value', () => {
  const stats = statisticsFromNumericValues([42]);
  assert.equal(stats.p2, 42);
  assert.equal(stats.p98, 42);
});

test('small-sample percentiles are exact for five values', () => {
  const stats = statisticsFromNumericValues([1, 2, 3, 4, 5]);
  closeTo(stats.p2, 1.08);
  closeTo(stats.p98, 4.92);
});

test('small-sample percentiles are exact for ten values', () => {
  const stats = statisticsFromNumericValues(Array.from({ length: 10 }, (_, index) => index + 1));
  closeTo(stats.p2, 1.18);
  closeTo(stats.p98, 9.82);
});

test('large samples continue to use the bounded P2 estimator', () => {
  const stats = statisticsFromNumericValues(Array.from({ length: 1000 }, (_, index) => index + 1));
  assert.equal(stats.count, 1000);
  closeTo(stats.p2, 20, 0.5);
  closeTo(stats.p98, 980, 0.5);
});

test('missing observations are excluded from exact percentile samples', () => {
  const stats = statisticsFromNumericValues([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3]);
  assert.equal(stats.count, 3);
  assert.equal(stats.missingCount, 2);
  closeTo(stats.p2, 1.04);
  closeTo(stats.p98, 2.96);
});

test('CNV coordinate parser accepts decimal degrees', () => {
  closeTo(parseCoordinateValue('-66.5', 'lat'), -66.5);
  closeTo(parseCoordinateValue('38.2', 'lon'), 38.2);
  closeTo(parseCoordinateValue('66.5S', 'lat'), -66.5);
  closeTo(parseCoordinateValue('38.2E', 'lon'), 38.2);
});

test('CNV coordinate parser accepts degrees/minutes with a space before hemisphere', () => {
  closeTo(parseCoordinateValue('66 30.000 S', 'lat'), -66.5);
  closeTo(parseCoordinateValue('038 12.000 W', 'lon'), -38.2);
});

test('CNV coordinate parser accepts degrees/minutes with attached hemisphere', () => {
  closeTo(parseCoordinateValue('66 30.000S', 'lat'), -66.5);
  closeTo(parseCoordinateValue('038 12.000W', 'lon'), -38.2);
});

test('CNV coordinate parser applies N, S, E and W signs', () => {
  closeTo(parseCoordinateValue('66 30.000N', 'lat'), 66.5);
  closeTo(parseCoordinateValue('66 30.000S', 'lat'), -66.5);
  closeTo(parseCoordinateValue('038 12.000E', 'lon'), 38.2);
  closeTo(parseCoordinateValue('038 12.000W', 'lon'), -38.2);
});

test('large generated CSV parses in the visualization worker with correct columnar output and statistics', async () => {
  const rowCount = 30000;
  const lines = new Array(rowCount + 1);
  lines[0] = 'station,value,doubled';
  for (let index = 1; index <= rowCount; index += 1) {
    lines[index] = `S${index},${index},${index * 2}`;
  }

  const dataset = await parseInWorker(lines.join('\n'), 'generated-large.csv');
  assert.equal(dataset.rowCount, rowCount);
  assert.deepEqual(dataset.fields.map((item) => item.normalizedName), ['station', 'value', 'doubled']);

  const value = field(dataset, 'value');
  const doubled = field(dataset, 'doubled');
  assert.ok(value.values instanceof Float64Array);
  assert.equal(value.values.length, rowCount);
  assert.equal(value.values[0], 1);
  assert.equal(value.values[rowCount - 1], rowCount);
  assert.equal(value.statistics.min, 1);
  assert.equal(value.statistics.max, rowCount);
  closeTo(value.statistics.mean, (rowCount + 1) / 2, 1e-8);
  assert.equal(doubled.statistics.min, 2);
  assert.equal(doubled.statistics.max, rowCount * 2);
  closeTo(doubled.statistics.mean, rowCount + 1, 1e-8);
});
