import { createCanonicalDataset } from '../model.js';
import { parseTimestamp } from '../timeParse.js';
import {
  createNumericStatistics,
  finishNumericStatistics,
  histogramFromNumericValues,
  pushNumericStatistic,
} from '../statistics.js';

const TAG_DIMENSION = 10;
const TAG_VARIABLE = 11;
const TAG_ATTRIBUTE = 12;
const TYPE_NAMES = { 1: 'byte', 2: 'char', 3: 'short', 4: 'int', 5: 'float', 6: 'double' };
const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
const DEFAULT_FILL_VALUES = Object.freeze({
  1: -127,
  3: -32767,
  4: -2147483647,
  5: Math.fround(9.969209968386869e36),
  6: 9.969209968386869e36,
});
const GREGORIAN_CALENDARS = new Set(['', 'standard', 'gregorian', 'proleptic_gregorian']);
const UNSUPPORTED_CALENDARS = new Set(['noleap', '365_day', 'all_leap', '366_day', '360_day', 'julian', 'none']);

function abortIfNeeded(isCancelled) {
  if (isCancelled?.()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');
}

function align4(value) { return (value + 3) & ~3; }

class NcReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
  }
  u8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  i8() { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
  u16() { const v = this.view.getUint16(this.offset, false); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset, false); this.offset += 2; return v; }
  u32() { const v = this.view.getUint32(this.offset, false); this.offset += 4; return v; }
  i32() { const v = this.view.getInt32(this.offset, false); this.offset += 4; return v; }
  f32() { const v = this.view.getFloat32(this.offset, false); this.offset += 4; return v; }
  f64() { const v = this.view.getFloat64(this.offset, false); this.offset += 8; return v; }
  u64() {
    const high = this.u32(); const low = this.u32();
    const value = high * 4294967296 + low;
    if (!Number.isSafeInteger(value)) throw new Error('NetCDF offset exceeds browser safe integer range.');
    return value;
  }
  bytes(length) {
    const out = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return out;
  }
  string() {
    const length = this.u32();
    const raw = this.bytes(length);
    this.offset += align4(length) - length;
    return new TextDecoder('utf-8').decode(raw);
  }
}

function readTypedValues(reader, type, count) {
  if (!TYPE_BYTES[type]) throw new Error(`Unsupported NetCDF classic type ${type}.`);
  if (type === 2) {
    const bytes = reader.bytes(count);
    const value = new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
    reader.offset += align4(count) - count;
    return value;
  }
  const values = new Array(count);
  for (let i = 0; i < count; i += 1) {
    if (type === 1) values[i] = reader.i8();
    else if (type === 3) values[i] = reader.i16();
    else if (type === 4) values[i] = reader.i32();
    else if (type === 5) values[i] = reader.f32();
    else if (type === 6) values[i] = reader.f64();
  }
  const bytes = count * TYPE_BYTES[type];
  reader.offset += align4(bytes) - bytes;
  return values;
}

function readListHeader(reader, expectedTag) {
  const tag = reader.u32();
  const count = reader.u32();
  if (tag === 0 && count === 0) return 0;
  if (tag !== expectedTag) throw new Error(`Malformed NetCDF header: expected list tag ${expectedTag}, received ${tag}.`);
  return count;
}

function readAttributes(reader) {
  const count = readListHeader(reader, TAG_ATTRIBUTE);
  const attrs = {};
  for (let i = 0; i < count; i += 1) {
    const name = reader.string();
    const type = reader.u32();
    const length = reader.u32();
    const values = readTypedValues(reader, type, length);
    attrs[name] = type === 2 ? values : length === 1 ? values[0] : values;
  }
  return attrs;
}

