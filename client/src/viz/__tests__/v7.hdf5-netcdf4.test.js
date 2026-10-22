import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VERSION } from '../../offline/constants.js';
import { canReadDataset, readDataset } from '../registry.js';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { evaluateCapabilities } from '../capabilities.js';
import { fullVisualizationLimit } from '../limits.js';
import { getDatasetUploadRoute, validateDatasetFile } from '../../offline/fileRules.js';
import { isHdf5Signature } from '../readers/hdf5.js';

const H5 = Uint8Array.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

function attr(value) { return { value }; }
function dataset(value, shape, { dtype = '<f', metadata = null, attrs = {}, filters = [], attachedScales = null } = {}) {
  const data = ArrayBuffer.isView(value) ? value : Float64Array.from(value);
  return {
    shape: shape.slice(),
    dtype,
    metadata: metadata || { type: dtype.includes('f') || dtype.includes('d') ? 1 : 0, size: dtype.includes('d') ? 8 : 4, signed: true, shape: shape.slice(), total_size: data.length },
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, val]) => [key, attr(val)])),
    filters,
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
  const files = new Map();
  function resolve(path) {
    const parts = String(path).split('/').filter(Boolean);
    let current = root;
    for (const part of parts) current = current?.children?.[part];
    return current;
  }
  class File {
    constructor(path) { this.path = path; this.attrs = root.attrs; files.set(path, this); }
    keys() { return root.keys(); }
    get(path) { return resolve(path); }
    close() {}
  }
  return async () => ({
    ready: Promise.resolve({ FS: { writeFile() {}, unlink() {} } }),
    File,
  });
}
function fakeBlob() { return new Blob([H5, new Uint8Array(32)], { type: 'application/x-hdf5' }); }

function buildScientificTree({ netcdf4 = true } = {}) {
  const lat = dataset([-70, -69], [2], { attrs: { units: 'degrees_north', standard_name: 'latitude', axis: 'Y', _Netcdf4Dimid: 2, CLASS: 'DIMENSION_SCALE' } });
  const lon = dataset([179, -179], [2], { attrs: { units: 'degrees_east', standard_name: 'longitude', axis: 'X', _Netcdf4Dimid: 3, CLASS: 'DIMENSION_SCALE' } });
  const depth = dataset([0, 100], [2], { attrs: { units: 'm', standard_name: 'depth', positive: 'down', axis: 'Z', _Netcdf4Dimid: 1, CLASS: 'DIMENSION_SCALE' } });
  const time = dataset([0, 3600], [2], { attrs: { units: 'seconds since 2026-01-01T00:00:00Z', standard_name: 'time', axis: 'T', _Netcdf4Dimid: 0, CLASS: 'DIMENSION_SCALE' } });
  const packed = new Int16Array(16);
  for (let i = 0; i < packed.length; i += 1) packed[i] = i === 5 ? -9999 : i * 10;
  const temperature = dataset(packed, [2, 2, 2, 2], {
    dtype: '<h', metadata: { type: 0, size: 2, signed: true, shape: [2,2,2,2], total_size: 16 },
    attrs: { units: 'degC', long_name: 'Sea temperature', scale_factor: 0.1, add_offset: -2, _FillValue: -9999, _Netcdf4Coordinates: [0,1,2,3] }, attachedScales: [['/time'], ['/depth'], ['/lat'], ['/lon']],
  });
  const u = dataset(new Float32Array(16).fill(0.25), [2,2,2,2], { attrs: { units: 'm/s', standard_name: 'eastward_sea_water_velocity', _Netcdf4Coordinates: [0,1,2,3] }, attachedScales: [['/time'], ['/depth'], ['/lat'], ['/lon']] });
  const v = dataset(new Float32Array(16).fill(0.1), [2,2,2,2], { attrs: { units: 'm s-1', standard_name: 'northward_sea_water_velocity', _Netcdf4Coordinates: [0,1,2,3] }, attachedScales: [['/time'], ['/depth'], ['/lat'], ['/lon']] });
  const children = { time, depth, lat, lon, temperature, u_east: u, v_north: v };
  if (!netcdf4) {
    for (const child of Object.values(children)) {
      delete child.attrs?._Netcdf4Dimid;
      delete child.attrs?._Netcdf4Coordinates;
    }
  }
  return group(children, netcdf4 ? { _NCProperties: 'version=2,netcdf=4.9.2,hdf5=1.14.3', Conventions: 'CF-1.10' } : {});
}

