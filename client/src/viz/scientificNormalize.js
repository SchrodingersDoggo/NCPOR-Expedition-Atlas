import { parseUnitFromField } from './detection.js';
import { parseTimestamp, slashDateOrder } from './timeParse.js';

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function numericArray(field, transform = (value) => value) {
  if (!field?.values) return null;
  const out = new Float64Array(field.values.length);
  for (let i = 0; i < field.values.length; i += 1) {
    const raw = Number(field.values[i]);
    out[i] = Number.isFinite(raw) ? transform(raw) : Number.NaN;
  }
  return out;
}

function normalizeLatitude(field, warnings) {
  return numericArray(field, (value) => {
    if (value < -90 || value > 90) return Number.NaN;
    return value;
  });
}

function normalizeLongitude(field, warnings, provenance) {
  let converted = 0;
  const values = numericArray(field, (value) => {
    if (value < -180 || value > 360) return Number.NaN;
    if (value > 180) { converted += 1; return value - 360; }
    return value;
  });
  if (converted) {
    warnings.push(`Normalized ${converted} longitude value${converted === 1 ? '' : 's'} from 0–360 to -180–180.`);
    provenance.push({ step: 'normalize', role: 'lon', operation: '0-360-to--180-180', approximate: false });
  }
  return values;
}

function normalizeDepth(field, warnings, provenance) {
  if (!field?.values) return null;
  let negative = 0;
  let positive = 0;
  for (const raw of field.values) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value === 0) continue;
    if (value < 0) negative += 1;
    else positive += 1;
  }
  const populated = negative + positive;
  const mostlyNegative = populated >= 2 && negative / populated >= 0.8;
  const mixed = populated >= 2 && negative > 0 && positive > 0 && !mostlyNegative;
  if (mostlyNegative) {
    warnings.push('Depth values were predominantly negative; normalized to positive-down depth.');
    provenance.push({ step: 'normalize', role: 'depth', operation: 'negative-to-positive-down', approximate: true });
    return numericArray(field, (value) => Math.abs(value));
  }
  if (mixed) warnings.push('Depth values contain mixed signs; values were preserved because the sign convention is ambiguous.');
  return numericArray(field);
}

function normalizeTime(field, warnings, provenance) {
  if (!field?.values) return { values: null, normalized: false, mode: null };
  const values = field.values;

  // NetCDF special calendars must not be reinterpreted from numeric magnitude as
  // Unix time after the reader intentionally preserved their native coordinate.
  if (field?.netcdfTime?.calendarSupported === false) {
    return { values: numericArray(field), normalized: false, mode: `netcdf-calendar:${field.netcdfTime.calendar || 'unsupported'}` };
  }

  if (field.type !== 'number') {
    const out = new Float64Array(values.length);
    // Day/month order for slash dates is decided once for the whole column,
    // from values such as 25/03/2024 that can only be read one way.
    const slash = slashDateOrder(values);
    let parsed = 0;
    let assumedUtc = 0;
    let ambiguous = 0;
    for (let i = 0; i < values.length; i += 1) {
      const result = parseTimestamp(values[i], { order: slash.order });
      const time = result?.ms;
      out[i] = Number.isFinite(time) ? time : Number.NaN;
      if (Number.isFinite(time)) {
        parsed += 1;
        if (result.assumedUtc) assumedUtc += 1;
      } else if (result?.ambiguousOrder) {
        ambiguous += 1;
      }
    }
    if (slash.state === 'resolved') {
      warnings.push(slash.order === 'dmy'
        ? 'Slash dates were read as day/month/year (DD/MM/YYYY) because the column contains values whose day is above 12.'
        : 'Slash dates were read as month/day/year (MM/DD/YYYY) because the column contains values whose day is above 12.');
    }
    if (ambiguous) {
      warnings.push(slash.state === 'conflict'
        ? `${ambiguous.toLocaleString()} time value${ambiguous === 1 ? '' : 's'} could not be dated: the column mixes day/month and month/day order. Convert dates to ISO 8601 (YYYY-MM-DD).`
        : `${ambiguous.toLocaleString()} time value${ambiguous === 1 ? '' : 's'} such as 03/04/2024 are ambiguous (day/month order unknown) and were not converted. Convert dates to ISO 8601 (YYYY-MM-DD) to enable time views.`);
    }
    if (assumedUtc) {
      warnings.push(`${assumedUtc.toLocaleString()} timestamp${assumedUtc === 1 ? '' : 's'} had no time-zone designator and were interpreted as UTC.`);
    }
    if (parsed) {
      provenance.push({
        step: 'normalize',
        role: 'time',
        operation: assumedUtc ? 'parse-to-epoch-ms (offset-less times as UTC)' : 'parse-to-epoch-ms',
        approximate: assumedUtc > 0 || slash.state === 'resolved',
      });
    }
    return { values: out, normalized: parsed > 0, mode: 'epoch-ms' };
  }

  const finiteSample = [];
  for (const value of values) {
    if (Number.isFinite(value)) finiteSample.push(value);
    if (finiteSample.length >= 64) break;
  }
  if (!finiteSample.length) return { values: numericArray(field), normalized: false, mode: 'numeric-unknown' };
  finiteSample.sort((a, b) => a - b);
  const probe = finiteSample[Math.floor(finiteSample.length / 2)];
  if (probe >= 1e11 && probe <= 5e13) return { values: numericArray(field), normalized: true, mode: 'epoch-ms' };
  if (probe >= 1e8 && probe <= 5e9) {
    warnings.push('Numeric time values were interpreted as Unix seconds from their magnitude and converted to milliseconds.');
    provenance.push({ step: 'normalize', role: 'time', operation: 'unix-seconds-to-ms', approximate: true });
    return { values: numericArray(field, (value) => value * 1000), normalized: true, mode: 'epoch-ms' };
  }
  warnings.push('Numeric time values have no recognized timestamp unit; they were retained without timestamp conversion.');
  return { values: numericArray(field), normalized: false, mode: 'numeric-unknown' };
}

