import { createCanonicalDataset } from '../model.js';
import {
  DEFAULT_FILL_VALUES,
  convertCfTimeInPlace,
  packing,
  parseCfTimeUnits,
  statistics,
} from './netcdf.js';

const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_DISCOVERED_OBJECTS = 5000;
const NETCDF4_DEFAULT_FILLS = Object.freeze({
  byte: -127,
  ubyte: 255,
  short: -32767,
  ushort: 65535,
  int: -2147483647,
  uint: 4294967295,
  int64: -9223372036854775806n,
  uint64: 18446744073709551614n,
  float: 9.969209968386869e36,
  double: 9.969209968386869e36,
});
let tempCounter = 0;

function abortIfNeeded(isCancelled) {
  if (isCancelled?.()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');
}

export function findHdf5SignatureOffset(bytes) {
  if (!bytes || bytes.length < HDF5_SIGNATURE.length) return -1;
  const matchesAt = (offset) => offset + HDF5_SIGNATURE.length <= bytes.length
    && HDF5_SIGNATURE.every((value, index) => bytes[offset + index] === value);
  if (matchesAt(0)) return 0;
  // HDF5 user blocks place the signature only at legal 512 * 2^n offsets.
  // Inspect those positions directly; never linearly scan arbitrary bytes.
  for (let offset = 512; offset + HDF5_SIGNATURE.length <= bytes.length; offset *= 2) {
    if (matchesAt(offset)) return offset;
    if (offset > Number.MAX_SAFE_INTEGER / 2) break;
  }
  return -1;
}

export function isHdf5Signature(bytes) {
  return findHdf5SignatureOffset(bytes) >= 0;
}

function rawAttributeValue(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function normalizeAttributeValue(value) {
  const raw = rawAttributeValue(value);
  if (ArrayBuffer.isView(raw)) {
    const values = Array.from(raw, (item) => typeof item === 'bigint'
      ? (item <= BigInt(Number.MAX_SAFE_INTEGER) && item >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(item) : String(item))
      : item);
    return values.length === 1 ? values[0] : values;
  }
  if (Array.isArray(raw)) {
    const values = raw.map((item) => normalizeAttributeValue(item));
    return values.length === 1 ? values[0] : values;
  }
  if (typeof raw === 'bigint') {
    return raw <= BigInt(Number.MAX_SAFE_INTEGER) && raw >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(raw) : String(raw);
  }
  return raw;
}

function attributesOf(object) {
  let attrs = {};
  try { attrs = object?.attrs || {}; } catch { attrs = {}; }
  const out = {};
  for (const [name, value] of Object.entries(attrs)) out[name] = normalizeAttributeValue(value);
  return out;
}

function rawAttributesOf(object) {
  let attrs = {};
  try { attrs = object?.attrs || {}; } catch { attrs = {}; }
  const out = {};
  for (const [name, value] of Object.entries(attrs)) out[name] = rawAttributeValue(value);
  return out;
}

function basename(path = '') {
  const clean = String(path).replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || '/';
}

function parentPath(path = '') {
  const parts = String(path).split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}`.replace(/\/$/, '') || '/';
}

function product(shape = []) {
  if (!shape.length) return 1;
  return shape.reduce((total, raw) => total * Math.max(0, Number(raw) || 0), 1);
}

function semanticToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function stringAttr(attrs, name) {
  const value = attrs?.[name];
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function coordinateRole(descriptor) {
  const attrs = descriptor.attributes || {};
  const token = semanticToken(descriptor.name);
  const standard = semanticToken(attrs.standard_name);
  const longName = semanticToken(attrs.long_name);
  const axis = stringAttr(attrs, 'axis').trim().toUpperCase();
  const units = stringAttr(attrs, 'units').toLowerCase();
  const positive = stringAttr(attrs, 'positive').toLowerCase();
  if (['lat', 'latitude'].includes(token) || standard === 'latitude' || /degrees?_?north/.test(units)) return 'lat';
  if (['lon', 'long', 'longitude'].includes(token) || standard === 'longitude' || /degrees?_?east/.test(units)) return 'lon';
  if (['time', 'date', 'datetime', 'timestamp'].includes(token) || standard === 'time' || axis === 'T' || /\bsince\b/.test(units)) return 'time';
  if (['depth', 'depth_m', 'depsm', 'z'].includes(token) || standard === 'depth' || (axis === 'Z' && positive === 'down')) return 'depth';
  if (['pressure', 'pres', 'prdm', 'dbar'].includes(token) || standard.includes('pressure') || /(^|\W)dbar($|\W)/.test(units)) return 'pressure';
  if (['station', 'station_id', 'site', 'cast', 'stn'].includes(token) || standard === 'platform_id' || longName.includes('station')) return 'station';
  if (axis === 'X') return 'x';
  if (axis === 'Y') return 'y';
  return null;
}

function descriptorScore(descriptor) {
  const role = coordinateRole(descriptor);
  let score = role ? 100 : 0;
  if (descriptor.rank === 1) score += 20;
  const klass = stringAttr(descriptor.attributes, 'CLASS').toUpperCase();
  if (klass === 'DIMENSION_SCALE') score += 35;
  if (descriptor.attributes?.standard_name) score += 15;
  if (descriptor.attributes?.axis) score += 10;
  if (descriptor.attributes?._Netcdf4Coordinates != null) score += 12;
  return score;
}

function dtypeHints(dtype = '') {
  const text = String(dtype || '').trim();
  const lower = text.toLowerCase();
  const numpy = lower.match(/^[<>=|]?([uif])(\d+)$/);
  if (numpy) {
    const [, kind, bytes] = numpy;
    return { float: kind === 'f', signed: kind !== 'u', size: Number(bytes) };
  }
  const code = text.replace(/^[<>=|]/, '');
  const table = {
    b: { float: false, signed: true, size: 1 }, B: { float: false, signed: false, size: 1 },
    h: { float: false, signed: true, size: 2 }, H: { float: false, signed: false, size: 2 },
    i: { float: false, signed: true, size: 4 }, I: { float: false, signed: false, size: 4 },
    l: { float: false, signed: true, size: 4 }, L: { float: false, signed: false, size: 4 },
    q: { float: false, signed: true, size: 8 }, Q: { float: false, signed: false, size: 8 },
    f: { float: true, signed: true, size: 4 }, d: { float: true, signed: true, size: 8 },
  };
  return table[code] || null;
}

function numericKind(metadata = {}, dtype = '') {
  const type = Number(metadata.type);
  const hint = dtypeHints(dtype);
  const size = Number(metadata.size || hint?.size || 0);
  const signed = typeof metadata.signed === 'boolean' ? metadata.signed : hint?.signed !== false;
  const float = type === 1 || hint?.float === true;
  const integer = type === 0 || (hint && !hint.float);
  if (float) return { numeric: true, float: true, size: size || 4, signed: true };
  if (integer) return { numeric: true, float: false, size: size || 4, signed };
  return { numeric: false, float: false, size, signed };
}

function netcdfAtomicType(descriptor) {
  const kind = descriptor.numericKind;
  if (!kind?.numeric) return null;
  if (kind.float) return kind.size >= 8 ? 'double' : 'float';
  if (kind.size === 1) return kind.signed ? 'byte' : 'ubyte';
  if (kind.size === 2) return kind.signed ? 'short' : 'ushort';
  if (kind.size === 4) return kind.signed ? 'int' : 'uint';
  if (kind.size === 8) return kind.signed ? 'int64' : 'uint64';
  return null;
}

function classicTypeFor(descriptor) {
  const atomic = netcdfAtomicType(descriptor);
  if (atomic === 'byte') return 1;
  if (atomic === 'short') return 3;
  if (atomic === 'int') return 4;
  if (atomic === 'float') return 5;
  if (atomic === 'double') return 6;
  return null;
}

function flattenRaw(value) {
  const raw = rawAttributeValue(value);
  if (ArrayBuffer.isView(raw)) return Array.from(raw);
  if (Array.isArray(raw)) return raw.flat(Infinity).flatMap((item) => flattenRaw(item));
  if (raw == null) return [];
  return [raw];
}

function exactBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim())) {
    try { return BigInt(value.trim()); } catch { return null; }
  }
  return null;
}

function safeNumber(value) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return Number.NaN;
    return Number(value);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim()) && !Number.isSafeInteger(number)) return Number.NaN;
  return number;
}

function rawEquals(a, b) {
  const aBig = exactBigInt(a);
  const bBig = exactBigInt(b);
  if (aBig != null && bBig != null) return aBig === bBig;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return false;
  if (Math.abs(an) > 1e30 || Math.abs(bn) > 1e30) {
    const scale = Math.max(1, Math.abs(an), Math.abs(bn));
    return Math.abs(an - bn) <= scale * 2e-7;
  }
  return Object.is(an, bn) || an === bn;
}

function rawCompare(a, b) {
  const aBig = exactBigInt(a);
  const bBig = exactBigInt(b);
  if (aBig != null && bBig != null) return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return null;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function numericList(value) {
  return flattenRaw(value).map(safeNumber).filter(Number.isFinite);
}

function rawValidity(descriptor, useNetcdfDefaults) {
  const normalizedAttrs = descriptor.attributes || {};
  const rawAttrs = descriptor.rawAttributes || normalizedAttrs;
  const hasExplicitFill = Object.prototype.hasOwnProperty.call(rawAttrs, '_FillValue');
  const atomic = netcdfAtomicType(descriptor);
  let fill = hasExplicitFill ? flattenRaw(rawAttrs._FillValue) : [];
  if (!hasExplicitFill && useNetcdfDefaults && atomic) {
    const enhanced = NETCDF4_DEFAULT_FILLS[atomic];
    if (enhanced != null) fill = [enhanced];
    else {
      const classic = classicTypeFor(descriptor);
      if (classic && Number.isFinite(DEFAULT_FILL_VALUES[classic])) fill = [DEFAULT_FILL_VALUES[classic]];
    }
  }
  const missing = flattenRaw(rawAttrs.missing_value);
  const validRange = flattenRaw(rawAttrs.valid_range);
  const validMinValues = flattenRaw(rawAttrs.valid_min);
  const validMaxValues = flattenRaw(rawAttrs.valid_max);
  let min = validRange.length >= 2 ? validRange[0] : null;
  let max = validRange.length >= 2 ? validRange[1] : null;
  if (min != null && max != null && rawCompare(min, max) === 1) [min, max] = [max, min];
  if (validMinValues.length) {
    const candidate = validMinValues[0];
    if (min == null || rawCompare(candidate, min) === 1) min = candidate;
  }
  if (validMaxValues.length) {
    const candidate = validMaxValues[0];
    if (max == null || rawCompare(candidate, max) === -1) max = candidate;
  }
  return { fill, missing, min, max, hasExplicitFill, atomic };
}

function decodeValues(rawValues, descriptor, useNetcdfDefaults, isCancelled) {
  const source = ArrayBuffer.isView(rawValues) || Array.isArray(rawValues) ? rawValues : [rawValues];
  const out = new Float64Array(source.length);
  out.fill(Number.NaN);
  const validity = rawValidity(descriptor, useNetcdfDefaults);
  const pack = packing({ attributes: descriptor.attributes || {} });
  let unsafeIntegerCount = 0;
  for (let i = 0; i < source.length; i += 1) {
    if ((i & 8191) === 0) abortIfNeeded(isCancelled);
    const raw = source[i];
    if (validity.fill.some((value) => rawEquals(raw, value))) continue;
    if (validity.missing.some((value) => rawEquals(raw, value))) continue;
    if (validity.min != null) {
      const comparison = rawCompare(raw, validity.min);
      if (comparison == null || comparison < 0) continue;
    }
    if (validity.max != null) {
      const comparison = rawCompare(raw, validity.max);
      if (comparison == null || comparison > 0) continue;
    }
    const number = safeNumber(raw);
    if (!Number.isFinite(number)) {
      if (typeof raw === 'bigint' || (typeof raw === 'string' && /^[-+]?\d+$/.test(raw.trim()))) unsafeIntegerCount += 1;
      continue;
    }
    const value = number * pack.scaleFactor + pack.addOffset;
    if (Number.isFinite(value)) out[i] = value;
  }
  return { values: out, packing: pack, validity, unsafeIntegerCount };
}

function stridesFor(shape) {
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i -= 1) strides[i] = strides[i + 1] * shape[i + 1];
  return strides;
}

function sameArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function broadcastToMaster(values, descriptor, dimensionIds, masterDimensionIds, masterShape, rowCount, isCancelled) {
  if (!values || dimensionIds.length !== descriptor.rank) return null;
  const positions = dimensionIds.map((identity) => masterDimensionIds.indexOf(identity));
  if (positions.some((position) => position < 0)) return null;
  for (let i = 1; i < positions.length; i += 1) if (positions[i] <= positions[i - 1]) return null;
  for (let i = 0; i < positions.length; i += 1) {
    if (Number(descriptor.shape[i]) !== Number(masterShape[positions[i]])) return null;
  }
  if (values.length === rowCount && sameArray(dimensionIds, masterDimensionIds) && sameArray(descriptor.shape, masterShape)) return values;
  if (values.length !== product(descriptor.shape)) return null;
  const masterStrides = stridesFor(masterShape);
  const sourceStrides = stridesFor(descriptor.shape);
  const out = new Float64Array(rowCount);
  out.fill(Number.NaN);
  for (let flat = 0; flat < rowCount; flat += 1) {
    if ((flat & 8191) === 0) abortIfNeeded(isCancelled);
    let sourceIndex = 0;
    for (let axis = 0; axis < positions.length; axis += 1) {
      const masterAxis = positions[axis];
      const index = Math.floor(flat / masterStrides[masterAxis]) % masterShape[masterAxis];
      sourceIndex += index * sourceStrides[axis];
    }
    out[flat] = values[sourceIndex] ?? Number.NaN;
  }
  return out;
}

function convertTime(values, descriptor, warnings, provenance) {
  const units = descriptor.attributes?.units || null;
  const cf = parseCfTimeUnits(units);
  if (!cf) return { values, timeInfo: null, unit: units };
  const converted = convertCfTimeInPlace(values, units, descriptor.attributes?.calendar);
  if (converted.converted) {
    provenance.push({ step: 'read', role: 'time', variable: descriptor.path, operation: 'netcdf4-cf-time-to-epoch-ms', approximate: false });
  } else if (!converted.calendarSupported) {
    warnings.push(`${converted.warning} Numeric coordinate values were preserved without fake Gregorian conversion.`);
    provenance.push({ step: 'read', role: 'time', variable: descriptor.path, operation: 'netcdf4-calendar-preserved-without-gregorian-conversion', approximate: false });
  }
  return {
    values: converted.values,
    unit: converted.converted ? 'ms since 1970-01-01T00:00:00Z' : units,
    timeInfo: {
      originalUnit: units,
      calendar: converted.calendar || String(descriptor.attributes?.calendar || 'standard'),
      normalized: Boolean(converted.converted),
      calendarSupported: converted.calendarSupported !== false,
    },
  };
}

function isDatasetLike(object) {
  return Boolean(object && Array.isArray(object.shape) && ('value' in object || typeof object.slice === 'function'));
}

function isGroupLike(object) {
  return Boolean(object && typeof object.keys === 'function' && !isDatasetLike(object));
}

function joinPath(parent, child) {
  if (!parent || parent === '/') return `/${child}`;
  return `${parent.replace(/\/$/, '')}/${child}`;
}

function discoverDatasets(file, isCancelled) {
  const descriptors = [];
  let seen = 0;
  function visit(group, path) {
    abortIfNeeded(isCancelled);
    const keys = group?.keys?.() || [];
    for (const key of keys) {
      if (++seen > MAX_DISCOVERED_OBJECTS) throw new Error(`HDF5 contains more than ${MAX_DISCOVERED_OBJECTS} linked objects; V7.1 stops discovery for browser safety.`);
      const childPath = joinPath(path, key);
      let child;
      try { child = file.get(childPath); } catch { continue; }
      if (!child) continue;
      if (isDatasetLike(child)) {
        const metadata = child.metadata || {};
        const shape = Array.from(child.shape || metadata.shape || [], Number);
        const dtype = String(child.dtype || '');
        const kind = numericKind(metadata, dtype);
        descriptors.push({
          path: childPath,
          name: basename(childPath),
          parent: parentPath(childPath),
          object: child,
          shape,
          rank: shape.length,
          elementCount: product(shape),
          dtype,
          metadata,
          numericKind: kind,
          numeric: kind.numeric,
          attributes: attributesOf(child),
          rawAttributes: rawAttributesOf(child),
          filters: (() => { try { return Array.isArray(child.filters) ? child.filters : []; } catch { return []; } })(),
          resolvedDimensions: null,
          dimensionResolution: 'unresolved',
        });
      } else if (isGroupLike(child)) {
        visit(child, childPath);
      }
    }
  }
  visit(file, '/');
  return descriptors;
}

function hasAttachedScaleMetadata(descriptor) {
  if (typeof descriptor?.object?.get_attached_scales !== 'function' || descriptor.rank < 1) return false;
  try {
    for (let axis = 0; axis < descriptor.rank; axis += 1) {
      if ((descriptor.object.get_attached_scales(axis) || []).length) return true;
    }
  } catch {}
  return false;
}

function isDimensionScaleCandidate(descriptor) {
  const klass = stringAttr(descriptor?.attributes, 'CLASS').toUpperCase();
  return descriptor?.rank === 1 && (klass === 'DIMENSION_SCALE' || netcdfDimId(descriptor) != null);
}

function chooseMaster(descriptors) {
  const candidates = descriptors.filter((item) => item.numeric && item.rank >= 1 && !coordinateRole(item) && !isDimensionScaleCandidate(item));
  return candidates.sort((a, b) => (
    b.elementCount - a.elementCount
    || b.rank - a.rank
    || Number(hasAttachedScaleMetadata(b)) - Number(hasAttachedScaleMetadata(a))
    || descriptorScore(b) - descriptorScore(a)
    || a.path.localeCompare(b.path)
  ))[0]
    || descriptors.filter((item) => item.numeric && item.rank >= 1).sort((a, b) => b.elementCount - a.elementCount || a.path.localeCompare(b.path))[0]
    || null;
}

function netcdfDimId(descriptor) {
  const values = numericList(descriptor?.rawAttributes?._Netcdf4Dimid ?? descriptor?.attributes?._Netcdf4Dimid);
  return values.length ? values[0] : null;
}

function netcdfCoordinates(descriptor) {
  const values = numericList(descriptor?.rawAttributes?._Netcdf4Coordinates ?? descriptor?.attributes?._Netcdf4Coordinates);
  return values.length === descriptor?.shape?.length ? values : null;
}

function pathProximity(candidate, master) {
  if (candidate.parent === master.parent) return 100;
  const a = candidate.parent.split('/').filter(Boolean);
  const b = master.parent.split('/').filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common * 10;
}

function scalePath(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return raw.path || raw.name || raw.filename || '';
  return String(raw || '');
}

function descriptorForScale(descriptors, rawPath) {
  const path = scalePath(rawPath);
  if (!path) return null;
  const normalized = `/${path.replace(/^\/+/, '')}`;
  return descriptors.find((item) => item.path === path || item.path === normalized) || null;
}

function attachedScalesFor(descriptors, descriptor) {
  if (typeof descriptor?.object?.get_attached_scales !== 'function') return null;
  const result = [];
  try {
    for (let axis = 0; axis < descriptor.rank; axis += 1) {
      const scales = descriptor.object.get_attached_scales(axis) || [];
      const found = Array.from(scales).map((raw) => descriptorForScale(descriptors, raw)).find(Boolean) || null;
      result.push(found);
    }
  } catch {
    return null;
  }
  return result.some(Boolean) ? result : null;
}

function dimensionScaleDescriptor(descriptor) {
  return isDimensionScaleCandidate(descriptor);
}

function netcdf4Evidence(rootAttributes, descriptors, containerHint) {
  if (Object.prototype.hasOwnProperty.call(rootAttributes || {}, '_NCProperties')) return true;
  if (descriptors.some((item) => netcdfDimId(item) != null || netcdfCoordinates(item))) return true;
  // A .nc HDF5 signature gets us into the NetCDF-4 reader, but the fill/dimension
  // semantics are enabled only when NetCDF-4 metadata itself is present.
  return containerHint === 'netcdf4' && descriptors.some((item) => dimensionScaleDescriptor(item));
}

function dimensionIdentity(scale, source, netcdfId = netcdfDimId(scale)) {
  if (!scale) return null;
  return {
    id: scale.path,
    name: scale.name,
    path: scale.path,
    source,
    netcdfDimId: netcdfId ?? null,
  };
}

function ancestorGroupPaths(path = '/') {
  let current = String(path || '/').replace(/\/+$/, '') || '/';
  const out = [];
  while (true) {
    out.push(current);
    if (current === '/') break;
    current = parentPath(current);
  }
  return out;
}

function scopedNetcdfDimensionById(descriptors, id, ownerDescriptor) {
  if (id == null || !ownerDescriptor) return null;
  const visibleGroups = ancestorGroupPaths(ownerDescriptor.parent);
  const byScope = new Map();
  for (const descriptor of descriptors) {
    if (!dimensionScaleDescriptor(descriptor) || netcdfDimId(descriptor) !== id) continue;
    const scopeIndex = visibleGroups.indexOf(descriptor.parent);
    if (scopeIndex < 0) continue; // sibling/unrelated groups are not visible
    if (!byScope.has(scopeIndex)) byScope.set(scopeIndex, []);
    byScope.get(scopeIndex).push(descriptor);
  }
  if (!byScope.size) return null;
  const nearest = Math.min(...byScope.keys());
  const candidates = byScope.get(nearest) || [];
  // Multiple dimensions with the same ID in the same visible scope are ambiguous.
  if (candidates.length !== 1) return null;
  return candidates[0];
}

function semanticMasterAxes(descriptors, master, isNetcdf4) {
  const coordinates = isNetcdf4 ? netcdfCoordinates(master) : null;
  const attached = attachedScalesFor(descriptors, master);
  return master.shape.map((size, axis) => {
    const scale = attached?.[axis] || null;
    if (scale && scale.rank === 1 && Number(scale.shape[0]) === Number(size)) {
      const identity = dimensionIdentity(scale, 'hdf5-attached-dimension-scale');
      return { axis, size: Number(size), descriptor: scale, ...identity, resolution: identity.source };
    }
    if (coordinates) {
      const id = coordinates[axis];
      const exact = scopedNetcdfDimensionById(descriptors, id, master);
      if (exact && exact.rank === 1 && Number(exact.shape[0]) === Number(size)) {
        const identity = dimensionIdentity(exact, 'netcdf-dimension-id', id);
        return { axis, size: Number(size), descriptor: exact, ...identity, resolution: identity.source };
      }
    }
    if (!isNetcdf4) {
      const candidates = descriptors
        .filter((item) => item.numeric && item.rank === 1 && Number(item.shape[0]) === Number(size) && coordinateRole(item))
        .map((item) => ({ item, score: descriptorScore(item) + pathProximity(item, master) }))
        .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
      const top = candidates[0] || null;
      const second = candidates[1] || null;
      if (top && (!second || top.score > second.score)) {
        const identity = dimensionIdentity(top.item, 'generic-hdf5-unambiguous-semantic-axis');
        return { axis, size: Number(size), descriptor: top.item, ...identity, resolution: identity.source };
      }
    }
    const name = `dim_${axis}`;
    return {
      axis, size: Number(size), descriptor: null, name,
      id: `master:${master.path}#axis:${axis}`, path: null, source: 'unresolved',
      resolution: 'unresolved', netcdfDimId: null,
    };
  });
}

