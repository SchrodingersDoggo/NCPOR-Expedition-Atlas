import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DB_VERSION } from '../../offline/constants.js';
import { readDataset } from '../registry.js';
import { findHdf5SignatureOffset } from '../readers/hdf5.js';
import { findHdf5SignatureInSource } from '../readers/netcdfAuto.js';

const H5 = Uint8Array.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
function attr(value) { return { value }; }

function inferMetadata(dtype, shape) {
  const code = String(dtype).replace(/^[<>=|]/, '');
  const map = {
    b: [0, 1, true], B: [0, 1, false],
    h: [0, 2, true], H: [0, 2, false],
    i: [0, 4, true], I: [0, 4, false],
    q: [0, 8, true], Q: [0, 8, false],
    f: [1, 4, true], d: [1, 8, true],
    u1: [0, 1, false], u2: [0, 2, false], u4: [0, 4, false], u8: [0, 8, false],
    i1: [0, 1, true], i2: [0, 2, true], i4: [0, 4, true], i8: [0, 8, true],
    f4: [1, 4, true], f8: [1, 8, true],
  };
  const [type, size, signed] = map[code] || [1, 8, true];
  return { type, size, signed, shape: shape.slice(), total_size: shape.reduce((a, b) => a * b, 1), maxshape: shape.slice() };
}

function numericData(value, dtype) {
  if (ArrayBuffer.isView(value)) return value;
  const code = String(dtype).replace(/^[<>=|]/, '');
  if (code === 'Q' || code === 'u8') return BigUint64Array.from(value);
  if (code === 'q' || code === 'i8') return BigInt64Array.from(value);
  if (code === 'B' || code === 'u1') return Uint8Array.from(value);
  if (code === 'H' || code === 'u2') return Uint16Array.from(value);
  if (code === 'I' || code === 'u4') return Uint32Array.from(value);
  if (code === 'b' || code === 'i1') return Int8Array.from(value);
  if (code === 'h' || code === 'i2') return Int16Array.from(value);
  if (code === 'i' || code === 'i4') return Int32Array.from(value);
  if (code === 'f' || code === 'f4') return Float32Array.from(value);
  return Float64Array.from(value);
}

function dataset(value, shape, { dtype = '<d', metadata = null, attrs = {}, attachedScales = null, maxshape = null } = {}) {
  const data = numericData(value, dtype);
  const meta = metadata || inferMetadata(dtype, shape);
  if (maxshape) meta.maxshape = maxshape.slice();
  return {
    shape: shape.slice(),
    dtype,
    metadata: meta,
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, val]) => [key, attr(val)])),
    filters: [],
    get value() { return data; },
    get_attached_scales(index) { return attachedScales?.[index] || []; },
  };
}

function group(children = {}, attrs = {}) {
  return {
    children,
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, val]) => [key, attr(val)])),
    keys() { return Object.keys(children); },
  };
}

function fakeBackend(root) {
  function resolve(path) {
    const parts = String(path).split('/').filter(Boolean);
    let current = root;
    for (const part of parts) current = current?.children?.[part];
    return current;
  }
  class File {
    constructor() { this.attrs = root.attrs; }
    keys() { return root.keys(); }
    get(path) { return resolve(path); }
    close() {}
  }
  return async () => ({ ready: Promise.resolve({ FS: { writeFile() {}, unlink() {} } }), File });
}

function fakeBlob(extra = 32) { return new Blob([H5, new Uint8Array(extra)], { type: 'application/x-hdf5' }); }

function dimScale(name, size, id, { values = null, units = null, role = null } = {}) {
  const attrs = { CLASS: 'DIMENSION_SCALE', _Netcdf4Dimid: id };
  if (units) attrs.units = units;
  if (role) attrs.standard_name = role;
  return dataset(values || Array.from({ length: size }, (_, i) => i), [size], { dtype: '<d', attrs });
}

function netcdfRoot(children) {
  return group(children, { _NCProperties: 'version=2,netcdf=4.9.2,hdf5=1.14.3', Conventions: 'CF-1.10' });
}

function field(result, name) { return result.fields.find((item) => item.originalName === name); }