function normalizeStation(field) {
  if (!field?.values) return null;
  return Array.from(field.values, (value) => value == null || Number.isNaN(value) ? null : String(value).trim());
}

export function normalizeScientificDataset(dataset, mapping, detection = null) {
  const warnings = [...(dataset?.warnings || [])];
  const provenance = [...(dataset?.provenance || [])];
  const roles = mapping?.roles || {};
  const latField = fieldByKey(dataset, roles.lat);
  const lonField = fieldByKey(dataset, roles.lon);
  const depthField = fieldByKey(dataset, roles.depth);
  const pressureField = fieldByKey(dataset, roles.pressure);
  const timeField = fieldByKey(dataset, roles.time);
  const stationField = fieldByKey(dataset, roles.station);

  const time = normalizeTime(timeField, warnings, provenance);
  const normalizedCoords = {
    lat: normalizeLatitude(latField, warnings),
    lon: normalizeLongitude(lonField, warnings, provenance),
    depth: normalizeDepth(depthField, warnings, provenance),
    pressure: numericArray(pressureField),
    time: time.values,
    timeNormalized: time.normalized,
    timeMode: time.mode,
    station: normalizeStation(stationField),
  };

  if (!depthField && pressureField) {
    warnings.push('Pressure is available as the vertical coordinate; no automatic pressure-to-depth conversion was applied.');
  }

  const fieldMeta = Object.fromEntries((dataset?.fields || []).map((field) => {
    const unit = detection?.units?.[field.key] || parseUnitFromField(field);
    return [field.key, {
      classification: detection?.classifications?.[field.key] || (field.type === 'number' ? 'numeric' : 'categorical'),
      action: mapping?.fields?.[field.key] || 'variable',
      unit: unit.unit,
      unitSource: unit.source,
    }];
  }));
  const fields = (dataset?.fields || []).map((field) => ({
    ...field,
    unit: field.unit || fieldMeta[field.key]?.unit || null,
  }));
  const variables = (dataset?.variables || []).map((variable) => ({
    ...variable,
    unit: variable.unit || fieldMeta[variable.fieldKey]?.unit || null,
  }));
  const coordinateKeys = new Set(Object.values(roles).filter(Boolean));
  const visualVariables = variables.filter((variable) => (
    mapping?.fields?.[variable.fieldKey] === 'variable'
    && !coordinateKeys.has(variable.fieldKey)
  ));

  return {
    ...dataset,
    fields,
    variables,
    visualVariables,
    coords: {
      lat: roles.lat || null,
      lon: roles.lon || null,
      depth: roles.depth || null,
      pressure: roles.pressure || null,
      time: roles.time || null,
      station: roles.station || null,
    },
    normalizedCoords,
    vertical: depthField
      ? { kind: 'depth', fieldKey: depthField.key, unit: fieldMeta[depthField.key]?.unit || depthField.unit || null }
      : pressureField
        ? { kind: 'pressure', fieldKey: pressureField.key, unit: fieldMeta[pressureField.key]?.unit || pressureField.unit || null }
        : null,
    mapping,
    fieldMeta,
    warnings,
    provenance,
  };
}
