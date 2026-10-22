import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DB_VERSION } from '../../offline/constants.js';
import {
  WORKBENCH_VIEW_GROUPS,
  contextualControlModel,
  dataQualityModel,
  datasetStatusModel,
  networkStatusModel,
  nextPanelState,
  sourceSummaryModel,
} from '../ui/workbenchModel.js';

test('V8 dataset rail distinguishes selected preview/offline/unsupported states', () => {
  assert.equal(datasetStatusModel({ selected: true, supported: true, status: 'ready', sourceMode: 'preview' }).label, 'Preview');
  assert.equal(datasetStatusModel({ selected: true, supported: true, status: 'ready', sourceMode: 'offline' }).label, 'Offline');
  assert.equal(datasetStatusModel({ selected: false, supported: false }).label, 'Not visualizable');
});

test('V8 mode bar keeps every approved view grouped without changing capability rules', () => {
  const keys = WORKBENCH_VIEW_GROUPS.flatMap((group) => group.views);
  for (const expected of ['map', 'profile', 'timeSeries', 'curtain', 'depthSlice', 'surfaceMap', 'vectorField', 'surface3D', 'curtain3D', 'volume3D', 'isosurface', 'vector3D', 'histogram', 'scatter', 'table']) {
    assert.ok(keys.includes(expected), `${expected} should remain discoverable in the workstation mode bar`);
  }
  assert.equal(new Set(keys).size, keys.length, 'view keys should not be duplicated across groups');
});

test('V8 data-quality model preserves measured/interpolated distinction', () => {
  const variable = { statistics: { count: 980, missingCount: 20 } };
  const quality = dataQualityModel({ dataset: {}, variable, view: 'surfaceMap' });
  assert.equal(quality.measured, true);
  assert.equal(quality.interpolated, true);
  assert.equal(quality.missingPercent, 2);
  assert.equal(dataQualityModel({ dataset: {}, variable, view: 'table' }).interpolated, false);
});

test('V8 merged-source information uses active merged dataset counts', () => {
  const summary = sourceSummaryModel({ rowCount: 18420, casts: [{}, {}, {}, {}], sourceDatasets: [{ fileName: 'a.cnv' }, { fileName: 'b.cnv' }, { fileName: 'c.cnv' }, { fileName: 'd.cnv' }] });
  assert.equal(summary.sourceCount, 4);
  assert.equal(summary.rowCount, 18420);
  assert.equal(summary.castCount, 4);
  assert.deepEqual(summary.sourceNames, ['a.cnv', 'b.cnv', 'c.cnv', 'd.cnv']);
});

test('V8 low-bandwidth/offline notices are additive presentation only', () => {
  assert.deepEqual(networkStatusModel({ isOffline: false, isSlow: true, sourceMode: 'preview' }).map((item) => item.label), ['Online', 'Low Bandwidth', 'Preview Mode']);
  assert.deepEqual(networkStatusModel({ isOffline: true, isSlow: false, sourceMode: 'offline' }).map((item) => item.label), ['Offline', 'Saved Offline']);
});

test('V8 contextual controls show only controls relevant to the active mode', () => {
  const scatter = contextualControlModel({ view: 'scatter', hasVariables: true, isNetcdf: true, hasTime: true, hasDepth: true });
  assert.equal(scatter.variable, true);
  assert.equal(scatter.secondaryVariable, true);
  assert.equal(scatter.time, false);
  const volume = contextualControlModel({ view: 'volume3D', hasVariables: true, isNetcdf: true, hasTime: true, hasDepth: true });
  assert.equal(volume.variable, true);
  assert.equal(volume.time, true);
  assert.equal(volume.depth, false);
  assert.equal(volume.camera, true);
});

test('V8 panel collapsing is local presentation state', () => {
  const initial = { leftCollapsed: false, rightCollapsed: false };
  assert.deepEqual(nextPanelState(initial, 'left'), { leftCollapsed: true, rightCollapsed: false });
  assert.deepEqual(nextPanelState(initial, 'right'), { leftCollapsed: false, rightCollapsed: true });
});

test('V8 DB_VERSION remains 6', () => assert.equal(DB_VERSION, 6));


test('V8 workstation keeps fullscreen/drawers and warning expansion in presentation components', async () => {
  const workbench = await readFile(new URL('../ui/VizWorkbench.jsx', import.meta.url), 'utf8');
  const info = await readFile(new URL('../ui/ScientificInfoPanel.jsx', import.meta.url), 'utf8');
  assert.match(workbench, /requestFullscreen/);
  assert.match(workbench, /MobileVizDrawer/);
  assert.match(info, /setWarningsOpen/);
  assert.match(info, /Scientific Warnings/);
});

test('V8 performs the approved V6.1 volumeTransform reuse cleanup without changing output', async () => {
  const renderer = await readFile(new URL('../components/V6Renderers.jsx', import.meta.url), 'utf8');
  assert.match(renderer, /view === 'isosurface'\) \{ const transform = volumeTransform\(product\); addMeasuredPoints/);
  assert.doesNotMatch(renderer, /\(point\) => volumeTransform\(product\)\.normalize/);
});


test('V8 preview workstation preserves explicit full-download action under low-bandwidth safeguards', async () => {
  const viewport = await readFile(new URL('../ui/VisualizationViewport.jsx', import.meta.url), 'utf8');
  assert.match(viewport, /Preview is active/);
  assert.match(viewport, /Download & Visualize/);
  assert.match(viewport, /canFullLoad &&/);
});
