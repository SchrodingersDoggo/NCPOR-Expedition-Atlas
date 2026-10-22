import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { readDataset } from '../registry.js';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { evaluateCapabilities, normalizeVectorUnit } from '../capabilities.js';
import { netcdfDimensionControls } from '../netcdfSlice.js';
import { fullVisualizationLimit } from '../limits.js';
import { sampleValidVectors } from '../vectorSampling.js';

const NC_BYTE = 1;
const NC_CHAR = 2;
const NC_SHORT = 3;
const NC_INT = 4;
const NC_FLOAT = 5;
const NC_DOUBLE = 6;
const NC_DIMENSION = 10;
const NC_VARIABLE = 11;
const NC_ATTRIBUTE = 12;
const TYPE_BYTES = { [NC_BYTE]: 1, [NC_CHAR]: 1, [NC_SHORT]: 2, [NC_INT]: 4, [NC_FLOAT]: 4, [NC_DOUBLE]: 8 };
const DEFAULT_FILL = {
  [NC_BYTE]: -127,
  [NC_SHORT]: -32767,
  [NC_INT]: -2147483647,
  [NC_FLOAT]: 9.969209968386869e36,
  [NC_DOUBLE]: 9.969209968386869e36,
};

function pad4(value) { return (value + 3) & ~3; }
function product(values) { return values.reduce((out, value) => out * value, 1); }

class Writer {
  constructor() { this.bytes = []; }
  u8(value) { this.bytes.push(value & 255); }
  u32(value) { this.bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255); }
  u64(value) { const high = Math.floor(value / 4294967296); const low = value - high * 4294967296; this.u32(high); this.u32(low); }
  raw(array) { for (const value of array) this.bytes.push(value); }
  string(value) { const raw = new TextEncoder().encode(value); this.u32(raw.length); this.raw(raw); while (this.bytes.length % 4) this.u8(0); }
  number(type, value) {
    const buffer = new ArrayBuffer(TYPE_BYTES[type]); const view = new DataView(buffer);
    if (type === NC_BYTE) view.setInt8(0, value);
    else if (type === NC_SHORT) view.setInt16(0, value, false);
    else if (type === NC_INT) view.setInt32(0, value, false);
    else if (type === NC_FLOAT) view.setFloat32(0, value, false);
    else if (type === NC_DOUBLE) view.setFloat64(0, value, false);
    else throw new Error(`Unsupported numeric type ${type}`);
    this.raw(new Uint8Array(buffer));
  }
}

function attrSpec(raw) {
  if (typeof raw === 'string') return { type: NC_CHAR, values: raw };
  if (raw && typeof raw === 'object' && 'type' in raw) return { type: raw.type, values: Array.isArray(raw.value) ? raw.value : [raw.value] };
  return { type: NC_FLOAT, values: [raw] };
}

function writeAttributes(writer, attrs = {}) {
  const entries = Object.entries(attrs);
  if (!entries.length) { writer.u32(0); writer.u32(0); return; }
  writer.u32(NC_ATTRIBUTE); writer.u32(entries.length);
  for (const [name, raw] of entries) {
    writer.string(name);
    const spec = attrSpec(raw);
    writer.u32(spec.type);
    if (spec.type === NC_CHAR) {
      const bytes = new TextEncoder().encode(spec.values);
      writer.u32(bytes.length); writer.raw(bytes); while (writer.bytes.length % 4) writer.u8(0);
    } else {
      writer.u32(spec.values.length);
      for (const value of spec.values) writer.number(spec.type, value);
      while (writer.bytes.length % 4) writer.u8(0);
    }
  }
}

function variableLayout(definition, variable) {
  const shape = variable.dimensions.map((name) => {
    const dim = definition.dimensions.find((entry) => entry.name === name);
    return dim.unlimited ? definition.numRecords : dim.size;
  });
  const isRecord = Boolean(variable.dimensions.length && definition.dimensions.find((entry) => entry.name === variable.dimensions[0])?.unlimited);
  const valueCount = isRecord ? product(shape.slice(1)) : product(shape);
  return { shape, isRecord, valuesPerRecord: isRecord ? valueCount : null, vsize: pad4(valueCount * TYPE_BYTES[variable.type]) };
}

