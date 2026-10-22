import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { canReadDataset, readDataset } from '../registry.js';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import { netcdfDimensionControls, sliceNetcdfDataset } from '../netcdfSlice.js';
import { fullVisualizationLimit } from '../limits.js';

const NC_DIMENSION = 10; const NC_VARIABLE = 11; const NC_ATTRIBUTE = 12; const NC_FLOAT = 5; const NC_CHAR = 2;
function pad4(n) { return (n + 3) & ~3; }
class Writer {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 255); }
  u32(v) { this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  f32(v) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, false); this.raw(new Uint8Array(b)); }
  raw(arr) { for (const b of arr) this.bytes.push(b); }
  string(value) { const raw = new TextEncoder().encode(value); this.u32(raw.length); this.raw(raw); while (this.bytes.length % 4) this.u8(0); }
  arrayBuffer() { return Uint8Array.from(this.bytes).buffer; }
}
function attrList(writer, attrs = {}) {
  const entries = Object.entries(attrs);
  if (!entries.length) { writer.u32(0); writer.u32(0); return; }
  writer.u32(NC_ATTRIBUTE); writer.u32(entries.length);
  for (const [name, value] of entries) {
    writer.string(name);
    if (typeof value === 'string') {
      const raw = new TextEncoder().encode(value); writer.u32(NC_CHAR); writer.u32(raw.length); writer.raw(raw); while (writer.bytes.length % 4) writer.u8(0);
    } else {
      writer.u32(NC_FLOAT); writer.u32(1); writer.f32(value); while (writer.bytes.length % 4) writer.u8(0);
    }
  }
}
function writeHeader(definition, begins = null) {
  const w = new Writer();
  w.raw(new TextEncoder().encode('CDF')); w.u8(1); w.u32(0);
  w.u32(NC_DIMENSION); w.u32(definition.dimensions.length);
  definition.dimensions.forEach((dim) => { w.string(dim.name); w.u32(dim.size); });
  attrList(w, {});
  w.u32(NC_VARIABLE); w.u32(definition.variables.length);
  definition.variables.forEach((variable, index) => {
    w.string(variable.name); w.u32(variable.dimensions.length); variable.dimensions.forEach((name) => w.u32(definition.dimensions.findIndex((dim) => dim.name === name)));
    attrList(w, variable.attributes || {}); w.u32(NC_FLOAT);
    const size = variable.values.length * 4; w.u32(pad4(size)); w.u32(begins?.[index] || 0);
  });
  return Uint8Array.from(w.bytes);
}
function buildNetcdf() {
  const dims = [
    { name: 'time', size: 2 }, { name: 'depth', size: 2 }, { name: 'lat', size: 2 }, { name: 'lon', size: 2 },
  ];
  const grid = [];
  for (let t = 0; t < 2; t += 1) for (let z = 0; z < 2; z += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) grid.push({ t, z, y, x });
  const vars = [
    { name: 'time', dimensions: ['time'], attributes: { units: 'seconds since 2026-01-01T00:00:00Z' }, values: [0, 3600] },
    { name: 'depth', dimensions: ['depth'], attributes: { units: 'm', positive: 'down' }, values: [0, 100] },
    { name: 'lat', dimensions: ['lat'], attributes: { units: 'degrees_north' }, values: [-70, -69] },
    { name: 'lon', dimensions: ['lon'], attributes: { units: 'degrees_east' }, values: [20, 21] },
    { name: 'temperature', dimensions: ['time', 'depth', 'lat', 'lon'], attributes: { units: 'degC', long_name: 'Sea temperature' }, values: grid.map(({ t, z, y, x }) => -1 + t + z * 0.2 + y * 0.1 + x * 0.05) },
    { name: 'u_east', dimensions: ['time', 'depth', 'lat', 'lon'], attributes: { units: 'm/s' }, values: grid.map(({ x }) => 0.2 + x * 0.1) },
    { name: 'v_north', dimensions: ['time', 'depth', 'lat', 'lon'], attributes: { units: 'm/s' }, values: grid.map(({ y }) => 0.1 + y * 0.1) },
  ];
  const definition = { dimensions: dims, variables: vars };
  const draft = writeHeader(definition);
  let offset = pad4(draft.length);
  const begins = vars.map((variable) => { const start = offset; offset += pad4(variable.values.length * 4); return start; });
  const header = writeHeader(definition, begins);
  const out = new Uint8Array(offset); out.set(header, 0);
  vars.forEach((variable, index) => {
    const view = new DataView(out.buffer); let cursor = begins[index];
    variable.values.forEach((value) => { view.setFloat32(cursor, value, false); cursor += 4; });
  });
  return new Blob([out], { type: 'application/x-netcdf' });
}