/**
 * Resolve a dataset's real dimension identity. Shape equality is deliberately
 * excluded from this decision: equal extents do not mean equal dimensions.
 * Friendly names are retained separately from stable path-aware identities.
 */
export function resolveDatasetDimensions(descriptor, {
  descriptors = [],
  isNetcdf4 = false,
  masterAxes = null,
} = {}) {
  if (!descriptor || descriptor.rank === 0) return { dimensions: [], dimensionIds: [], dimensionInfo: [], resolution: 'scalar' };

  const attached = attachedScalesFor(descriptors, descriptor);
  if (attached && attached.length === descriptor.rank && attached.every(Boolean)) {
    const info = attached.map((scale) => dimensionIdentity(scale, 'hdf5-dimension-scale'));
    return {
      dimensions: info.map((item) => item.name),
      dimensionIds: info.map((item) => item.id),
      dimensionInfo: info,
      resolution: 'hdf5-attached-dimension-scales',
    };
  }

  if (isNetcdf4) {
    const ids = netcdfCoordinates(descriptor);
    if (ids) {
      const scales = ids.map((id) => scopedNetcdfDimensionById(descriptors, id, descriptor));
      if (scales.every(Boolean)) {
        const info = scales.map((scale, index) => dimensionIdentity(scale, 'netcdf-dimension-id', ids[index]));
        return { dimensions: info.map((item) => item.name), dimensionIds: info.map((item) => item.id), dimensionInfo: info, resolution: 'netcdf4-dimension-ids' };
      }
    }
    if (dimensionScaleDescriptor(descriptor)) {
      const info = [dimensionIdentity(descriptor, 'netcdf4-dimension-scale')];
      return { dimensions: [descriptor.name], dimensionIds: [descriptor.path], dimensionInfo: info, resolution: 'netcdf4-dimension-scale' };
    }
    return { dimensions: null, dimensionIds: null, dimensionInfo: null, resolution: 'unresolved-netcdf4-dimensions' };
  }

  if (dimensionScaleDescriptor(descriptor)) {
    const info = [dimensionIdentity(descriptor, 'hdf5-dimension-scale')];
    return { dimensions: [descriptor.name], dimensionIds: [descriptor.path], dimensionInfo: info, resolution: 'hdf5-dimension-scale' };
  }
  if (descriptor.rank === 1 && coordinateRole(descriptor) && Array.isArray(masterAxes)) {
    const matches = masterAxes.filter((axis) => axis.descriptor?.path === descriptor.path);
    if (matches.length === 1) {
      const axis = matches[0];
      return { dimensions: [axis.name], dimensionIds: [axis.id], dimensionInfo: [{ id: axis.id, name: axis.name, path: axis.path, source: axis.source }], resolution: 'generic-hdf5-master-axis-identity' };
    }
  }
  return { dimensions: null, dimensionIds: null, dimensionInfo: null, resolution: 'unresolved-generic-hdf5-dimensions' };
}

