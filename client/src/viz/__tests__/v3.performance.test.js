import test from 'node:test';
import assert from 'node:assert/strict';
import { VIZ_LIMITS, canFullyVisualizeInBrowser, fullVisualizationLimit } from '../limits.js';
import { boundedScatterSample, minMaxDownsample, spatialAggregate, tablePage } from '../sampling.js';
import { histogramFromNumericValues } from '../statistics.js';
import { DB_VERSION } from '../../offline/constants.js';

test('V3 uses format-specific browser processing limits and keeps DB version 6', () => {
  assert.equal(DB_VERSION, 6);
  assert.equal(fullVisualizationLimit('a.csv'), 100 * 1024 * 1024);
  assert.equal(fullVisualizationLimit('a.cnv'), VIZ_LIMITS['.csv']);
  assert.equal(fullVisualizationLimit('a.xlsx'), 25 * 1024 * 1024);
  assert.equal(canFullyVisualizeInBrowser('a.csv', 10 * 1024 * 1024), true);
  assert.equal(canFullyVisualizeInBrowser('a.csv', 101 * 1024 * 1024), false);
  assert.equal(canFullyVisualizeInBrowser('a.csv', 0), false);
});

test('scatter sampling is bounded', () => {
  const x = Float64Array.from({ length: 50000 }, (_, i) => i);
  const y = Float64Array.from({ length: 50000 }, (_, i) => Math.sin(i / 50));
  const sample = boundedScatterSample(x, y, 2500);
  assert.equal(sample.length, 2500);
  assert.equal(sample[0].x, 0);
});

test('min/max downsampling retains large extrema', () => {
  const x = Float64Array.from({ length: 10000 }, (_, i) => i);
  const y = new Float64Array(10000);
  y.fill(1);
  y[5000] = 9999;
  y[5001] = -7777;
  const sample = minMaxDownsample(x, y, 400);
  assert.ok(sample.length <= 400);
  assert.ok(sample.some((point) => point.y === 9999));
  assert.ok(sample.some((point) => point.y === -7777));
});

test('spatial aggregation bounds huge observation sets', () => {
  const count = 100000;
  const lat = Float64Array.from({ length: count }, (_, i) => -80 + (i % 16000) / 100);
  const lon = Float64Array.from({ length: count }, (_, i) => -180 + (i % 36000) / 100);
  const value = Float64Array.from({ length: count }, (_, i) => i % 30);
  const aggregated = spatialAggregate(lat, lon, value, { maxCells: 1200 });
  assert.ok(aggregated.length > 0);
  assert.ok(aggregated.length <= 1200);
  assert.ok(aggregated.every((cell) => cell.count >= 1));
});

test('table pagination never materializes the complete dataset', () => {
  const values = Float64Array.from({ length: 10000 }, (_, i) => i);
  const dataset = { rowCount: 10000, fields: [{ key: 'field_0', type: 'number', values }] };
  const page = tablePage(dataset, 3, 100);
  assert.equal(page.rows.length, 100);
  assert.equal(page.start, 300);
  assert.equal(page.rows[0][0], 300);
});

test('histogram is a compact bin product rather than raw observations', () => {
  const values = Float64Array.from({ length: 10000 }, (_, i) => i);
  const histogram = histogramFromNumericValues(values, 30);
  assert.equal(histogram.count, 10000);
  assert.equal(histogram.bins.length, 30);
  assert.equal(histogram.bins.reduce((sum, bin) => sum + bin.count, 0), 10000);
});