function parseHeader(buffer) {
  const reader = new NcReader(buffer);
  const magic = String.fromCharCode(reader.u8(), reader.u8(), reader.u8());
  const version = reader.u8();
  if (magic !== 'CDF' || ![1, 2].includes(version)) {
    const error = new Error('This file is not a classic NetCDF v3 (CDF-1/CDF-2) file.');
    error.code = 'VIZ_NETCDF_UNSUPPORTED_VARIANT';
    throw error;
  }
  const numRecords = reader.u32();
  const dimCount = readListHeader(reader, TAG_DIMENSION);
  const dimensions = [];
  for (let i = 0; i < dimCount; i += 1) {
    const name = reader.string();
    const rawSize = reader.u32();
    dimensions.push({ id: i, name, unlimited: rawSize === 0, size: rawSize === 0 ? numRecords : rawSize });
  }
  const globalAttributes = readAttributes(reader);
  const varCount = readListHeader(reader, TAG_VARIABLE);
  const variables = [];
  for (let i = 0; i < varCount; i += 1) {
    const name = reader.string();
    const ndims = reader.u32();
    const dimIds = Array.from({ length: ndims }, () => reader.u32());
    const attributes = readAttributes(reader);
    const type = reader.u32();
    const vsize = reader.u32();
    const begin = version === 1 ? reader.u32() : reader.u64();
    const dims = dimIds.map((id) => dimensions[id]);
    variables.push({
      name,
      dimIds,
      dimensions: dims.map((d) => d?.name),
      shape: dims.map((d) => d?.size || 0),
      attributes,
      type,
      typeName: TYPE_NAMES[type] || `type-${type}`,
      vsize,
      begin,
      isRecord: Boolean(dims[0]?.unlimited),
    });
  }
  return { version, numRecords, dimensions, globalAttributes, variables };
}

function product(values) { return values.reduce((out, value) => out * Math.max(0, Number(value) || 0), 1); }

function readValueAt(view, offset, type) {
  if (type === 1) return view.getInt8(offset);
  if (type === 3) return view.getInt16(offset, false);
  if (type === 4) return view.getInt32(offset, false);
  if (type === 5) return view.getFloat32(offset, false);
  if (type === 6) return view.getFloat64(offset, false);
  return Number.NaN;
}

function numericList(value) {
  return [value].flat().map(Number).filter(Number.isFinite);
}

function nearlyEqual(value, sentinel) {
  // Attribute values and stored values are decoded through the same NetCDF
  // primitive type, so a true fill/missing sentinel has the same JS number.
  // The NC_FLOAT default above is pre-rounded with Math.fround for this reason.
  return value === sentinel;
}

function rawValidity(variable) {
  const attrs = variable.attributes || {};
  const explicitFill = Object.prototype.hasOwnProperty.call(attrs, '_FillValue');
  const fill = explicitFill
    ? numericList(attrs._FillValue)
    : Number.isFinite(DEFAULT_FILL_VALUES[variable.type]) ? [DEFAULT_FILL_VALUES[variable.type]] : [];
  const missing = numericList(attrs.missing_value);
  const validRange = numericList(attrs.valid_range);
  const validMinValues = numericList(attrs.valid_min);
  const validMaxValues = numericList(attrs.valid_max);
  let min = validRange.length >= 2 ? Math.min(validRange[0], validRange[1]) : null;
  let max = validRange.length >= 2 ? Math.max(validRange[0], validRange[1]) : null;
  if (validMinValues.length) min = min == null ? validMinValues[0] : Math.max(min, validMinValues[0]);
  if (validMaxValues.length) max = max == null ? validMaxValues[0] : Math.min(max, validMaxValues[0]);
  return { fill, missing, min, max, explicitFill };
}

function packing(variable) {
  const rawScale = Number(variable.attributes?.scale_factor);
  const rawOffset = Number(variable.attributes?.add_offset);
  const scaleFactor = Number.isFinite(rawScale) ? rawScale : 1;
  const addOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
  return {
    scaleFactor,
    addOffset,
    applied: scaleFactor !== 1 || addOffset !== 0,
  };
}

function decodeRawValue(raw, variable, validity, packingInfo) {
  if (!Number.isFinite(raw)) return Number.NaN;
  if (validity.fill.some((value) => nearlyEqual(raw, value))) return Number.NaN;
  if (validity.missing.some((value) => nearlyEqual(raw, value))) return Number.NaN;
  if (validity.min != null && raw < validity.min) return Number.NaN;
  if (validity.max != null && raw > validity.max) return Number.NaN;
  const unpacked = raw * packingInfo.scaleFactor + packingInfo.addOffset;
  return Number.isFinite(unpacked) ? unpacked : Number.NaN;
}

