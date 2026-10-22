import { normalizedFieldToken } from './detection.js';
import { evaluateCapabilities } from './capabilities.js';
import {
  createNumericStatistics,
  finishNumericStatistics,
  histogramFromNumericValues,
  pushNumericStatistic,
} from './statistics.js';
import { finiteSpatialValue } from './spatialEvidence.js';

function normalizeUnit(unit) {
  return String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/degrees?/g, 'deg')
    .replace(/metres?|meters?/g, 'm');
}

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function variableDescriptors(dataset) {
  return (dataset?.visualVariables || []).map((variable) => {
    const field = fieldByKey(dataset, variable.fieldKey);
    return {
      fieldKey: variable.fieldKey,
      token: normalizedFieldToken(field || variable),
      unit: normalizeUnit(variable.unit || field?.unit),
      unitDisplay: variable.unit || field?.unit || null,
      field,
      variable,
    };
  }).filter((entry) => entry.token && entry.field?.type === 'number');
}

function descriptorMap(dataset) {
  return new Map(variableDescriptors(dataset).map((entry) => [`${entry.token}|${entry.unit}`, entry]));
}

export function assessMergeCompatibility(base, candidate) {
  if (!base || !candidate) return { compatible: false, reasons: ['Both prepared datasets are required.'] };
  const reasons = [];
  const baseVertical = base.vertical?.kind || null;
  const candidateVertical = candidate.vertical?.kind || null;
  if (baseVertical !== candidateVertical) {
    reasons.push(`Vertical coordinates differ (${baseVertical || 'none'} vs ${candidateVertical || 'none'}).`);
  }
  if (baseVertical && normalizeUnit(base.vertical?.unit) !== normalizeUnit(candidate.vertical?.unit)) {
    reasons.push(`Vertical units differ (${base.vertical?.unit || 'unspecified'} vs ${candidate.vertical?.unit || 'unspecified'}).`);
  }

  const left = descriptorMap(base);
  const right = descriptorMap(candidate);
  const leftKeys = [...left.keys()].sort();
  const rightKeys = [...right.keys()].sort();
  if (!leftKeys.length || !rightKeys.length) reasons.push('Both datasets must contain numeric visualization variables.');
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    const baseNames = variableDescriptors(base).map((entry) => `${entry.token}${entry.unit ? ` [${entry.unit}]` : ''}`);
    const candidateNames = variableDescriptors(candidate).map((entry) => `${entry.token}${entry.unit ? ` [${entry.unit}]` : ''}`);
    reasons.push(`Visualization variable/unit sets differ (${baseNames.join(', ') || 'none'} vs ${candidateNames.join(', ') || 'none'}).`);
  }
  return { compatible: reasons.length === 0, reasons };
}

function concatNumeric(length, sources) {
  const out = new Float64Array(length);
  out.fill(Number.NaN);
  let offset = 0;
  for (const values of sources) {
    if (values) {
      const count = Math.min(values.length, length - offset);
      for (let i = 0; i < count; i += 1) {
        const value = Number(values[i]);
        out[offset + i] = Number.isFinite(value) ? value : Number.NaN;
      }
    }
    offset += values?.length || 0;
  }
  return out;
}

function fillCastCoordinates(dataset, lat, lon, offset) {
  for (const cast of dataset?.casts || []) {
    const latitude = finiteSpatialValue(cast.latitude);
    const longitude = finiteSpatialValue(cast.longitude);
    if (latitude == null || longitude == null) continue;
    const segments = Array.isArray(cast.segments) && cast.segments.length
      ? cast.segments
      : [{ rowStart: cast.rowStart, rowEnd: cast.rowEnd }];
    for (const segment of segments) {
      const start = Math.max(0, Number(segment.rowStart) || 0);
      const end = Math.min(dataset.rowCount - 1, Number(segment.rowEnd ?? segment.rowStart) || 0);
      for (let row = start; row <= end; row += 1) {
        const index = offset + row;
        if (!Number.isFinite(lat[index])) lat[index] = latitude;
        if (!Number.isFinite(lon[index])) lon[index] = longitude;
      }
    }
  }
}

function mergeCoordinateRole(datasets, role, totalRows) {
  const out = new Float64Array(totalRows);
  out.fill(Number.NaN);
  let offset = 0;
  for (const dataset of datasets) {
    const values = dataset?.normalizedCoords?.[role];
    if (values) {
      for (let i = 0; i < dataset.rowCount; i += 1) {
        const value = Number(values[i]);
        out[offset + i] = Number.isFinite(value) ? value : Number.NaN;
      }
    }
    offset += dataset.rowCount || 0;
  }
  return out;
}

function mergeStation(datasets, totalRows) {
  const out = new Array(totalRows).fill(null);
  let offset = 0;
  for (const dataset of datasets) {
    const values = dataset?.normalizedCoords?.station;
    if (values) for (let i = 0; i < dataset.rowCount; i += 1) out[offset + i] = values[i] ?? null;
    offset += dataset.rowCount || 0;
  }
  return out;
}

function statsFor(values) {
  const state = createNumericStatistics();
  for (const value of values) pushNumericStatistic(state, value);
  return { ...finishNumericStatistics(state), histogram: histogramFromNumericValues(values) };
}