test('V5 registers NetCDF v3 with a conservative browser limit', () => {
  assert.equal(canReadDataset('ocean.nc'), true);
  assert.equal(fullVisualizationLimit('ocean.nc'), 25 * 1024 * 1024);
});

test('NetCDF v3 reader preserves dimensions, shapes and coordinate variables', async () => {
  const dataset = await readDataset(buildNetcdf(), { fileName: 'ocean.nc', contentId: 'nc-1', datasetFingerprint: 'sha256:nc' });
  assert.equal(dataset.rowCount, 16);
  assert.deepEqual(dataset.sourceMeta.netcdf.masterDimensions, ['time', 'depth', 'lat', 'lon']);
  assert.deepEqual(dataset.sourceMeta.netcdf.masterShape, [2, 2, 2, 2]);
  assert.equal(dataset.sourceMeta.netcdf.coordinateLevels.time.values.length, 2);
  assert.equal(dataset.fields.find((field) => field.originalName === 'temperature').shape.length, 4);
});

test('NetCDF CF time is normalized and V2 mapping/capabilities apply to the same canonical model', async () => {
  const canonical = await readDataset(buildNetcdf(), { fileName: 'ocean.nc', contentId: 'nc-1', datasetFingerprint: 'sha256:nc' });
  const detection = detectDatasetMapping(canonical);
  assert.equal(detection.needsMapping, false);
  const normalized = normalizeScientificDataset(canonical, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  normalized.capabilities = evaluateCapabilities(normalized);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
  assert.equal(normalized.vertical.kind, 'depth');
  assert.equal(normalized.capabilities.map.enabled, true);
  assert.equal(normalized.capabilities.vectorField.enabled, true);
  assert.deepEqual(normalized.capabilities.vectorField.pair, {
    u: normalized.fields.find((field) => field.originalName === 'u_east').key,
    v: normalized.fields.find((field) => field.originalName === 'v_north').key,
  });
});

test('V5 controls use actual NetCDF time/depth levels and slice the canonical dataset', async () => {
  const canonical = await readDataset(buildNetcdf(), { fileName: 'ocean.nc', contentId: 'nc-1', datasetFingerprint: 'sha256:nc' });
  const detection = detectDatasetMapping(canonical);
  const normalized = normalizeScientificDataset(canonical, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  normalized.capabilities = evaluateCapabilities(normalized);
  const controls = netcdfDimensionControls(normalized);
  assert.equal(controls.isNetcdf, true);
  assert.equal(controls.timeLevels.length, 2);
  assert.deepEqual(controls.depthLevels, [0, 100]);
  const sliced = sliceNetcdfDataset(normalized, { time: controls.timeLevels[1], depth: 100 });
  assert.equal(sliced.rowCount, 4);
  assert.equal(sliced.capabilities.map.enabled, true);
  assert.equal(sliced.capabilities.vectorField.enabled, true);
  assert.ok(Array.from(sliced.normalizedCoords.depth).every((value) => value === 100));
});

test('V5 does not change IndexedDB DB_VERSION', () => {
  assert.equal(DB_VERSION, 6);
});

test('V5 known vector pairs do not combine explicitly conflicting component units', async () => {
  const canonical = await readDataset(buildNetcdf(), { fileName: 'ocean.nc', contentId: 'nc-1', datasetFingerprint: 'sha256:nc' });
  const u = canonical.fields.find((field) => field.originalName === 'u_east');
  const v = canonical.fields.find((field) => field.originalName === 'v_north');
  u.unit = 'm/s'; v.unit = 'cm/s';
  const detection = detectDatasetMapping(canonical);
  const normalized = normalizeScientificDataset(canonical, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  const capabilities = evaluateCapabilities(normalized);
  assert.equal(capabilities.vectorField.enabled, false);
});

test('V5 classic NetCDF fixture remains readable after NetCDF-4 dispatch is added later', async () => {
  const dataset = await readDataset(buildNetcdf(), { fileName: 'classic.nc', contentId: 'classic-1', datasetFingerprint: 'sha256:classic' });
  assert.equal(dataset.sourceMeta.netcdf.version, 1);
  assert.equal(dataset.rowCount, 16);
});