function twoByTwoDimensionTree({ sameDimensions = false } = {}) {
  const time = dimScale('time', 2, 0, { units: 'seconds since 2026-01-01T00:00:00Z', role: 'time' });
  const depth = dimScale('depth', 2, 1, { units: 'm', role: 'depth' });
  const foo = dimScale('foo', 2, 2);
  const bar = dimScale('bar', 2, 3);
  const temperature = dataset([1, 2, 3, 4], [2, 2], {
    dtype: '<f', attrs: { units: 'degC', _Netcdf4Coordinates: [0, 1] }, attachedScales: [['/time'], ['/depth']],
  });
  const unrelated = dataset([10, 11, 12, 13], [2, 2], {
    dtype: '<f', attrs: { units: '1', _Netcdf4Coordinates: sameDimensions ? [0, 1] : [2, 3] }, attachedScales: sameDimensions ? [['/time'], ['/depth']] : [['/foo'], ['/bar']],
  });
  return netcdfRoot({ time, depth, foo, bar, temperature, unrelated });
}

test('V7.1 rejects same-shape variables whose authoritative dimensions differ', async () => {
  const result = await readDataset(fakeBlob(), { fileName: 'dims.nc4', hdf5BackendLoader: fakeBackend(twoByTwoDimensionTree()) });
  assert.equal(field(result, 'temperature') != null, true);
  assert.equal(field(result, 'unrelated'), undefined);
  const meta = result.sourceMeta.hdf5.datasets.find((item) => item.name === 'unrelated');
  assert.deepEqual(meta.resolvedDimensions, ['foo', 'bar']);
  assert.ok(result.warnings.some((message) => message.includes('/unrelated') && message.includes('ordered subset')));
});

test('V7.1 accepts same-shape variables only when dimension identity is also the same', async () => {
  const result = await readDataset(fakeBlob(), { fileName: 'same.nc4', hdf5BackendLoader: fakeBackend(twoByTwoDimensionTree({ sameDimensions: true })) });
  assert.deepEqual(field(result, 'unrelated').dimensions, ['time', 'depth']);
  assert.deepEqual(Array.from(field(result, 'unrelated').values), [10, 11, 12, 13]);
});