function orderedSubsetCompatible(descriptor, dimensionIds, masterDimensionIds, masterShape) {
  if (!Array.isArray(dimensionIds) || dimensionIds.length !== descriptor.rank) return false;
  const positions = dimensionIds.map((identity) => masterDimensionIds.indexOf(identity));
  if (positions.some((position) => position < 0)) return false;
  for (let i = 1; i < positions.length; i += 1) if (positions[i] <= positions[i - 1]) return false;
  return descriptor.shape.every((size, axis) => Number(size) === Number(masterShape[positions[axis]]));
}

function dimensionUnlimited(descriptor) {
  const maxshape = descriptor?.metadata?.maxshape;
  if (!Array.isArray(maxshape) || descriptor.rank !== 1) return false;
  const max = maxshape[0];
  return max == null || max === Infinity || Number(max) < 0;
}

function fieldDefinition(descriptor, index, values, unit, timeInfo, stats) {
  return {
    key: `field_${index}`,
    index,
    originalName: descriptor.name,
    normalizedName: descriptor.name,
    unit,
    description: descriptor.attributes?.long_name || descriptor.attributes?.standard_name || descriptor.path,
    type: 'number',
    values,
    missingCount: stats.missingCount,
    statistics: stats,
    dimensions: descriptor.resolvedDimensions || [],
    dimensionIdentities: descriptor.resolvedDimensionIds || [],
    shape: descriptor.shape.slice(),
    hdf5Path: descriptor.path,
    hdf5Dtype: descriptor.dtype,
    hdf5Attributes: descriptor.attributes,
    netcdfAttributes: descriptor.attributes,
    netcdfTime: timeInfo,
  };
}