function readVariableData(buffer, variable, recordStride, numRecords, isCancelled) {
  if (variable.type === 2) return null;
  const view = new DataView(buffer);
  const bytes = TYPE_BYTES[variable.type];
  const validity = rawValidity(variable);
  const packingInfo = packing(variable);
  const count = product(variable.shape);
  const out = new Float64Array(count);
  out.fill(Number.NaN);
  if (!variable.isRecord) {
    for (let i = 0; i < count; i += 1) {
      if ((i & 8191) === 0) abortIfNeeded(isCancelled);
      const raw = readValueAt(view, variable.begin + i * bytes, variable.type);
      out[i] = decodeRawValue(raw, variable, validity, packingInfo);
    }
    return { values: out, packing: packingInfo, validity };
  }
  const valuesPerRecord = product(variable.shape.slice(1));
  for (let record = 0; record < numRecords; record += 1) {
    abortIfNeeded(isCancelled);
    const base = variable.begin + record * recordStride;
    for (let i = 0; i < valuesPerRecord; i += 1) {
      const raw = readValueAt(view, base + i * bytes, variable.type);
      out[record * valuesPerRecord + i] = decodeRawValue(raw, variable, validity, packingInfo);
    }
  }
  return { values: out, packing: packingInfo, validity };
}

function recordStride(variables) {
  return variables.filter((variable) => variable.isRecord).reduce((sum, variable) => sum + Number(variable.vsize || 0), 0);
}

function semanticToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function coordinateScore(variable) {
  const token = semanticToken(variable.name);
  const units = String(variable.attributes?.units || '').toLowerCase();
  if (['lat', 'latitude'].includes(token) || /degrees?_?north/.test(units)) return 100;
  if (['lon', 'long', 'longitude'].includes(token) || /degrees?_?east/.test(units)) return 100;
  if (['depth', 'z', 'depsm'].includes(token) || String(variable.attributes?.positive || '').toLowerCase() === 'down') return 80;
  if (['time', 'date', 'datetime', 'timestamp'].includes(token) || /\bsince\b/.test(units)) return 90;
  return 0;
}

function isCoordinateVariable(variable) {
  return variable.dimensions.length === 1 && variable.dimensions[0] === variable.name;
}

function chooseMasterVariable(variables) {
  return variables
    .filter((variable) => variable.type !== 2 && variable.dimensions.length && !isCoordinateVariable(variable) && !coordinateScore(variable))
    .sort((a, b) => product(b.shape) - product(a.shape) || b.dimensions.length - a.dimensions.length)[0]
    || variables.filter((variable) => variable.type !== 2 && variable.dimensions.length).sort((a, b) => product(b.shape) - product(a.shape))[0]
    || null;
}

function stridesFor(shape) {
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i -= 1) strides[i] = strides[i + 1] * shape[i + 1];
  return strides;
}

function sameArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function broadcastToMaster(values, variable, masterDimensions, dimensionSizes, rowCount, isCancelled) {
  if (!values) return null;
  const masterShape = masterDimensions.map((name) => dimensionSizes.get(name) || 0);
  if (values.length === rowCount && sameArray(variable.dimensions, masterDimensions) && sameArray(variable.shape, masterShape)) {
    // V5.1: this array is already the canonical shape. Reuse it rather than
    // allocating an identical full-size broadcast copy.
    return values;
  }
  const masterStrides = stridesFor(masterShape);
  const sourceShape = variable.dimensions.map((name) => dimensionSizes.get(name) || 0);
  const sourceStrides = stridesFor(sourceShape);
  const sourcePositions = variable.dimensions.map((name) => masterDimensions.indexOf(name));
  if (sourcePositions.some((position) => position < 0)) return null;
  const out = new Float64Array(rowCount);
  out.fill(Number.NaN);
  for (let flat = 0; flat < rowCount; flat += 1) {
    if ((flat & 8191) === 0) abortIfNeeded(isCancelled);
    let sourceIndex = 0;
    for (let dim = 0; dim < sourcePositions.length; dim += 1) {
      const masterPosition = sourcePositions[dim];
      const index = Math.floor(flat / masterStrides[masterPosition]) % masterShape[masterPosition];
      sourceIndex += index * sourceStrides[dim];
    }
    out[flat] = values[sourceIndex] ?? Number.NaN;
  }
  return out;
}

function normalizedCalendar(calendar) {
  return String(calendar || '').trim().toLowerCase();
}

function calendarSafety(calendar) {
  const normalized = normalizedCalendar(calendar);
  if (GREGORIAN_CALENDARS.has(normalized)) return { supported: true, calendar: normalized || 'standard' };
  if (UNSUPPORTED_CALENDARS.has(normalized)) return { supported: false, calendar: normalized, reason: `NetCDF calendar "${normalized}" is not converted to Gregorian/UTC timestamps; time is kept as its native numeric value.` };
  return { supported: false, calendar: normalized || 'unknown', reason: `NetCDF calendar "${normalized || 'unknown'}" is not recognized for Gregorian timestamp conversion.` };
}