function shiftedCast(cast, offset, sourceIndex, sourceCastIndex, sourceDataset) {
  const shiftSegment = (segment) => ({
    rowStart: offset + Number(segment.rowStart || 0),
    rowEnd: offset + Number(segment.rowEnd ?? segment.rowStart ?? 0),
  });
  const segments = Array.isArray(cast.segments) && cast.segments.length
    ? cast.segments.map(shiftSegment)
    : null;
  return {
    ...cast,
    id: `source-${sourceIndex + 1}:${cast.id || 'cast'}`,
    rowStart: offset + Number(cast.rowStart || 0),
    rowEnd: offset + Number(cast.rowEnd ?? cast.rowStart ?? 0),
    ...(segments ? { segments } : {}),
    sourceDatasetIndex: sourceIndex,
    sourceCastIndex,
    sourceContentId: sourceDataset.contentId || null,
    sourceFileName: sourceDataset.fileName || null,
  };
}

export function mergeCompatibleDatasets(datasets = []) {
  const list = datasets.filter(Boolean);
  if (!list.length) throw new Error('At least one prepared scientific dataset is required.');
  const base = list[0];
  for (let index = 1; index < list.length; index += 1) {
    const assessment = assessMergeCompatibility(base, list[index]);
    if (!assessment.compatible) {
      throw new Error(`Dataset ${list[index].fileName || index + 1} is not scientifically merge-compatible: ${assessment.reasons.join(' ')}`);
    }
  }

  const totalRows = list.reduce((sum, dataset) => sum + Number(dataset.rowCount || 0), 0);
  const baseDescriptors = variableDescriptors(base);
  const candidateMaps = list.map(descriptorMap);
  const fields = [];
  const variables = [];

  for (const descriptor of baseDescriptors) {
    const signature = `${descriptor.token}|${descriptor.unit}`;
    const sourceValues = candidateMaps.map((map) => map.get(signature)?.field?.values || null);
    const values = concatNumeric(totalRows, sourceValues);
    const statistics = statsFor(values);
    const field = {
      ...descriptor.field,
      values,
      missingCount: statistics.missingCount,
      statistics,
    };
    fields.push(field);
    variables.push({
      ...descriptor.variable,
      fieldKey: field.key,
      unit: descriptor.unitDisplay,
      statistics,
    });
  }

  const lat = mergeCoordinateRole(list, 'lat', totalRows);
  const lon = mergeCoordinateRole(list, 'lon', totalRows);
  const depth = mergeCoordinateRole(list, 'depth', totalRows);
  const pressure = mergeCoordinateRole(list, 'pressure', totalRows);
  const time = mergeCoordinateRole(list, 'time', totalRows);
  const station = mergeStation(list, totalRows);

  let offset = 0;
  const casts = [];
  list.forEach((dataset, sourceIndex) => {
    fillCastCoordinates(dataset, lat, lon, offset);
    (dataset?.casts || []).forEach((cast, sourceCastIndex) => {
      casts.push(shiftedCast(cast, offset, sourceIndex, sourceCastIndex, dataset));
    });
    offset += dataset.rowCount || 0;
  });

  const warnings = [
    ...new Set(list.flatMap((dataset) => dataset.warnings || [])),
    `Merged ${list.length} compatible dataset${list.length === 1 ? '' : 's'} for multi-cast spatial analysis. Variables and units were required to match exactly.`,
  ];
  const provenance = [
    ...list.flatMap((dataset) => dataset.provenance || []),
    { step: 'merge', role: 'multi-cast', operation: 'compatible-dataset-concatenation', approximate: false },
    { step: 'derive', role: 'spatial', operation: 'cast-header-coordinate-propagation-to-cast-rows', approximate: false },
  ];
  const merged = {
    ...base,
    sourceId: `merged:${list.map((dataset) => dataset.contentId || dataset.sourceId || dataset.fileName).join('+')}`,
    contentId: null,
    fileName: list.length === 1 ? base.fileName : `${base.fileName || 'dataset'} + ${list.length - 1} compatible source${list.length === 2 ? '' : 's'}`,
    datasetFingerprint: `merged:${list.map((dataset) => dataset.datasetFingerprint || dataset.contentId || dataset.fileName).join('|')}`,
    rowCount: totalRows,
    fields,
    variables,
    visualVariables: variables,
    normalizedCoords: {
      lat,
      lon,
      depth,
      pressure,
      time,
      timeNormalized: list.every((dataset) => dataset?.normalizedCoords?.timeNormalized !== false),
      timeMode: list.every((dataset) => dataset?.normalizedCoords?.timeMode === 'epoch-ms') ? 'epoch-ms' : base?.normalizedCoords?.timeMode || null,
      station,
    },
    casts,
    warnings,
    provenance,
    isMerged: list.length > 1,
    sourceDatasets: list.map((dataset) => ({
      contentId: dataset.contentId || null,
      fileName: dataset.fileName || null,
      rowCount: dataset.rowCount || 0,
      datasetFingerprint: dataset.datasetFingerprint || null,
    })),
  };
  merged.capabilities = evaluateCapabilities(merged);
  return merged;
}

export { normalizeUnit as normalizeMergeUnit };

export function describeV4Dataset(dataset, variableKey = null) {
  const variable = variableKey ? fieldByKey(dataset, variableKey) : null;
  const sourceDatasets = Array.isArray(dataset?.sourceDatasets) && dataset.sourceDatasets.length
    ? dataset.sourceDatasets
    : [{ fileName: dataset?.fileName || null, rowCount: dataset?.rowCount || 0 }];
  return {
    merged: Boolean(dataset?.isMerged),
    sourceCount: sourceDatasets.length,
    sourceFileNames: sourceDatasets.map((source) => source.fileName).filter(Boolean),
    rowCount: Number(dataset?.rowCount || 0),
    castCount: Array.isArray(dataset?.casts) ? dataset.casts.length : 0,
    variableStatistics: variable?.statistics || null,
    warnings: [...(dataset?.warnings || [])],
    provenance: [...(dataset?.provenance || [])],
  };
}