function writeHeader(definition, begins) {
  const writer = new Writer();
  writer.raw(new TextEncoder().encode('CDF')); writer.u8(definition.version || 1); writer.u32(definition.numRecords || 0);
  writer.u32(NC_DIMENSION); writer.u32(definition.dimensions.length);
  for (const dimension of definition.dimensions) { writer.string(dimension.name); writer.u32(dimension.unlimited ? 0 : dimension.size); }
  writeAttributes(writer, definition.globalAttributes || {});
  writer.u32(NC_VARIABLE); writer.u32(definition.variables.length);
  definition.variables.forEach((variable, index) => {
    writer.string(variable.name);
    writer.u32(variable.dimensions.length);
    for (const dimension of variable.dimensions) writer.u32(definition.dimensions.findIndex((entry) => entry.name === dimension));
    writeAttributes(writer, variable.attributes || {});
    writer.u32(variable.type);
    writer.u32(variableLayout(definition, variable).vsize);
    if ((definition.version || 1) === 1) writer.u32(begins?.[index] || 0);
    else writer.u64(begins?.[index] || 0);
  });
  return Uint8Array.from(writer.bytes);
}

function writeValue(view, offset, type, value) {
  if (type === NC_BYTE) view.setInt8(offset, value);
  else if (type === NC_SHORT) view.setInt16(offset, value, false);
  else if (type === NC_INT) view.setInt32(offset, value, false);
  else if (type === NC_FLOAT) view.setFloat32(offset, value, false);
  else if (type === NC_DOUBLE) view.setFloat64(offset, value, false);
}

function buildNetcdf(definition) {
  const normalized = { version: 1, numRecords: 0, globalAttributes: {}, ...definition };
  const draft = writeHeader(normalized, normalized.variables.map(() => 0));
  let cursor = pad4(draft.length);
  const begins = new Array(normalized.variables.length).fill(0);
  const layouts = normalized.variables.map((variable) => variableLayout(normalized, variable));

  normalized.variables.forEach((variable, index) => {
    if (layouts[index].isRecord) return;
    begins[index] = cursor;
    cursor += layouts[index].vsize;
  });
  const recordBase = cursor;
  let withinRecord = 0;
  normalized.variables.forEach((variable, index) => {
    if (!layouts[index].isRecord) return;
    begins[index] = recordBase + withinRecord;
    withinRecord += layouts[index].vsize;
  });
  const recordStride = withinRecord;
  const totalSize = recordBase + recordStride * normalized.numRecords;
  const header = writeHeader(normalized, begins);
  const out = new Uint8Array(Math.max(totalSize, pad4(header.length)));
  out.set(header, 0);
  const view = new DataView(out.buffer);

  normalized.variables.forEach((variable, index) => {
    const layout = layouts[index];
    const bytes = TYPE_BYTES[variable.type];
    if (!layout.isRecord) {
      variable.values.forEach((value, position) => writeValue(view, begins[index] + position * bytes, variable.type, value));
      return;
    }
    for (let record = 0; record < normalized.numRecords; record += 1) {
      const base = begins[index] + record * recordStride;
      for (let i = 0; i < layout.valuesPerRecord; i += 1) {
        writeValue(view, base + i * bytes, variable.type, variable.values[record * layout.valuesPerRecord + i]);
      }
    }
  });
  return new Blob([out], { type: 'application/x-netcdf' });
}

function oneDimVariable(name, values, { type = NC_SHORT, attributes = {}, dimension = 'x' } = {}) {
  return { name, type, dimensions: [dimension], attributes, values };
}

async function readFixture(definition, name = 'fixture.nc') {
  return readDataset(buildNetcdf(definition), { fileName: name, contentId: name, datasetFingerprint: `sha256:${name}` });
}