test('V7.1 broadcasts authoritative lower-dimensional variables and 2-D auxiliary coordinates', async () => {
  const time = dimScale('time', 2, 0, { units: 'seconds since 2026-01-01T00:00:00Z', role: 'time' });
  const depth = dimScale('depth', 2, 1, { units: 'm', role: 'depth' });
  const y = dimScale('y', 2, 2);
  const x = dimScale('x', 3, 3);
  const temperature = dataset(Array.from({ length: 24 }, (_, i) => i), [2, 2, 2, 3], {
    dtype: '<f', attrs: { units: 'degC', _Netcdf4Coordinates: [0, 1, 2, 3] }, attachedScales: [['/time'], ['/depth'], ['/y'], ['/x']],
  });
  const bathymetry = dataset([100, 110, 120, 130, 140, 150], [2, 3], {
    dtype: '<f', attrs: { units: 'm', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/y'], ['/x']],
  });
  const surfaceTemp = dataset(Array.from({ length: 12 }, (_, i) => 20 + i), [2, 2, 3], {
    dtype: '<f', attrs: { units: 'degC', _Netcdf4Coordinates: [0, 2, 3] }, attachedScales: [['/time'], ['/y'], ['/x']],
  });
  const latitude = dataset([-70, -70, -70, -69, -69, -69], [2, 3], {
    dtype: '<f', attrs: { units: 'degrees_north', standard_name: 'latitude', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/y'], ['/x']],
  });
  const longitude = dataset([179, -179, -178, 179, -179, -178], [2, 3], {
    dtype: '<f', attrs: { units: 'degrees_east', standard_name: 'longitude', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/y'], ['/x']],
  });
  const result = await readDataset(fakeBlob(), { fileName: 'broadcast.nc4', hdf5BackendLoader: fakeBackend(netcdfRoot({ time, depth, y, x, temperature, bathymetry, surface_temp: surfaceTemp, latitude, longitude })) });
  assert.equal(result.rowCount, 24);
  assert.deepEqual(field(result, 'bathymetry').dimensions, ['y', 'x']);
  assert.equal(field(result, 'bathymetry').values[0], 100);
  assert.equal(field(result, 'bathymetry').values[6], 100);
  assert.equal(field(result, 'bathymetry').values[23], 150);
  assert.deepEqual(field(result, 'surface_temp').dimensions, ['time', 'y', 'x']);
  assert.equal(field(result, 'surface_temp').values[0], 20);
  assert.equal(field(result, 'surface_temp').values[6], 20);
  assert.equal(field(result, 'surface_temp').values[12], 26);
  assert.deepEqual(field(result, 'latitude').dimensions, ['y', 'x']);
  assert.deepEqual(field(result, 'longitude').dimensions, ['y', 'x']);
  assert.equal(field(result, 'latitude').values[0], -70);
  assert.equal(field(result, 'latitude').values[23], -69);
  assert.equal(field(result, 'longitude').values[1], -179);
});

test('V7.1 generic HDF5 excludes ambiguous same-shape variables without dimension identity', async () => {
  const y = dimScale('y', 2, null);
  delete y.attrs._Netcdf4Dimid;
  const x = dimScale('x', 2, null);
  delete x.attrs._Netcdf4Dimid;
  const master = dataset([1, 2, 3, 4], [2, 2], { dtype: '<f', attachedScales: [['/y'], ['/x']] });
  const ambiguous = dataset([5, 6, 7, 8], [2, 2], { dtype: '<f' });
  const result = await readDataset(fakeBlob(), { fileName: 'generic.h5', hdf5BackendLoader: fakeBackend(group({ y, x, master, ambiguous })) });
  assert.equal(field(result, 'master') != null, true);
  assert.equal(field(result, 'ambiguous'), undefined);
  assert.ok(result.warnings.some((message) => message.includes('/ambiguous') && message.includes('dimension identity')));
});

test('V7.1 applies NetCDF-4 enhanced unsigned/int64 default fills and explicit fill override', async () => {
  const sample = dimScale('sample', 3, 0);
  const common = { attachedScales: [['/sample']] };
  const children = {
    sample,
    a_master: dataset([1, 2, 3], [3], { dtype: '<f', attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    u8: dataset([1, 255, 2], [3], { dtype: '<u1', metadata: { type: 0, size: 1, signed: false, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    u16: dataset([1, 65535, 2], [3], { dtype: '<u2', metadata: { type: 0, size: 2, signed: false, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    u32: dataset([1, 4294967295, 2], [3], { dtype: '<u4', metadata: { type: 0, size: 4, signed: false, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    i64: dataset([1n, -9223372036854775806n, 2n], [3], { dtype: '<i8', metadata: { type: 0, size: 8, signed: true, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    u64: dataset([1n, 18446744073709551614n, 2n], [3], { dtype: '<u8', metadata: { type: 0, size: 8, signed: false, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, ...common }),
    explicit: dataset([255, 254, 3], [3], { dtype: '<u1', metadata: { type: 0, size: 1, signed: false, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0], _FillValue: 254 }, ...common }),
  };
  const result = await readDataset(fakeBlob(), { fileName: 'fills.nc4', hdf5BackendLoader: fakeBackend(netcdfRoot(children)) });
  for (const name of ['u8', 'u16', 'u32', 'i64', 'u64']) {
    assert.equal(Number.isNaN(field(result, name).values[1]), true, `${name} default fill`);
  }
  assert.equal(field(result, 'explicit').values[0], 255, 'explicit fill suppresses default fill');
  assert.equal(Number.isNaN(field(result, 'explicit').values[1]), true);
});

test('V7.1 marks unsafe non-fill 64-bit integers missing with a precision warning', async () => {
  const sample = dimScale('sample', 3, 0);
  const master = dataset([1, 2, 3], [3], { dtype: '<f', attrs: { _Netcdf4Coordinates: [0] }, attachedScales: [['/sample']] });
  const ids = dataset([1n, 9007199254740993n, 2n], [3], {
    dtype: '<i8', metadata: { type: 0, size: 8, signed: true, shape: [3], total_size: 3 }, attrs: { _Netcdf4Coordinates: [0] }, attachedScales: [['/sample']],
  });
  const result = await readDataset(fakeBlob(), { fileName: 'int64.nc4', hdf5BackendLoader: fakeBackend(netcdfRoot({ sample, master, ids })) });
  assert.equal(Number.isNaN(field(result, 'ids').values[1]), true);
  assert.ok(result.warnings.some((message) => message.includes('safe integer range')));
});

test('V7.1 generic HDF5 unsigned 255 does not inherit NetCDF default fill semantics', async () => {
  const sample = dataset([0, 1, 2], [3], { dtype: '<f', attrs: { CLASS: 'DIMENSION_SCALE' } });
  const master = dataset([1, 2, 3], [3], { dtype: '<f', attachedScales: [['/sample']] });
  const u8 = dataset([1, 255, 2], [3], { dtype: '<u1', metadata: { type: 0, size: 1, signed: false, shape: [3], total_size: 3 }, attachedScales: [['/sample']] });
  const result = await readDataset(fakeBlob(), { fileName: 'generic.h5', hdf5BackendLoader: fakeBackend(group({ sample, master, u8 })) });
  assert.equal(field(result, 'u8').values[1], 255);
  assert.equal(result.sourceMeta.netcdf, undefined);
});

test('V7.1 recognizes HDF5 legal user-block signatures through 1 MiB without linear scanning', async () => {
  for (const offset of [0, 512, 65536, 131072, 1048576]) {
    const bytes = new Uint8Array(offset + H5.length);
    bytes.set(H5, offset);
    assert.equal(findHdf5SignatureOffset(bytes), offset);
    assert.equal(await findHdf5SignatureInSource(new Blob([bytes]), 25 * 1024 * 1024), offset);
  }
  const random = new Uint8Array(1048576 + 8); random.fill(7);
  assert.equal(findHdf5SignatureOffset(random), -1);
  assert.equal(await findHdf5SignatureInSource(new Blob([random]), 25 * 1024 * 1024), -1);
});

test('V7.1 real h5wasm fixture exercises WASM/FS/File/metadata/value/dimension scales when dependency is installed', async (t) => {
  const path = fileURLToPath(new URL('./fixtures/netcdf4-real.h5', import.meta.url));
  const data = readFileSync(path);
  let result;
  try {
    // No fake backend is injected: this uses the reader's real/default h5wasm runtime path.
    result = await readDataset(new Blob([data]), { fileName: 'netcdf4-real.nc4', contentId: 'real-h5' });
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /h5wasm/.test(String(error?.message))) {
      t.skip('h5wasm is declared but cannot be installed in this execution environment; npm install will enable this real-runtime test.');
      return;
    }
    throw error;
  }
  assert.equal(result.sourceMeta.hdf5.format, 'NetCDF-4 / HDF5');
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensions, ['time', 'depth', 'y', 'x']);
  assert.equal(result.rowCount, 24);
  assert.deepEqual(field(result, 'bathymetry').dimensions, ['y', 'x']);
  assert.equal(field(result, 'temperature').values[0], -2);
  assert.equal(result.sourceMeta.netcdf.coordinateLevels.time.values.length, 2);
});

test('V7.1 classic CDF-1/CDF-2 .nc still dispatches to the V5 reader', async () => {
  for (const [fixture, version] of [['classic-cdf1.nc', 1], ['classic-cdf2.nc', 2]]) {
    const data = readFileSync(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)));
    const result = await readDataset(new Blob([data]), { fileName: fixture });
    assert.equal(result.sourceMeta.netcdf.version, version);
  }
});

test('V7.1 HDF5-backed .nc dispatches to V7 without shape-based dimension guessing', async () => {
  const root = twoByTwoDimensionTree();
  const result = await readDataset(fakeBlob(), { fileName: 'hdf5-backed.nc', hdf5BackendLoader: fakeBackend(root) });
  assert.equal(result.sourceMeta.netcdf.version, 4);
  assert.equal(field(result, 'unrelated'), undefined);
});

test('V7.1 DB_VERSION remains 6', () => assert.equal(DB_VERSION, 6));
