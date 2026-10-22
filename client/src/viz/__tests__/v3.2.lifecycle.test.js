import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLoadLifecycle, commitIfCurrent } from '../loadLifecycle.js';
import { canRestartVisualization, canUseRetryAction, retryMessage } from '../retryState.js';
import { DB_VERSION } from '../../offline/constants.js';

test('V3.2 cancelling invalidates the current generation and prevents stale commits', () => {
  const lifecycle = createLoadLifecycle();
  const cancelled = lifecycle.start();
  let committed = 'none';
  lifecycle.cancel();

  assert.equal(cancelled.signal.aborted, true);
  assert.equal(cancelled.isCurrent(), false);
  assert.equal(commitIfCurrent(cancelled, () => { committed = 'stale'; }), false);
  assert.equal(committed, 'none');
});

test('V3.2 cancelled state explicitly allows the same selected dataset to be loaded again', () => {
  assert.equal(canRestartVisualization('cancelled'), true);
  assert.equal(canUseRetryAction('cancelled', { isOffline: false }), true);
  assert.match(retryMessage('cancelled'), /cancelled/i);
});

test('V3.2 retry starts a fresh generation/controller', () => {
  const lifecycle = createLoadLifecycle();
  const first = lifecycle.start();
  const firstSignal = first.signal;
  lifecycle.cancel();
  const retry = lifecycle.start();

  assert.notEqual(retry.generation, first.generation);
  assert.ok(retry.generation > first.generation);
  assert.notEqual(retry.signal, firstSignal);
  assert.equal(firstSignal.aborted, true);
  assert.equal(retry.signal.aborted, false);
  assert.equal(retry.isCurrent(), true);
});

test('V3.2 an old cancelled generation cannot overwrite retry results', () => {
  const lifecycle = createLoadLifecycle();
  const first = lifecycle.start();
  lifecycle.cancel();
  const retry = lifecycle.start();
  let result = 'initial';

  assert.equal(commitIfCurrent(first, () => { result = 'old'; }), false);
  assert.equal(commitIfCurrent(retry, () => { result = 'retry'; }), true);
  assert.equal(result, 'retry');
});

test('V3.2 offline-blocked retry becomes available after reconnection without a dataset switch', () => {
  assert.equal(canRestartVisualization('offline-blocked'), true);
  assert.equal(canUseRetryAction('offline-blocked', { isOffline: true }), false);
  assert.equal(canUseRetryAction('offline-blocked', { isOffline: false }), true);
  assert.match(retryMessage('offline-blocked', { isOffline: false }), /connection restored/i);
});

test('V3.2 retry reuses normal non-forced load path so low-bandwidth/full-download safeguards remain authoritative', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /function\s+retrySelectedDataset\(\)[\s\S]*loadSelected\(false,\s*selected\)/);
  assert.match(page, /if\s*\(!forceFull\s*&&\s*\(network\.isSlow\s*\|\|\s*!fullAllowed\)\)/);
  assert.doesNotMatch(page, /function\s+retrySelectedDataset\(\)[\s\S]{0,500}loadSelected\(true,\s*selected\)/);
});

test('V3.2 same-dataset click can restart idle/error/cancelled state but not active/ready state', () => {
  for (const status of ['idle', 'error', 'cancelled', 'offline-blocked']) {
    assert.equal(canRestartVisualization(status), true, status);
  }
  for (const status of ['loading', 'mapping', 'ready', 'preview-only', 'blocked']) {
    assert.equal(canRestartVisualization(status), false, status);
  }
});

test('V3.2 VizPage uses a distinct cancelled and offline-blocked lifecycle state', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const viewport = await readFile(new URL('../ui/VisualizationViewport.jsx', import.meta.url), 'utf8');
  assert.match(page, /setStatus\('cancelled'\)/);
  assert.match(page, /setStatus\('offline-blocked'\)/);
  assert.match(viewport, /Retry visualization/);
  assert.match(viewport, /Load dataset/);
});

test('V3.2 keeps IndexedDB DB_VERSION at 6', () => {
  assert.equal(DB_VERSION, 6);
});