async function defaultBackendLoader() {
  // h5wasm publishes a browser ESM entry and a dedicated Node entry. Keep the
  // production browser path unchanged, while allowing the real binary fixture
  // to exercise the default reader path under Node's test runner.
  const isNode = typeof process !== 'undefined' && Boolean(process?.versions?.node);
  if (isNode) {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      // h5wasm/node documents temporarily hiding Node's navigator shim.
      if (navigatorDescriptor?.configurable) {
        Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
      }
      const nodeEntry = 'h5wasm/node';
      const module = await import(/* @vite-ignore */ nodeEntry);
      await module.ready;
      return module.default || module.h5wasm || module;
    } finally {
      if (navigatorDescriptor?.configurable) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    }
  }
  const module = await import('h5wasm');
  await module.ready;
  return module.default || module.h5wasm || module;
}

// Offline warm-up hook: fetch the h5wasm runtime once so the service worker can
// cache it for later offline HDF5/NetCDF-4 parsing.
export async function preloadHdf5Backend() {
  await defaultBackendLoader();
  return true;
}

async function openFileWithBackend(buffer, fileName, backendLoader) {
  const backend = await backendLoader();
  const module = await backend.ready;
  const FS = module?.FS;
  if (!FS?.writeFile) throw new Error('HDF5 WebAssembly filesystem is unavailable.');
  const safeName = String(fileName || 'dataset.h5').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(-100) || 'dataset.h5';
  const tempPath = `/viz_${Date.now()}_${++tempCounter}_${safeName}`;
  FS.writeFile(tempPath, new Uint8Array(buffer));
  let file;
  try {
    file = new backend.File(tempPath, 'r');
  } catch (error) {
    try { FS.unlink(tempPath); } catch {}
    throw error;
  }
  return {
    backend,
    file,
    cleanup() {
      try { file?.close?.(); } catch {}
      try { FS.unlink(tempPath); } catch {}
    },
  };
}