function field(dataset, name) { return dataset.fields.find((entry) => entry.originalName === name); }

const packedAttrs = {
  scale_factor: { type: NC_FLOAT, value: 0.1 },
  add_offset: { type: NC_FLOAT, value: -2 },
};

test('V5.1 decodes packed short values before statistics and preserves packing attributes', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'x', size: 4 }],
    variables: [oneDimVariable('temperature', [0, 10, 20, 30], { attributes: packedAttrs })],
  }, 'packed-short.nc');
  const temperature = field(dataset, 'temperature');
  assert.deepEqual(Array.from(temperature.values).map((v) => Number(v.toFixed(6))), [-2, -1, 0, 1]);
  assert.equal(temperature.statistics.min, -2);
  assert.ok(Math.abs(temperature.statistics.max - 1) < 1e-6);
  assert.ok(Math.abs(temperature.statistics.mean - (-0.5)) < 1e-6);
  assert.equal(Number(temperature.netcdfAttributes.scale_factor.toFixed(6)), 0.1);
  assert.ok(dataset.provenance.some((entry) => entry.operation === 'netcdf-scale-factor-add-offset-unpack'));
});



test('V5.1 packing applies across byte/short/int/float/double classic numeric types', async () => {
  const types = [NC_BYTE, NC_SHORT, NC_INT, NC_FLOAT, NC_DOUBLE];
  const variables = types.map((type, index) => ({
    name: `packed_${index}`,
    type,
    dimensions: ['x'],
    attributes: { scale_factor: { type: NC_DOUBLE, value: 2 }, add_offset: { type: NC_DOUBLE, value: 1 } },
    values: [1, 2, 3],
  }));
  const dataset = await readFixture({ dimensions: [{ name: 'x', size: 3 }], variables }, 'packed-types.nc');
  for (let i = 0; i < variables.length; i += 1) {
    assert.deepEqual(Array.from(field(dataset, `packed_${i}`).values), [3, 5, 7]);
  }
});

test('V5.1 packed time coordinates unpack before CF epoch conversion', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'time', size: 2 }],
    variables: [
      { name: 'time', type: NC_SHORT, dimensions: ['time'], attributes: {
        units: 'seconds since 2026-01-01T00:00:00Z',
        calendar: 'gregorian',
        scale_factor: { type: NC_INT, value: 3600 },
      }, values: [0, 1] },
      { name: 'temperature', type: NC_FLOAT, dimensions: ['time'], attributes: { units: 'degC' }, values: [1, 2] },
    ],
  }, 'packed-time.nc');
  const time = field(dataset, 'time');
  assert.equal(time.values[1] - time.values[0], 3600000);
});

test('V5.1 explicit _FillValue overrides the default fill and missing_value supports vectors', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'x', size: 5 }],
    variables: [oneDimVariable('temperature', [-32767, -9999, -999, -888, 10], {
      attributes: {
        _FillValue: { type: NC_SHORT, value: -9999 },
        missing_value: { type: NC_SHORT, value: [-999, -888] },
      },
    })],
  }, 'explicit-fill.nc');
  const values = Array.from(field(dataset, 'temperature').values);
  assert.equal(values[0], -32767, 'default fill must not apply when explicit _FillValue exists');
  assert.ok(Number.isNaN(values[1]));
  assert.ok(Number.isNaN(values[2]));
  assert.ok(Number.isNaN(values[3]));
  assert.equal(values[4], 10);
});

test('V5.1 recognizes NetCDF default fill values for byte/short/int/float/double', async () => {
  const variables = [NC_BYTE, NC_SHORT, NC_INT, NC_FLOAT, NC_DOUBLE].map((type, index) => ({
    name: `value_${index}`,
    type,
    dimensions: ['x'],
    attributes: {},
    values: [1, DEFAULT_FILL[type], 2],
  }));
  const dataset = await readFixture({ dimensions: [{ name: 'x', size: 3 }], variables }, 'default-fill.nc');
  for (let i = 0; i < variables.length; i += 1) {
    const values = field(dataset, `value_${i}`).values;
    assert.equal(values[0], 1);
    assert.ok(Number.isNaN(values[1]), `type ${variables[i].type} default fill should be missing`);
    assert.equal(values[2], 2);
  }
});