function parseCfTimeUnits(units) {
  const match = String(units || '').trim().match(/^(milliseconds?|seconds?|minutes?|hours?|days?)\s+since\s+(.+)$/i);
  if (!match) return null;
  // CF conventions: an origin without a zone is UTC. Date.parse would use the
  // viewer's local zone for "1970-01-01 00:00:00" and mis-read short years.
  const parsedOrigin = parseTimestamp(match[2].trim(), { cf: true });
  const origin = parsedOrigin?.ms;
  if (!Number.isFinite(origin)) return null;
  const unit = match[1].toLowerCase();
  const scale = unit.startsWith('millisecond') ? 1 : unit.startsWith('second') ? 1000 : unit.startsWith('minute') ? 60000 : unit.startsWith('hour') ? 3600000 : 86400000;
  return { origin, scale, originText: match[2].trim() };
}

function convertCfTimeInPlace(values, units, calendar) {
  const parsed = parseCfTimeUnits(units);
  if (!parsed || !values) return { values, converted: false, calendarSupported: true, calendar: normalizedCalendar(calendar) || 'standard' };
  const safety = calendarSafety(calendar);
  if (!safety.supported) return { values, converted: false, calendarSupported: false, calendar: safety.calendar, warning: safety.reason };
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(values[i])) values[i] = parsed.origin + values[i] * parsed.scale;
  }
  return { values, converted: true, calendarSupported: true, calendar: safety.calendar };
}

function statistics(values) {
  const state = createNumericStatistics();
  for (const value of values) pushNumericStatistic(state, value);
  return { ...finishNumericStatistics(state), histogram: histogramFromNumericValues(values) };
}

function candidateVariables(header, masterDimensions) {
  return header.variables.filter((variable) => (
    variable.type !== 2
    && variable.dimensions.every((name) => masterDimensions.includes(name))
  ));
}

