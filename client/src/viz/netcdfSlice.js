import { evaluateCapabilities } from './capabilities.js';
import { createNumericStatistics, finishNumericStatistics, histogramFromNumericValues, pushNumericStatistic } from './statistics.js';

function fieldByKey(dataset, key) { return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null; }

function uniqueFinite(values, max = 5000) {
  const out = []; const seen = new Set();
  for (const raw of values || []) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const key = Number(value.toPrecision(12));
    if (seen.has(key)) continue;
    seen.add(key); out.push(value);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a - b);
}

function originalCoordinateLevels(nc, fieldKey) {
  if (!nc?.coordinateLevels || !fieldKey) return null;
  for (const entry of Object.values(nc.coordinateLevels)) {
    if (entry?.fieldKey === fieldKey && Array.isArray(entry.values)) return entry;
  }
  return null;
}

function finiteSourceLevels(entry) {
  if (!entry?.values) return null;
  const out = [];
  const seen = new Set();
  for (const raw of entry.values) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const key = Number(value.toPrecision(12));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function netcdfDimensionControls(dataset) {
  const nc = dataset?.sourceMeta?.netcdf;
  if (!nc) return { isNetcdf: false, timeLevels: [], depthLevels: [], timeFieldKey: null, depthFieldKey: null };
  const timeField = fieldByKey(dataset, dataset?.coords?.time);
  const depthField = fieldByKey(dataset, dataset?.coords?.depth);
  const pressureField = fieldByKey(dataset, dataset?.coords?.pressure);
  const verticalField = depthField || pressureField;
  const timeCoordinate = originalCoordinateLevels(nc, dataset?.coords?.time);
  const verticalCoordinate = originalCoordinateLevels(nc, dataset?.coords?.depth || dataset?.coords?.pressure);
  const timeSliderEnabled = timeCoordinate
    ? timeCoordinate.calendarSupported !== false && timeCoordinate.timeNormalized !== false
    : Boolean(dataset?.normalizedCoords?.timeNormalized);

  const sourceVerticalLevels = finiteSourceLevels(verticalCoordinate);
  const depthWasFlipped = dataset?.vertical?.kind === 'depth' && (dataset?.provenance || []).some((entry) => entry?.role === 'depth' && entry?.operation === 'negative-to-positive-down');
  const normalizedSourceVerticalLevels = sourceVerticalLevels
    ? (depthWasFlipped ? sourceVerticalLevels.map((value) => Math.abs(value)) : sourceVerticalLevels)
    : null;

  return {
    isNetcdf: true,
    // Coordinate metadata is the source of truth and has no 5000-unique scan cap.
    // Flattened-array scanning remains only as a fallback for auxiliary coordinates.
    timeLevels: timeSliderEnabled
      ? (finiteSourceLevels(timeCoordinate) || uniqueFinite(dataset?.normalizedCoords?.time || timeField?.values))
      : [],
    depthLevels: normalizedSourceVerticalLevels
      || uniqueFinite(dataset?.normalizedCoords?.depth || dataset?.normalizedCoords?.pressure || depthField?.values || pressureField?.values),
    timeFieldKey: dataset?.coords?.time || null,
    depthFieldKey: dataset?.coords?.depth || dataset?.coords?.pressure || null,
    verticalKind: dataset?.vertical?.kind || null,
    timeUnit: timeField?.unit || null,
    depthUnit: verticalField?.unit || dataset?.vertical?.unit || null,
    timeSliderEnabled,
    timeCalendar: timeCoordinate?.calendar || timeField?.netcdfTime?.calendar || null,
    timeCoordinateLevels: timeCoordinate?.values || null,
  };
}

function makeStats(values) {
  const state = createNumericStatistics();
  for (const value of values) pushNumericStatistic(state, value);
  return { ...finishNumericStatistics(state), histogram: histogramFromNumericValues(values) };
}

function subsetValues(values, indexes, numeric) {
  if (numeric) {
    const out = new Float64Array(indexes.length);
    for (let i = 0; i < indexes.length; i += 1) out[i] = values[indexes[i]];
    return out;
  }
  return indexes.map((index) => values[index] ?? null);
}

export function sliceNetcdfDataset(dataset, { time = null, depth = null } = {}) {
  if (!dataset?.sourceMeta?.netcdf) return dataset;
  const timeValues = dataset?.normalizedCoords?.time;
  const verticalValues = dataset?.vertical?.kind === 'depth' ? dataset?.normalizedCoords?.depth : dataset?.normalizedCoords?.pressure;
  const indexes = [];
  const timeTolerance = 1;
  const depthTolerance = depth == null ? 0 : Math.max(1e-9, Math.abs(Number(depth)) * 1e-9);
  for (let i = 0; i < dataset.rowCount; i += 1) {
    if (time != null && (!timeValues || !Number.isFinite(timeValues[i]) || Math.abs(timeValues[i] - Number(time)) > timeTolerance)) continue;
    if (depth != null && (!verticalValues || !Number.isFinite(verticalValues[i]) || Math.abs(verticalValues[i] - Number(depth)) > depthTolerance)) continue;
    indexes.push(i);
  }
  if (!indexes.length) return { ...dataset, rowCount: 0, fields: dataset.fields.map((field) => ({ ...field, values: field.type === 'number' ? new Float64Array(0) : [], statistics: field.type === 'number' ? makeStats([]) : null })), slice: { time, depth, sourceRowCount: dataset.rowCount } };
  const fields = dataset.fields.map((field) => {
    const values = subsetValues(field.values, indexes, field.type === 'number');
    const statistics = field.type === 'number' ? makeStats(values) : null;
    return { ...field, values, missingCount: statistics?.missingCount ?? field.missingCount, statistics };
  });
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const variables = (dataset.variables || []).map((variable) => ({ ...variable, statistics: byKey.get(variable.fieldKey)?.statistics || variable.statistics }));
  const visualVariables = (dataset.visualVariables || []).map((variable) => ({ ...variable, statistics: byKey.get(variable.fieldKey)?.statistics || variable.statistics }));
  const subsetCoord = (values) => values ? subsetValues(values, indexes, ArrayBuffer.isView(values)) : null;
  const sliced = {
    ...dataset,
    fields,
    variables,
    visualVariables,
    rowCount: indexes.length,
    normalizedCoords: {
      ...dataset.normalizedCoords,
      lat: subsetCoord(dataset.normalizedCoords?.lat),
      lon: subsetCoord(dataset.normalizedCoords?.lon),
      depth: subsetCoord(dataset.normalizedCoords?.depth),
      pressure: subsetCoord(dataset.normalizedCoords?.pressure),
      time: subsetCoord(dataset.normalizedCoords?.time),
      station: dataset.normalizedCoords?.station ? indexes.map((index) => dataset.normalizedCoords.station[index] ?? null) : null,
    },
    slice: { time, depth, sourceRowCount: dataset.rowCount },
  };
  sliced.capabilities = evaluateCapabilities(sliced);
  return sliced;
}