test('V5.1 applies valid_range in the raw packed domain before scale/offset', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'x', size: 4 }],
    variables: [oneDimVariable('temperature', [-1, 0, 50, 101], {
      attributes: {
        scale_factor: { type: NC_FLOAT, value: 0.1 },
        add_offset: { type: NC_FLOAT, value: 5 },
        valid_range: { type: NC_SHORT, value: [0, 100] },
      },
    })],
  }, 'valid-range.nc');
  const values = Array.from(field(dataset, 'temperature').values);
  assert.ok(Number.isNaN(values[0]));
  assert.equal(values[1], 5);
  assert.ok(Math.abs(values[2] - 10) < 1e-6);
  assert.ok(Number.isNaN(values[3]));
  assert.equal(field(dataset, 'temperature').statistics.min, 5);
  assert.ok(Math.abs(field(dataset, 'temperature').statistics.max - 10) < 1e-6);
});

test('V5.1 applies valid_min and valid_max before unpacking', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'x', size: 4 }],
    variables: [oneDimVariable('oxygen', [9, 10, 20, 21], {
      attributes: {
        scale_factor: { type: NC_FLOAT, value: 2 },
        valid_min: { type: NC_SHORT, value: 10 },
        valid_max: { type: NC_SHORT, value: 20 },
      },
    })],
  }, 'valid-minmax.nc');
  const values = Array.from(field(dataset, 'oxygen').values);
  assert.ok(Number.isNaN(values[0]));
  assert.equal(values[1], 20);
  assert.equal(values[2], 40);
  assert.ok(Number.isNaN(values[3]));
});

test('V5.1 packed coordinate variables are decoded before mapping and coordinate-level storage', async () => {
  const dataset = await readFixture({
    dimensions: [{ name: 'lat', size: 2 }, { name: 'lon', size: 2 }],
    variables: [
      { name: 'lat', type: NC_SHORT, dimensions: ['lat'], attributes: { units: 'degrees_north', scale_factor: { type: NC_FLOAT, value: 0.1 } }, values: [-700, -690] },
      { name: 'lon', type: NC_SHORT, dimensions: ['lon'], attributes: { units: 'degrees_east', scale_factor: { type: NC_FLOAT, value: 0.1 } }, values: [200, 210] },
      { name: 'temperature', type: NC_FLOAT, dimensions: ['lat', 'lon'], attributes: { units: 'degC' }, values: [1, 2, 3, 4] },
    ],
  }, 'packed-coords.nc');
  assert.deepEqual(dataset.sourceMeta.netcdf.coordinateLevels.lat.values.map((v) => Number(v.toFixed(4))), [-70, -69]);
  assert.deepEqual(dataset.sourceMeta.netcdf.coordinateLevels.lon.values.map((v) => Number(v.toFixed(4))), [20, 21]);
  const mapping = detectDatasetMapping(dataset);
  const normalized = normalizeScientificDataset(dataset, mapping.mapping, mapping);
  assert.ok(Math.abs(normalized.normalizedCoords.lat[0] - (-70)) < 1e-4);
  assert.ok(Math.abs(normalized.normalizedCoords.lon[0] - 20) < 1e-4);
});

function timeFixture(calendar = 'standard') {
  return {
    dimensions: [{ name: 'time', size: 2 }],
    variables: [
      { name: 'time', type: NC_SHORT, dimensions: ['time'], attributes: { units: 'days since 2026-01-01T00:00:00Z', calendar }, values: [0, 1] },
      { name: 'temperature', type: NC_FLOAT, dimensions: ['time'], attributes: { units: 'degC' }, values: [1, 2] },
    ],
  };
}