export async function readNetcdf(source, {
  sourceId = null,
  contentId = null,
  fileName = source?.name || '',
  datasetFingerprint = null,
  isCancelled = () => false,
  onProgress = null,
} = {}) {
  abortIfNeeded(isCancelled);
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  onProgress?.({ stage: 'netcdf-header', loaded: 1, total: 4, percent: 10 });
  const header = parseHeader(buffer);
  const dimensionSizes = new Map(header.dimensions.map((dimension) => [dimension.name, dimension.size]));
  const stride = recordStride(header.variables);

  // V5.1 memory strategy: choose the master grid from header metadata first.
  // Only compatible variables are subsequently decoded, one at a time.
  const master = chooseMasterVariable(header.variables);
  if (!master) throw new Error('NetCDF file does not contain a numeric variable that can define a visualization grid.');
  const masterDimensions = master.dimensions.slice();
  const masterShape = masterDimensions.map((name) => dimensionSizes.get(name) || 0);
  const rowCount = product(masterShape);
  if (!rowCount) throw new Error('NetCDF visualization grid has zero observations.');

  const fields = [];
  const variables = [];
  const warnings = [];
  const provenance = [];
  const coordinateLevels = {};
  const includedVariables = [];
  const candidates = candidateVariables(header, masterDimensions);

  for (let i = 0; i < candidates.length; i += 1) {
    abortIfNeeded(isCancelled);
    const variable = candidates[i];
    const decoded = readVariableData(buffer, variable, stride, header.numRecords, isCancelled);
    if (!decoded) continue;
    let values = decoded.values;
    const units = variable.attributes?.units || null;
    const cfTime = parseCfTimeUnits(units);
    let timeInfo = null;
    if (cfTime) {
      timeInfo = convertCfTimeInPlace(values, units, variable.attributes?.calendar);
      values = timeInfo.values;
      if (timeInfo.converted) {
        provenance.push({ step: 'read', role: 'time', variable: variable.name, operation: 'netcdf-cf-time-to-epoch-ms', approximate: false });
      } else if (!timeInfo.calendarSupported) {
        warnings.push(`${timeInfo.warning} Numeric coordinate values were preserved without fake Gregorian conversion.`);
        provenance.push({ step: 'read', role: 'time', variable: variable.name, operation: 'netcdf-calendar-preserved-without-gregorian-conversion', approximate: false });
      }
    }
    if (decoded.packing.applied) {
      provenance.push({
        step: 'read',
        role: 'packing',
        variable: variable.name,
        operation: 'netcdf-scale-factor-add-offset-unpack',
        approximate: false,
        detail: `scale_factor=${decoded.packing.scaleFactor}; add_offset=${decoded.packing.addOffset}`,
      });
    }

    const broadcast = broadcastToMaster(values, variable, masterDimensions, dimensionSizes, rowCount, isCancelled);
    if (!broadcast) continue;
    const stats = statistics(broadcast);
    const key = `field_${fields.length}`;
    const field = {
      key,
      index: fields.length,
      originalName: variable.name,
      normalizedName: variable.name,
      unit: timeInfo?.converted ? 'ms since 1970-01-01T00:00:00Z' : units,
      description: variable.attributes?.long_name || variable.attributes?.standard_name || null,
      type: 'number',
      values: broadcast,
      missingCount: stats.missingCount,
      statistics: stats,
      dimensions: variable.dimensions.slice(),
      shape: variable.shape.slice(),
      netcdfType: variable.typeName,
      netcdfAttributes: variable.attributes,
      netcdfTime: cfTime ? {
        originalUnit: units,
        calendar: timeInfo?.calendar || normalizedCalendar(variable.attributes?.calendar) || 'standard',
        normalized: Boolean(timeInfo?.converted),
        calendarSupported: timeInfo?.calendarSupported !== false,
      } : null,
    };
    fields.push(field);
    variables.push({ fieldKey: key, name: variable.name, originalName: variable.name, unit: field.unit, type: 'numeric', statistics: stats });
    includedVariables.push({ name: variable.name, fieldKey: key, dimensions: variable.dimensions.slice(), shape: variable.shape.slice(), unit: field.unit, attributes: variable.attributes });

    if (isCoordinateVariable(variable)) {
      coordinateLevels[variable.name] = {
        fieldKey: key,
        dimension: variable.name,
        values: Array.from(values || []),
        unit: field.unit,
        originalUnit: units,
        calendar: field.netcdfTime?.calendar || null,
        timeNormalized: field.netcdfTime ? field.netcdfTime.normalized : null,
        calendarSupported: field.netcdfTime ? field.netcdfTime.calendarSupported : null,
      };
    }
    onProgress?.({ stage: 'netcdf-canonical', loaded: i + 1, total: candidates.length, percent: 10 + Math.round(((i + 1) / Math.max(1, candidates.length)) * 85) });
  }

  for (const variable of header.variables) {
    if (variable.type === 2 || variable.dimensions.some((name) => !masterDimensions.includes(name))) {
      warnings.push(`NetCDF variable "${variable.name}" was preserved in metadata but not flattened because its dimensions are incompatible with the selected visualization grid.`);
    }
  }

  const sourceMeta = {
    netcdf: {
      format: header.version === 1 ? 'CDF-1 classic' : 'CDF-2 64-bit-offset',
      version: header.version,
      numRecords: header.numRecords,
      globalAttributes: header.globalAttributes,
      dimensions: header.dimensions.map((dimension) => ({
        ...dimension,
        values: coordinateLevels[dimension.name]?.values || null,
        unit: coordinateLevels[dimension.name]?.unit || null,
      })),
      variables: header.variables.map((variable) => ({
        name: variable.name,
        dimensions: variable.dimensions.slice(),
        shape: variable.shape.slice(),
        type: variable.typeName,
        unit: variable.attributes?.units || null,
        attributes: variable.attributes,
      })),
      includedVariables,
      masterVariable: master.name,
      masterDimensions,
      masterShape,
      coordinateLevels,
    },
  };
  provenance.push({ step: 'read', role: 'structure', operation: `netcdf-v3-${header.version === 1 ? 'classic' : '64-bit-offset'}-canonicalization`, approximate: false });
  onProgress?.({ stage: 'complete', loaded: 4, total: 4, percent: 100 });
  return createCanonicalDataset({ sourceId, contentId, fileName, datasetFingerprint, fields, rowCount, variables, warnings, provenance, sourceMeta });
}

export {
  DEFAULT_FILL_VALUES,
  calendarSafety,
  convertCfTimeInPlace,
  packing,
  statistics,
  parseHeader as parseNetcdfHeader,
  parseCfTimeUnits,
};
