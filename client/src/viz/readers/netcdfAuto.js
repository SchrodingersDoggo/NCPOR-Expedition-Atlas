import { VIZ_LIMITS } from '../limits.js';
import { readNetcdf } from './netcdf.js';
import { readHdf5Scientific } from './hdf5.js';

const HDF5_SIGNATURE = Uint8Array.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

async function bytesAt(source, offset, count) {
  if (source instanceof ArrayBuffer) {
    if (offset >= source.byteLength) return new Uint8Array(0);
    return new Uint8Array(source, offset, Math.min(count, source.byteLength - offset));
  }
  if (ArrayBuffer.isView(source)) {
    if (offset >= source.byteLength) return new Uint8Array(0);
    return new Uint8Array(source.buffer, source.byteOffset + offset, Math.min(count, source.byteLength - offset));
  }
  if (source?.slice) {
    const buffer = await source.slice(offset, offset + count).arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (source?.arrayBuffer) {
    const buffer = await source.arrayBuffer();
    if (offset >= buffer.byteLength) return new Uint8Array(0);
    return new Uint8Array(buffer, offset, Math.min(count, buffer.byteLength - offset));
  }
  return new Uint8Array(0);
}

function sourceSize(source) {
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (ArrayBuffer.isView(source)) return source.byteLength;
  const size = Number(source?.size ?? 0);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function signatureMatches(bytes) {
  return bytes?.length >= HDF5_SIGNATURE.length && HDF5_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function isClassicNetcdfSignature(bytes) {
  return bytes?.length >= 4 && bytes[0] === 0x43 && bytes[1] === 0x44 && bytes[2] === 0x46 && (bytes[3] === 1 || bytes[3] === 2);
}

export async function findHdf5SignatureInSource(source, maxBytes = VIZ_LIMITS['.nc']) {
  const size = sourceSize(source);
  const cap = Math.max(0, Number(maxBytes || 0));
  const inspectLimit = size == null ? cap : Math.min(size, cap || size);
  const root = await bytesAt(source, 0, HDF5_SIGNATURE.length);
  if (signatureMatches(root)) return 0;
  for (let offset = 512; offset + HDF5_SIGNATURE.length <= inspectLimit; offset *= 2) {
    const bytes = await bytesAt(source, offset, HDF5_SIGNATURE.length);
    if (signatureMatches(bytes)) return offset;
    if (offset > Number.MAX_SAFE_INTEGER / 2) break;
  }
  return -1;
}

export async function readNetcdfAuto(source, options = {}) {
  const leading = await bytesAt(source, 0, 4);
  if (isClassicNetcdfSignature(leading)) return readNetcdf(source, options);
  const hdf5Offset = await findHdf5SignatureInSource(source, VIZ_LIMITS['.nc']);
  if (hdf5Offset >= 0) return readHdf5Scientific(source, { ...options, containerHint: 'netcdf4' });
  const error = new Error('The .nc file is neither NetCDF v3 (CDF-1/CDF-2) nor an HDF5-backed NetCDF-4 container.');
  error.code = 'VIZ_NETCDF_UNSUPPORTED_VARIANT';
  throw error;
}