test('V5.1 standard/Gregorian-compatible CF time becomes epoch milliseconds', async () => {
  const dataset = await readFixture(timeFixture('standard'), 'standard-time.nc');
  const time = field(dataset, 'time');
  assert.equal(time.netcdfTime.normalized, true);
  assert.equal(time.values[1] - time.values[0], 86400000);
  const detection = detectDatasetMapping(dataset);
  const normalized = normalizeScientificDataset(dataset, detection.mapping, detection);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
  assert.equal(netcdfDimensionControls(normalized).timeLevels.length, 2);
});

for (const calendar of ['360_day', 'noleap']) {
  test(`V5.1 ${calendar} calendar remains numeric and is not faked as Gregorian time`, async () => {
    const dataset = await readFixture(timeFixture(calendar), `${calendar}.nc`);
    const time = field(dataset, 'time');
    assert.deepEqual(Array.from(time.values), [0, 1]);
    assert.equal(time.netcdfTime.normalized, false);
    assert.equal(time.netcdfTime.calendarSupported, false);
    assert.ok(dataset.warnings.some((warning) => warning.includes(calendar)));
    const detection = detectDatasetMapping(dataset);
    const timeField = field(dataset, 'time');
    const mapping = { ...detection.mapping, roles: { ...detection.mapping.roles, time: timeField.key }, fields: { ...detection.mapping.fields, [timeField.key]: 'ignore' } };
    const normalized = normalizeScientificDataset(dataset, mapping, detection);
    assert.equal(normalized.normalizedCoords.timeNormalized, false);
    const controls = netcdfDimensionControls(normalized);
    assert.equal(controls.timeSliderEnabled, false);
    assert.deepEqual(controls.timeLevels, []);
    assert.deepEqual(controls.timeCoordinateLevels, [0, 1]);
  });
}

test('V5.1 vector sampler scans valid pairs before bounded deterministic selection', () => {
  const length = 10000;
  const lat = new Float64Array(length); lat.fill(Number.NaN);
  const lon = new Float64Array(length); lon.fill(Number.NaN);
  const u = new Float64Array(length); u.fill(Number.NaN);
  const v = new Float64Array(length); v.fill(Number.NaN);
  for (const index of [123, 4567, 9876]) {
    lat[index] = -70 + index / 100000;
    lon[index] = 179;
    u[index] = 0.2;
    v[index] = -0.1;
  }
  const dataset = {
    normalizedCoords: { lat, lon },
    fields: [
      { key: 'u', values: u }, { key: 'v', values: v },
    ],
  };
  const sample = sampleValidVectors(dataset, { u: 'u', v: 'v' }, 2);
  assert.equal(sample.length, 2);
  assert.deepEqual(sample.map((entry) => entry.index), [123, 9876]);
});

test('V5.1 vector sampler remains bounded for one million observations', () => {
  const length = 1_000_000;
  const lat = new Float64Array(length);
  const lon = new Float64Array(length);
  const u = new Float64Array(length);
  const v = new Float64Array(length);
  for (let i = 0; i < length; i += 1) { lat[i] = -70; lon[i] = 20 + (i % 100) * 0.01; u[i] = i % 7; v[i] = i % 5; }
  const dataset = { normalizedCoords: { lat, lon }, fields: [{ key: 'u', values: u }, { key: 'v', values: v }] };
  const sample = sampleValidVectors(dataset, { u: 'u', v: 'v' }, 700);
  assert.equal(sample.length, 700);
});