export async function readHdf5Scientific(source, {
  sourceId = null,
  contentId = null,
  fileName = source?.name || '',
  datasetFingerprint = null,
  isCancelled = () => false,
  onProgress = null,
  containerHint = null,
  hdf5BackendLoader = defaultBackendLoader,
} = {}) {
  abortIfNeeded(isCancelled);
  const buffer = source instanceof ArrayBuffer
    ? source
    : ArrayBuffer.isView(source)
      ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
      : await source.arrayBuffer();
  // The complete file is already in memory at this point, so inspect every legal
  // HDF5 superblock offset rather than imposing an artificial 64 KiB user-block cap.
  if (!isHdf5Signature(new Uint8Array(buffer))) {
    const error = new Error('File does not contain the HDF5 signature required for NetCDF-4/HDF5 visualization.');
    error.code = 'VIZ_HDF5_INVALID_SIGNATURE';
    throw error;
  }
  onProgress?.({ stage: 'hdf5-runtime', loaded: 1, total: 5, percent: 5 });
  let opened;
  try {
    opened = await openFileWithBackend(buffer, fileName, hdf5BackendLoader);
    abortIfNeeded(isCancelled);
    const rootAttributes = attributesOf(opened.file);
    const descriptors = discoverDatasets(opened.file, isCancelled);
    const isNetcdf4 = netcdf4Evidence(rootAttributes, descriptors, containerHint);
    onProgress?.({ stage: 'hdf5-discovery', loaded: 2, total: 5, percent: 15 });
    const master = chooseMaster(descriptors);
    if (!master) throw new Error('HDF5 file does not contain a supported numeric dataset that can define a visualization grid.');

    const axes = semanticMasterAxes(descriptors, master, isNetcdf4);
    const masterShape = master.shape.slice();
    const masterDimensions = axes.map((axis) => axis.name);
    const masterDimensionIds = axes.map((axis) => axis.id);
    const masterResolutionComplete = axes.every((axis) => axis.resolution !== 'unresolved');
    const rowCount = product(masterShape);
    if (!rowCount) throw new Error('HDF5 visualization grid has zero observations.');

    const warnings = [];
    const provenance = [];
    const fields = [];
    const variables = [];
    const includedVariables = [];
    const coordinateLevels = {};
    if (!masterResolutionComplete) {
      warnings.push(`HDF5 master dataset ${master.path} has unresolved dimension identity for ${axes.filter((axis) => axis.resolution === 'unresolved').map((axis) => axis.name).join(', ')}. Variables without authoritative dimension metadata are excluded rather than matched by shape.`);
    }

    const compatible = [];
    for (const descriptor of descriptors) {
      if (!descriptor.numeric || descriptor.rank < 1) continue;
      let resolved;
      if (descriptor.path === master.path) {
        resolved = masterResolutionComplete
          ? { dimensions: masterDimensions.slice(), dimensionIds: masterDimensionIds.slice(), dimensionInfo: axes.map(({ id, name, path, source }) => ({ id, name, path, source })), resolution: axes.map((axis) => axis.resolution).join('+') }
          : { dimensions: null, dimensionIds: null, dimensionInfo: null, resolution: 'unresolved-master-dimensions' };
      } else {
        resolved = resolveDatasetDimensions(descriptor, { descriptors, isNetcdf4, masterAxes: axes });
      }
      descriptor.resolvedDimensions = resolved.dimensions;
      descriptor.resolvedDimensionIds = resolved.dimensionIds;
      descriptor.resolvedDimensionInfo = resolved.dimensionInfo;
      descriptor.dimensionResolution = resolved.resolution;
      if (descriptor.path === master.path && !resolved.dimensions) {
        // The master itself still defines the row model, but unresolved generic axes
        // are synthetic identities local to the master. Do not let unrelated variables
        // inherit them by shape.
        descriptor.resolvedDimensions = masterDimensions.slice();
        descriptor.resolvedDimensionIds = masterDimensionIds.slice();
        descriptor.resolvedDimensionInfo = axes.map(({ id, name, path, source }) => ({ id, name, path, source }));
        descriptor.dimensionResolution = 'master-local-unresolved-axes';
        compatible.push(descriptor);
        continue;
      }
      if (orderedSubsetCompatible(descriptor, descriptor.resolvedDimensionIds, masterDimensionIds, masterShape)) compatible.push(descriptor);
    }

    const compatibleSet = new Set(compatible);
    const axisByPath = new Map(axes.filter((axis) => axis.descriptor).map((axis) => [axis.descriptor.path, axis]));
    for (let i = 0; i < compatible.length; i += 1) {
      abortIfNeeded(isCancelled);
      const descriptor = compatible[i];
      let raw;
      try { raw = descriptor.object.value; } catch (error) {
        if (descriptor.path === master.path) throw new Error(`Could not read HDF5 master dataset ${descriptor.path}: ${error?.message || error}`);
        warnings.push(`HDF5 dataset ${descriptor.path} could not be decoded and was skipped: ${error?.message || error}`);
        continue;
      }
      const decoded = decodeValues(raw, descriptor, isNetcdf4, isCancelled);
      let values = decoded.values;
      let timeInfo = null;
      let unit = descriptor.attributes?.units || null;
      if (coordinateRole(descriptor) === 'time' || parseCfTimeUnits(unit)) {
        const time = convertTime(values, descriptor, warnings, provenance);
        values = time.values;
        timeInfo = time.timeInfo;
        unit = time.unit;
      }
      if (decoded.packing.applied) {
        provenance.push({ step: 'read', role: 'packing', variable: descriptor.path, operation: 'hdf5-scale-factor-add-offset-unpack', approximate: false, detail: `scale_factor=${decoded.packing.scaleFactor}; add_offset=${decoded.packing.addOffset}` });
      }
      if (decoded.unsafeIntegerCount) {
        warnings.push(`HDF5 dataset ${descriptor.path} contains ${decoded.unsafeIntegerCount} 64-bit integer value(s) outside JavaScript's safe integer range. Those values were marked missing instead of silently rounded.`);
        provenance.push({ step: 'read', role: 'precision', variable: descriptor.path, operation: 'hdf5-unsafe-int64-marked-missing', approximate: false, count: decoded.unsafeIntegerCount });
      }

      const dimensions = descriptor.resolvedDimensions || [];
      const dimensionIds = descriptor.resolvedDimensionIds || [];
      const canonicalValues = broadcastToMaster(values, descriptor, dimensionIds, masterDimensionIds, masterShape, rowCount, isCancelled);
      if (!canonicalValues) {
        warnings.push(`HDF5 dataset ${descriptor.path} could not be safely broadcast from dimension identities [${dimensionIds.join(', ')}] into master identities [${masterDimensionIds.join(', ')}] and was skipped.`);
        continue;
      }
      const stats = statistics(canonicalValues);
      const field = fieldDefinition(descriptor, fields.length, canonicalValues, unit, timeInfo, stats);
      fields.push(field);
      variables.push({ fieldKey: field.key, name: descriptor.name, originalName: descriptor.name, unit, type: 'numeric', statistics: stats });
      includedVariables.push({ path: descriptor.path, name: descriptor.name, fieldKey: field.key, dimensions: dimensions.slice(), dimensionIdentities: dimensionIds.slice(), shape: descriptor.shape.slice(), unit, attributes: descriptor.attributes, dtype: descriptor.dtype, dimensionResolution: descriptor.dimensionResolution });

      const axis = axisByPath.get(descriptor.path);
      if (axis && descriptor.rank === 1 && dimensions.length === 1) {
        coordinateLevels[axis.name] = {
          fieldKey: field.key,
          dimension: axis.name,
          dimensionIdentity: axis.id,
          path: descriptor.path,
          values: Array.from(values),
          unit,
          originalUnit: descriptor.attributes?.units || null,
          calendar: timeInfo?.calendar || null,
          timeNormalized: timeInfo ? timeInfo.normalized : null,
          calendarSupported: timeInfo ? timeInfo.calendarSupported : null,
        };
      }
      onProgress?.({ stage: 'hdf5-canonical', loaded: i + 1, total: compatible.length, percent: 15 + Math.round(((i + 1) / Math.max(1, compatible.length)) * 80) });
    }

    for (const descriptor of descriptors) {
      if (!descriptor.numeric || compatibleSet.has(descriptor)) continue;
      const dims = descriptor.resolvedDimensions;
      const dimIds = descriptor.resolvedDimensionIds;
      const reason = !Array.isArray(dimIds)
        ? `its dimension identity could not be resolved safely (${descriptor.dimensionResolution}); shape equality is not accepted as dimension equivalence`
        : `its resolved dimension identities [${dimIds.join(', ')}] differ from or are not an ordered subset of master identities [${masterDimensionIds.join(', ')}] (friendly names: [${(dims || []).join(', ')}] vs [${masterDimensions.join(', ')}])`; 
      warnings.push(`HDF5 dataset ${descriptor.path} was preserved in metadata but not flattened because ${reason}.`);
    }
    if (!fields.length) throw new Error('No HDF5 numeric variables could be decoded into the selected visualization grid.');

    const dimensionMeta = axes.map((axis) => ({
      name: axis.name,
      identity: axis.id,
      path: axis.path,
      source: axis.source,
      size: axis.size,
      unlimited: dimensionUnlimited(axis.descriptor),
      values: coordinateLevels[axis.name]?.values || null,
      unit: coordinateLevels[axis.name]?.unit || null,
      resolution: axis.resolution,
    }));
    const datasetMeta = descriptors.map((item) => ({
      path: item.path,
      name: item.name,
      shape: item.shape.slice(),
      dtype: item.dtype,
      attributes: item.attributes,
      filters: item.filters,
      resolvedDimensions: item.resolvedDimensions ? item.resolvedDimensions.slice() : null,
      resolvedDimensionIds: item.resolvedDimensionIds ? item.resolvedDimensionIds.slice() : null,
      dimensionResolution: item.dimensionResolution,
      maxshape: Array.isArray(item.metadata?.maxshape) ? item.metadata.maxshape.slice() : null,
    }));

    const sourceMeta = {
      hdf5: {
        format: isNetcdf4 ? 'NetCDF-4 / HDF5' : 'HDF5',
        rootAttributes,
        masterDataset: master.path,
        masterDimensions,
        masterDimensionIds,
        masterShape,
        dimensionStrategy: 'authoritative-dimension-scales-or-netcdf4-ids',
        coordinateLevels,
        datasets: datasetMeta,
        includedVariables,
      },
    };
    if (isNetcdf4) {
      sourceMeta.netcdf = {
        format: 'NetCDF-4 / HDF5',
        version: 4,
        globalAttributes: rootAttributes,
        dimensions: dimensionMeta,
        variables: descriptors.map((item) => ({
          name: item.name,
          path: item.path,
          dimensions: item.resolvedDimensions ? item.resolvedDimensions.slice() : [],
          dimensionIdentities: item.resolvedDimensionIds ? item.resolvedDimensionIds.slice() : [],
          dimensionResolved: Boolean(item.resolvedDimensions),
          dimensionResolution: item.dimensionResolution,
          shape: item.shape.slice(),
          type: item.dtype,
          unit: item.attributes?.units || null,
          attributes: item.attributes,
        })),
        includedVariables,
        masterVariable: master.path,
        masterDimensions,
        masterDimensionIds,
        masterShape,
        coordinateLevels,
        dimensionStrategy: 'hdf5-dimension-scales-then-netcdf4-dimension-ids',
      };
      provenance.push({ step: 'read', role: 'structure', operation: 'netcdf4-hdf5-authoritative-dimension-canonicalization', approximate: false });
    } else {
      provenance.push({ step: 'read', role: 'structure', operation: 'hdf5-conservative-dimension-canonicalization', approximate: false });
    }
    onProgress?.({ stage: 'complete', loaded: 5, total: 5, percent: 100 });
    return createCanonicalDataset({ sourceId, contentId, fileName, datasetFingerprint, fields, rowCount, variables, warnings, provenance, sourceMeta });
  } finally {
    opened?.cleanup?.();
  }
}

export {
  NETCDF4_DEFAULT_FILLS,
  coordinateRole as hdf5CoordinateRole,
  defaultBackendLoader as loadHdf5Backend,
  netcdfAtomicType,
};
