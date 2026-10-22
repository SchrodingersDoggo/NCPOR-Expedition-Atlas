import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { readDataset } from '../registry.js';

const H5 = Uint8Array.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
function attr(value) { return { value }; }

function dataset(value, shape, { dtype = '<f', attrs = {}, attachedScales = null } = {}) {
  const data = Float32Array.from(value);
  return {
    shape: shape.slice(), dtype,
    metadata: { type: 1, size: 4, signed: true, shape: shape.slice(), total_size: data.length, maxshape: shape.slice() },
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, val]) => [key, attr(val)])),
    filters: [],
    get value() { return data; },
    get_attached_scales(axis) { return attachedScales?.[axis] || []; },
  };
}

function dimScale(size, id = null, attrs = {}) {
  const scaleAttrs = { CLASS: 'DIMENSION_SCALE', ...attrs };
  if (id != null) scaleAttrs._Netcdf4Dimid = id;
  return dataset(Array.from({ length: size }, (_, index) => index), [size], { attrs: scaleAttrs });
}

function group(children = {}, attrs = {}) {
  return {
    children,
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, val]) => [key, attr(val)])),
    keys() { return Object.keys(children); },
  };
}

function netcdfRoot(children) {
  return group(children, { _NCProperties: 'version=2,netcdf=4.9.2,hdf5=1.14.3', Conventions: 'CF-1.10' });
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

function blob() { return new Blob([H5, new Uint8Array(64)], { type: 'application/x-hdf5' }); }
function field(result, pathOrName) {
  return result.fields.find((item) => item.hdf5Path === pathOrName || item.originalName === pathOrName);
}

function groupedCollisionTree({ compatible = false } = {}) {
  const gx = dimScale(2, 0);
  const gy = dimScale(3, 1);
  const rootX = dimScale(2, 2);
  const rootY = dimScale(3, 3);
  const temp = dataset([1, 2, 3, 4, 5, 6], [2, 3], {
    attrs: { units: 'degC', _Netcdf4Coordinates: [0, 1] },
    attachedScales: [['/g/x'], ['/g/y']],
  });
  const foo = dataset([10, 11, 12, 13, 14, 15], [2, 3], {
    attrs: { units: '1', _Netcdf4Coordinates: compatible ? [0, 1] : [2, 3] },
    attachedScales: compatible ? [['/g/x'], ['/g/y']] : [['/x'], ['/y']],
  });
  return netcdfRoot({
    g: group({ x: gx, y: gy, temp }),
    x: rootX,
    y: rootY,
    other: group({ foo }),
  });
}

test('V7.2 same basename but different attached scale paths are incompatible', async () => {
  const result = await readDataset(blob(), { fileName: 'group-collision.nc4', hdf5BackendLoader: fakeBackend(groupedCollisionTree()) });
  assert.ok(field(result, '/g/temp'));
  assert.equal(field(result, '/other/foo'), undefined);
  const fooMeta = result.sourceMeta.hdf5.datasets.find((item) => item.path === '/other/foo');
  assert.deepEqual(fooMeta.resolvedDimensions, ['x', 'y']);
  assert.deepEqual(fooMeta.resolvedDimensionIds, ['/x', '/y']);
  assert.deepEqual(result.sourceMeta.hdf5.masterDimensions, ['x', 'y']);
  assert.deepEqual(result.sourceMeta.hdf5.masterDimensionIds, ['/g/x', '/g/y']);
  assert.ok(result.warnings.some((message) => message.includes('/other/foo') && message.includes('/x') && message.includes('/g/x')));
});

test('V7.2 same friendly names with the same full scale paths remain compatible', async () => {
  const result = await readDataset(blob(), { fileName: 'same-group.nc4', hdf5BackendLoader: fakeBackend(groupedCollisionTree({ compatible: true })) });
  const foo = field(result, '/other/foo');
  assert.ok(foo);
  assert.deepEqual(foo.dimensions, ['x', 'y']);
  assert.deepEqual(foo.dimensionIdentities, ['/g/x', '/g/y']);
});

test('V7.2 child-group variables may legitimately use the exact same parent/root dimensions', async () => {
  const x = dimScale(2, 0);
  const y = dimScale(3, 1);
  const temp = dataset([1, 2, 3, 4, 5, 6], [2, 3], { attrs: { _Netcdf4Coordinates: [0, 1] } });
  const salinity = dataset([31, 32, 33, 34, 35, 36], [2, 3], { attrs: { _Netcdf4Coordinates: [0, 1] } });
  const root = netcdfRoot({ x, y, g: group({ temp, salinity }) });
  const result = await readDataset(blob(), { fileName: 'parent-dims.nc4', hdf5BackendLoader: fakeBackend(root) });
  assert.ok(field(result, '/g/temp'));
  assert.ok(field(result, '/g/salinity'));
  assert.deepEqual(field(result, '/g/temp').dimensionIdentities, ['/x', '/y']);
  assert.deepEqual(field(result, '/g/salinity').dimensionIdentities, ['/x', '/y']);
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensions, ['x', 'y']);
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensionIds, ['/x', '/y']);
});