test('V5.1 equivalent velocity spellings normalize together while different scales remain distinct', () => {
  assert.equal(normalizeVectorUnit('m/s'), 'm/s');
  assert.equal(normalizeVectorUnit('m s-1'), 'm/s');
  assert.equal(normalizeVectorUnit('m s^-1'), 'm/s');
  assert.equal(normalizeVectorUnit('m s⁻¹'), 'm/s');
  assert.equal(normalizeVectorUnit('cm/s'), 'cm/s');
  assert.notEqual(normalizeVectorUnit('m/s'), normalizeVectorUnit('cm/s'));

  const makeDataset = (uUnit, vUnit) => ({
    rowCount: 1,
    fields: [
      { key: 'u', originalName: 'u_east', normalizedName: 'u_east', unit: uUnit, type: 'number', values: new Float64Array([1]) },
      { key: 'v', originalName: 'v_north', normalizedName: 'v_north', unit: vUnit, type: 'number', values: new Float64Array([1]) },
    ],
    visualVariables: [{ fieldKey: 'u' }, { fieldKey: 'v' }],
    normalizedCoords: { lat: new Float64Array([-70]), lon: new Float64Array([20]), depth: null, pressure: null, time: null, timeNormalized: false },
    casts: [],
  });
  assert.equal(evaluateCapabilities(makeDataset('m/s', 'm s-1')).vectorField.enabled, true);
  assert.equal(evaluateCapabilities(makeDataset('m/s', 'cm/s')).vectorField.enabled, false);
});

test('V5.1 NetCDF sliders use all source coordinate levels rather than the 5000-value flattened fallback cap', () => {
  const timeValues = Array.from({ length: 6001 }, (_, index) => 1700000000000 + index * 1000);
  const depthValues = Array.from({ length: 6002 }, (_, index) => index * 0.5);
  const dataset = {
    coords: { time: 'time', depth: 'depth', pressure: null },
    normalizedCoords: { time: new Float64Array(6001), depth: new Float64Array(6002), timeNormalized: true },
    vertical: { kind: 'depth', fieldKey: 'depth', unit: 'm' },
    fields: [
      { key: 'time', unit: 'ms since 1970-01-01T00:00:00Z', netcdfTime: { normalized: true, calendarSupported: true }, values: new Float64Array(6001) },
      { key: 'depth', unit: 'm', values: new Float64Array(6002) },
    ],
    sourceMeta: { netcdf: { coordinateLevels: {
      time: { fieldKey: 'time', values: timeValues, timeNormalized: true, calendarSupported: true, calendar: 'standard' },
      depth: { fieldKey: 'depth', values: depthValues },
    } } },
  };
  const controls = netcdfDimensionControls(dataset);
  assert.equal(controls.timeLevels.length, 6001);
  assert.equal(controls.depthLevels.length, 6002);
  assert.equal(controls.timeLevels.at(-1), timeValues.at(-1));
  assert.equal(controls.depthLevels.at(-1), depthValues.at(-1));
});

test('V5.1 unlimited record dimension reads interleaved record variables correctly', async () => {
  const dataset = await readFixture({
    numRecords: 3,
    dimensions: [{ name: 'time', unlimited: true }],
    variables: [
      { name: 'time', type: NC_FLOAT, dimensions: ['time'], attributes: { units: 'seconds since 2026-01-01T00:00:00Z' }, values: [0, 60, 120] },
      { name: 'temperature', type: NC_FLOAT, dimensions: ['time'], attributes: { units: 'degC' }, values: [1, 2, 3] },
    ],
  }, 'record.nc');
  assert.equal(dataset.rowCount, 3);
  assert.deepEqual(Array.from(field(dataset, 'temperature').values), [1, 2, 3]);
  assert.equal(dataset.sourceMeta.netcdf.numRecords, 3);
});

test('V5.1 CDF-2 64-bit-offset fixture still reads correctly', async () => {
  const dataset = await readFixture({
    version: 2,
    dimensions: [{ name: 'x', size: 2 }],
    variables: [oneDimVariable('temperature', [1.5, 2.5], { type: NC_DOUBLE })],
  }, 'cdf2.nc');
  assert.equal(dataset.sourceMeta.netcdf.format, 'CDF-2 64-bit-offset');
  assert.deepEqual(Array.from(field(dataset, 'temperature').values), [1.5, 2.5]);
});

test('V5.1 keeps NetCDF browser limit and DB version unchanged', () => {
  assert.equal(fullVisualizationLimit('ocean.nc'), 25 * 1024 * 1024);
  assert.equal(DB_VERSION, 6);
});
