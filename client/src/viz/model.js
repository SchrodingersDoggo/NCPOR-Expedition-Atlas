import {
  inferValueKind,
  isMissingValue,
  makeUniqueHeaders,
  normalizeScalar,
  toFiniteNumber,
} from './normalize.js';
import {
  createNumericStatistics,
  finishNumericStatistics,
  pushNumericStatistic,
  histogramFromNumericValues,
} from './statistics.js';

function normalizeColumnDefinition(header, index, meta = {}) {
  return {
    key: `field_${index}`,
    index,
    originalName: String(meta.originalName ?? header ?? `column_${index + 1}`),
    normalizedName: String(meta.normalizedName ?? header ?? `column_${index + 1}`).trim(),
    unit: meta.unit ?? null,
    description: meta.description ?? null,
  };
}

export function createCanonicalDataset({
  sourceId = null,
  contentId = null,
  fileName = '',
  datasetFingerprint = null,
  fields = [],
  rowCount = 0,
  variables = [],
  casts = [],
  ignored = [],
  warnings = [],
  provenance = [],
  sourceMeta = {},
} = {}) {
  return {
    sourceId,
    contentId,
    fileName,
    datasetFingerprint,
    rowCount,
    fields,
    coords: {
      lat: null,
      lon: null,
      depth: null,
      pressure: null,
      time: null,
      station: null,
    },
    variables,
    casts,
    ignored,
    warnings,
    provenance,
    sourceMeta,
  };
}

export function canonicalFromRows(headers, rows, {
  sourceId = null,
  contentId = null,
  fileName = '',
  datasetFingerprint = null,
  fieldMeta = [],
  badFlag = null,
  warnings = [],
  provenance = [],
  casts = [],
  sourceMeta = {},
  isCancelled = () => false,
  onProgress = null,
} = {}) {
  const uniqueHeaders = makeUniqueHeaders(headers);
  const width = uniqueHeaders.length;
  const columns = Array.from({ length: width }, () => []);
  const total = rows.length || 1;

  rows.forEach((row, rowIndex) => {
    if (isCancelled()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');
    for (let col = 0; col < width; col += 1) columns[col].push(row?.[col] ?? null);
    if (onProgress && (rowIndex % 5000 === 0 || rowIndex === rows.length - 1)) {
      onProgress({ stage: 'normalize', loaded: rowIndex + 1, total: rows.length, percent: Math.round(((rowIndex + 1) / total) * 100) });
    }
  });

  return canonicalFromColumns(uniqueHeaders, columns, {
    sourceId, contentId, fileName, datasetFingerprint, fieldMeta, badFlag,
    warnings, provenance, casts, sourceMeta, rowCount: rows.length,
  });
}

// Column-oriented variant used by readers that can decode straight into typed
// arrays (e.g. Sea-Bird CNV). A typed-array column is always numeric; this
// avoids holding every row as an array of strings for large files.
export function canonicalFromColumns(headers, columns, {
  sourceId = null,
  contentId = null,
  fileName = '',
  datasetFingerprint = null,
  fieldMeta = [],
  badFlag = null,
  warnings = [],
  provenance = [],
  casts = [],
  sourceMeta = {},
  rowCount = null,
} = {}) {
  const uniqueHeaders = makeUniqueHeaders(headers);
  const width = uniqueHeaders.length;
  const totalRows = rowCount ?? (columns[0]?.length || 0);

  const fields = [];
  const variables = [];

  for (let index = 0; index < width; index += 1) {
    const definition = normalizeColumnDefinition(uniqueHeaders[index], index, fieldMeta[index]);
    const rawValues = columns[index] || [];
    const kind = ArrayBuffer.isView(rawValues) ? 'number' : inferValueKind(rawValues, { badFlag });

    if (kind === 'number') {
      // Decode in place when the reader already produced a Float64Array.
      const values = rawValues instanceof Float64Array ? rawValues : new Float64Array(rawValues.length);
      const statsState = createNumericStatistics();
      for (let i = 0; i < rawValues.length; i += 1) {
        const numeric = toFiniteNumber(rawValues[i], { badFlag });
        values[i] = numeric == null ? Number.NaN : numeric;
        pushNumericStatistic(statsState, values[i]);
      }
      const statistics = { ...finishNumericStatistics(statsState), histogram: histogramFromNumericValues(values) };
      const field = {
        ...definition,
        type: 'number',
        values,
        missingCount: statistics.missingCount,
        statistics,
      };
      fields.push(field);
      variables.push({
        fieldKey: field.key,
        name: field.normalizedName,
        originalName: field.originalName,
        unit: field.unit,
        type: 'numeric',
        statistics,
      });
    } else {
      const values = rawValues.map((value) => normalizeScalar(value, { badFlag }));
      const missingCount = values.reduce((count, value) => count + (value == null ? 1 : 0), 0);
      fields.push({
        ...definition,
        type: kind,
        values,
        missingCount,
        statistics: null,
      });
    }
  }

  return createCanonicalDataset({
    sourceId,
    contentId,
    fileName,
    datasetFingerprint,
    fields,
    rowCount: totalRows,
    variables,
    casts,
    ignored: [],
    warnings,
    provenance,
    sourceMeta,
  });
}

export function canonicalPreviewRows(dataset, limit = 20) {
  const count = Math.max(0, Math.min(Number(limit) || 0, dataset?.rowCount || 0));
  const fields = dataset?.fields || [];
  return Array.from({ length: count }, (_, rowIndex) => fields.map((field) => {
    const value = field.values?.[rowIndex];
    if (field.type === 'number' && Number.isNaN(value)) return null;
    return value ?? null;
  }));
}

export function fieldMissingRatio(field, rowCount) {
  if (!rowCount) return 0;
  return Math.min(1, Math.max(0, Number(field?.missingCount || 0) / rowCount));
}

export function hasMeaningfulFieldData(field) {
  if (!field?.values) return false;
  if (field.type === 'number') return field.values.some((value) => Number.isFinite(value));
  return field.values.some((value) => !isMissingValue(value));
}