test('V7.2 sibling-group NetCDF dimension IDs cannot satisfy another group', async () => {
  const otherX = dimScale(2, 7);
  const otherY = dimScale(3, 8);
  const temp = dataset([1, 2, 3, 4, 5, 6], [2, 3], { attrs: { _Netcdf4Coordinates: [7, 8] } });
  const root = netcdfRoot({ g: group({ temp }), other: group({ x: otherX, y: otherY }) });
  const result = await readDataset(blob(), { fileName: 'sibling-dims.nc4', hdf5BackendLoader: fakeBackend(root) });
  assert.ok(field(result, '/g/temp'), 'master remains readable');
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensions, ['dim_0', 'dim_1']);
  assert.ok(result.warnings.some((message) => message.includes('/g/temp') || message.includes('unresolved dimension identity')));
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensionIds, ['master:/g/temp#axis:0', 'master:/g/temp#axis:1']);
});

test('V7.2 grouped identities still preserve V7.1 subset and 2-D auxiliary-coordinate broadcasting', async () => {
  const time = dimScale(2, 0, { units: 'seconds since 2026-01-01T00:00:00Z', standard_name: 'time' });
  const depth = dimScale(2, 1, { units: 'm', standard_name: 'depth' });
  const y = dimScale(2, 2);
  const x = dimScale(3, 3);
  const temperature = dataset(Array.from({ length: 24 }, (_, index) => index), [2, 2, 2, 3], {
    attrs: { _Netcdf4Coordinates: [0, 1, 2, 3] }, attachedScales: [['/g/time'], ['/g/depth'], ['/g/y'], ['/g/x']],
  });
  const bathymetry = dataset([100, 110, 120, 130, 140, 150], [2, 3], {
    attrs: { units: 'm', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/g/y'], ['/g/x']],
  });
  const latitude = dataset([-70, -70, -70, -69, -69, -69], [2, 3], {
    attrs: { units: 'degrees_north', standard_name: 'latitude', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/g/y'], ['/g/x']],
  });
  const longitude = dataset([179, -179, -178, 179, -179, -178], [2, 3], {
    attrs: { units: 'degrees_east', standard_name: 'longitude', _Netcdf4Coordinates: [2, 3] }, attachedScales: [['/g/y'], ['/g/x']],
  });
  const root = netcdfRoot({ g: group({ time, depth, y, x, temperature, bathymetry, latitude, longitude }) });
  const result = await readDataset(blob(), { fileName: 'grouped-broadcast.nc4', hdf5BackendLoader: fakeBackend(root) });
  assert.equal(result.rowCount, 24);
  assert.deepEqual(field(result, '/g/bathymetry').dimensionIdentities, ['/g/y', '/g/x']);
  assert.equal(field(result, '/g/bathymetry').values[0], 100);
  assert.equal(field(result, '/g/bathymetry').values[23], 150);
  assert.deepEqual(field(result, '/g/latitude').dimensionIdentities, ['/g/y', '/g/x']);
  assert.deepEqual(field(result, '/g/longitude').dimensionIdentities, ['/g/y', '/g/x']);
  assert.equal(field(result, '/g/latitude').values[23], -69);
  assert.equal(field(result, '/g/longitude').values[1], -179);
});

test('V7.2 friendly dimension names remain available beside stable identities', async () => {
  const result = await readDataset(blob(), { fileName: 'friendly.nc4', hdf5BackendLoader: fakeBackend(groupedCollisionTree()) });
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensions, ['x', 'y']);
  assert.deepEqual(result.sourceMeta.netcdf.masterDimensionIds, ['/g/x', '/g/y']);
  assert.deepEqual(result.sourceMeta.netcdf.dimensions.map((dimension) => dimension.name), ['x', 'y']);
  assert.deepEqual(result.sourceMeta.netcdf.dimensions.map((dimension) => dimension.identity), ['/g/x', '/g/y']);
});

test('V7.2 DB_VERSION remains 6', () => assert.equal(DB_VERSION, 6));