test('V7 registers HDF5/NetCDF-4 formats with conservative 25 MiB browser limits', () => {
  for (const name of ['ocean.nc4', 'ocean.h5', 'ocean.hdf5']) {
    assert.equal(canReadDataset(name), true);
    assert.equal(fullVisualizationLimit(name), 25 * 1024 * 1024);
  }
  assert.equal(DB_VERSION, 6);
});

test('V7 recognizes the HDF5 signature at the root or after a legal user block', () => {
  assert.equal(isHdf5Signature(H5), true);
  const withUserBlock = new Uint8Array(520); withUserBlock.set(H5, 512);
  assert.equal(isHdf5Signature(withUserBlock), true);
  assert.equal(isHdf5Signature(Uint8Array.from([1,2,3,4,5,6,7,8])), false);
});

test('V7 accepts .nc4 in the existing scientific multipart upload route', () => {
  const file = { name: 'ocean.nc4', size: 1024, type: 'application/x-netcdf' };
  assert.equal(validateDatasetFile(file).ok, true);
  assert.equal(getDatasetUploadRoute(file), 'multipart');
});

test('NetCDF-4/HDF5 reader canonicalizes one master grid, coordinates, packing and CF time', async () => {
  const datasetResult = await readDataset(fakeBlob(), {
    fileName: 'ocean.nc4', contentId: 'h5-1', datasetFingerprint: 'sha256:h5', hdf5BackendLoader: fakeBackend(buildScientificTree()),
  });
  assert.equal(datasetResult.rowCount, 16);
  assert.equal(datasetResult.sourceMeta.hdf5.format, 'NetCDF-4 / HDF5');
  assert.equal(datasetResult.sourceMeta.netcdf.version, 4);
  assert.deepEqual(datasetResult.sourceMeta.netcdf.masterShape, [2,2,2,2]);
  assert.equal(datasetResult.sourceMeta.netcdf.coordinateLevels.time.values.length, 2);
  const temperature = datasetResult.fields.find((field) => field.originalName === 'temperature');
  assert.equal(temperature.values[0], -2);
  assert.equal(temperature.values[1], -1);
  assert.equal(Number.isNaN(temperature.values[5]), true);
  assert.ok(datasetResult.provenance.some((entry) => entry.operation === 'hdf5-scale-factor-add-offset-unpack'));
  assert.ok(datasetResult.provenance.some((entry) => entry.operation === 'netcdf4-cf-time-to-epoch-ms'));
});

test('V7 NetCDF-4 canonical output continues through V2 detection/capability engine', async () => {
  const canonical = await readDataset(fakeBlob(), { fileName: 'ocean.nc', hdf5BackendLoader: fakeBackend(buildScientificTree()), containerHint: 'netcdf4' });
  const detection = detectDatasetMapping(canonical);
  assert.equal(detection.needsMapping, false);
  const normalized = normalizeScientificDataset(canonical, detection.mapping, detection);
  normalized.capabilities = evaluateCapabilities(normalized);
  assert.equal(normalized.capabilities.map.enabled, true);
  assert.equal(normalized.capabilities.vectorField.enabled, true);
  assert.equal(normalized.normalizedCoords.timeNormalized, true);
});

test('V7 generic HDF5 uses the same canonical model without pretending it is NetCDF-4', async () => {
  const result = await readDataset(fakeBlob(), { fileName: 'science.h5', hdf5BackendLoader: fakeBackend(buildScientificTree({ netcdf4: false })) });
  assert.equal(result.sourceMeta.hdf5.format, 'HDF5');
  assert.equal(result.sourceMeta.netcdf, undefined);
  assert.equal(result.rowCount, 16);
  assert.deepEqual(result.sourceMeta.hdf5.masterDimensions, ['time', 'depth', 'lat', 'lon']);
  assert.ok(result.fields.some((field) => field.originalName === 'temperature'));
});

test('V7 keeps incompatible numeric HDF5 datasets as metadata rather than forcing them onto the master grid', async () => {
  const root = buildScientificTree();
  root.children.unrelated_profile = dataset([1,2,3], [3], { attrs: { units: '1' } });
  const result = await readDataset(fakeBlob(), { fileName: 'science.nc4', hdf5BackendLoader: fakeBackend(root) });
  assert.equal(result.fields.some((field) => field.originalName === 'unrelated_profile'), false);
  assert.ok(result.sourceMeta.hdf5.datasets.some((item) => item.name === 'unrelated_profile'));
  assert.ok(result.warnings.some((message) => message.includes('unrelated_profile')));
});

test('V7 keeps DB_VERSION at 6', () => assert.equal(DB_VERSION, 6));
