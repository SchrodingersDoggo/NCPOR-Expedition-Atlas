import Papa from 'papaparse';
import { createCanonicalDataset } from '../model.js';
import {
  inferValueKind,
  isMissingValue,
  makeUniqueHeaders,
  normalizeScalar,
  toFiniteNumber,
} from '../normalize.js';
import {
  createNumericStatistics,
  finishNumericStatistics,
  pushNumericStatistic,
  histogramFromNumericValues,
} from '../statistics.js';
import { findHeaderRow, readerContext, sourceToText } from './shared.js';

const HEADER_SCAN_ROWS = 80;
const TYPE_SAMPLE_NON_MISSING = 200;

function abortError() {
  return new DOMException('Visualization parsing cancelled.', 'AbortError');
}

async function preparePapaInput(source) {
  if (typeof source === 'string') return source;
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source;

  if (typeof Blob !== 'undefined' && source instanceof ArrayBuffer) {
    return new Blob([source], { type: 'text/plain' });
  }
  if (typeof Blob !== 'undefined' && ArrayBuffer.isView(source)) {
    const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    return new Blob([bytes], { type: 'text/plain' });
  }

  return sourceToText(source);
}

function sourceSizeOf(input) {
  if (typeof input?.size === 'number') return input.size;
  if (typeof input === 'string') return input.length;
  return 0;
}

function rowHasData(row) {
  return (row || []).some((value) => String(value ?? '').trim() !== '');
}

function fixedWidthRow(row, width) {
  return Array.from({ length: width }, (_, index) => row?.[index] ?? null);
}

function analyzeDelimited(input, delimiter, { isCancelled, onProgress }) {
  return new Promise((resolve, reject) => {
    const sourceSize = sourceSizeOf(input);
    const headRows = [];
    let header = null;
    let rawHeaders = null;
    let width = 0;
    let globalRowIndex = 0;
    let typeSamples = null;
    let parserErrors = 0;
    let dataRowCount = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const ensureHeader = (force = false) => {
      if (header || (!force && headRows.length < HEADER_SCAN_ROWS)) return;
      header = findHeaderRow(headRows, { maxScan: HEADER_SCAN_ROWS });
      rawHeaders = headRows[header.index] || [];
      width = rawHeaders.length;
      if (!width) throw new Error('Could not detect a column header row.');
      typeSamples = Array.from({ length: width }, () => []);
      for (let index = header.index + 1; index < headRows.length; index += 1) {
        sampleRow(headRows[index]);
      }
    };

    const sampleRow = (row) => {
      if (!typeSamples || !rowHasData(row)) return;
      dataRowCount += 1;
      const normalized = fixedWidthRow(row, width);
      for (let col = 0; col < width; col += 1) {
        const samples = typeSamples[col];
        if (samples.length >= TYPE_SAMPLE_NON_MISSING) continue;
        const value = normalized[col];
        if (!isMissingValue(value)) samples.push(value);
      }
    };

    try {
      Papa.parse(input, {
        delimiter,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
        chunkSize: 256 * 1024,
        chunk(results, parser) {
          if (isCancelled()) {
            parser.abort();
            fail(abortError());
            return;
          }
          parserErrors += results?.errors?.length || 0;

          for (const row of results.data || []) {
            if (!header && headRows.length < HEADER_SCAN_ROWS) {
              headRows.push(row);
              globalRowIndex += 1;
              if (headRows.length === HEADER_SCAN_ROWS) ensureHeader(false);
              continue;
            }
            if (!header) ensureHeader(true);
            if (globalRowIndex > header.index) sampleRow(row);
            globalRowIndex += 1;
          }

          const cursor = Number(results.meta?.cursor || 0);
          if (onProgress && sourceSize > 0) {
            onProgress({
              stage: 'analyze',
              loaded: cursor,
              total: sourceSize,
              percent: Math.min(20, Math.round((cursor / sourceSize) * 20)),
            });
          }
        },
        complete(results) {
          if (settled) return;
          if (results?.meta?.aborted || isCancelled()) {
            fail(abortError());
            return;
          }
          try {
            ensureHeader(true);
            const kinds = typeSamples.map((samples) => inferValueKind(samples));
            settled = true;
            resolve({ header, rawHeaders, width, kinds, parserErrors, rowCount: dataRowCount });
          } catch (error) {
            fail(error);
          }
        },
        error(error) { fail(error); },
      });
    } catch (error) {
      fail(error);
    }
  });
}

class NumericColumnBuilder {
  constructor(length) {
    this.values = new Float64Array(length);
    this.index = 0;
    this.statsState = createNumericStatistics();
  }

  push(raw) {
    if (this.index >= this.values.length) throw new Error('Delimited dataset row count changed during parsing.');
    const numeric = toFiniteNumber(raw);
    const value = numeric == null ? Number.NaN : numeric;
    this.values[this.index] = value;
    this.index += 1;
    pushNumericStatistic(this.statsState, value);
  }

  finish() {
    if (this.index !== this.values.length) throw new Error('Delimited dataset row count changed during parsing.');
    const statistics = { ...finishNumericStatistics(this.statsState), histogram: histogramFromNumericValues(this.values) };
    return { values: this.values, statistics, missingCount: statistics.missingCount };
  }
}

class ScalarColumnBuilder {
  constructor(type, length) {
    this.type = type;
    this.values = new Array(length);
    this.index = 0;
    this.missingCount = 0;
  }

  push(raw) {
    if (this.index >= this.values.length) throw new Error('Delimited dataset row count changed during parsing.');
    const value = normalizeScalar(raw);
    if (value == null) this.missingCount += 1;
    this.values[this.index] = value;
    this.index += 1;
  }

  finish() {
    if (this.index !== this.values.length) throw new Error('Delimited dataset row count changed during parsing.');
    return { values: this.values, statistics: null, missingCount: this.missingCount };
  }
}

function makeBuilders(kinds, rowCount) {
  return kinds.map((kind) => (kind === 'number' ? new NumericColumnBuilder(rowCount) : new ScalarColumnBuilder(kind, rowCount)));
}

function buildCanonicalFromColumns(rawHeaders, kinds, builders, rowCount, context, metadata) {
  const uniqueHeaders = makeUniqueHeaders(rawHeaders);
  const fields = [];
  const variables = [];

  for (let index = 0; index < uniqueHeaders.length; index += 1) {
    const type = kinds[index] || 'text';
    const finished = builders[index].finish();
    const definition = {
      key: `field_${index}`,
      index,
      originalName: uniqueHeaders[index],
      normalizedName: uniqueHeaders[index].trim(),
      unit: null,
      description: null,
    };
    const field = {
      ...definition,
      type,
      values: finished.values,
      missingCount: finished.missingCount,
      statistics: finished.statistics,
    };
    fields.push(field);

    if (type === 'number') {
      variables.push({
        fieldKey: field.key,
        name: field.normalizedName,
        originalName: field.originalName,
        unit: field.unit,
        type: 'numeric',
        statistics: finished.statistics,
      });
    }
  }

  return createCanonicalDataset({
    sourceId: context.sourceId,
    contentId: context.contentId,
    fileName: context.fileName,
    datasetFingerprint: context.datasetFingerprint,
    fields,
    rowCount,
    variables,
    casts: [],
    ignored: [],
    warnings: metadata.warnings,
    provenance: metadata.provenance,
    sourceMeta: metadata.sourceMeta,
  });
}

function buildDelimited(input, delimiter, analysis, context) {
  return new Promise((resolve, reject) => {
    const sourceSize = sourceSizeOf(input);
    const builders = makeBuilders(analysis.kinds, analysis.rowCount);
    let globalRowIndex = 0;
    let rowCount = 0;
    let parserErrors = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      Papa.parse(input, {
        delimiter,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
        chunkSize: 256 * 1024,
        chunk(results, parser) {
          if (context.isCancelled()) {
            parser.abort();
            fail(abortError());
            return;
          }
          parserErrors += results?.errors?.length || 0;

          for (const row of results.data || []) {
            if (globalRowIndex <= analysis.header.index) {
              globalRowIndex += 1;
              continue;
            }
            globalRowIndex += 1;
            if (!rowHasData(row)) continue;

            const normalized = fixedWidthRow(row, analysis.width);
            for (let col = 0; col < analysis.width; col += 1) builders[col].push(normalized[col]);
            rowCount += 1;
          }

          const cursor = Number(results.meta?.cursor || 0);
          if (context.onProgress && sourceSize > 0) {
            context.onProgress({
              stage: 'parse',
              loaded: cursor,
              total: sourceSize,
              percent: Math.min(95, 20 + Math.round((cursor / sourceSize) * 75)),
            });
          }
        },
        complete(results) {
          if (settled) return;
          if (results?.meta?.aborted || context.isCancelled()) {
            fail(abortError());
            return;
          }
          if (!rowCount) {
            fail(new Error('Dataset contains a header but no data rows.'));
            return;
          }
          if (rowCount !== analysis.rowCount) {
            fail(new Error('Delimited dataset row count changed between analysis and canonicalization passes.'));
            return;
          }

          try {
            const warnings = [];
            if (analysis.header.index > 0) warnings.push(`Ignored ${analysis.header.index} preamble/header line${analysis.header.index === 1 ? '' : 's'} before the detected column header.`);
            const errorCount = Math.max(analysis.parserErrors, parserErrors);
            if (errorCount) warnings.push(`Parser reported ${errorCount} recoverable delimited-text issue${errorCount === 1 ? '' : 's'}.`);
            if (analysis.header.confidence !== 'high') warnings.push('Column-header detection confidence is low; confirm mapping in the next phase.');

            const format = delimiter === '\t' ? 'tsv' : 'csv';
            const canonical = buildCanonicalFromColumns(
              analysis.rawHeaders,
              analysis.kinds,
              builders,
              rowCount,
              context,
              {
                warnings,
                provenance: [{ step: 'reader', format, headerRow: analysis.header.index }],
                sourceMeta: { delimiter: delimiter || 'auto', headerRow: analysis.header.index },
              },
            );
            context.onProgress?.({ stage: 'complete', loaded: rowCount, total: rowCount, percent: 100 });
            settled = true;
            resolve(canonical);
          } catch (error) {
            fail(error);
          }
        },
        error(error) { fail(error); },
      });
    } catch (error) {
      fail(error);
    }
  });
}

async function readDelimited(source, options, delimiter) {
  const context = readerContext(options);
  const input = await preparePapaInput(source);
  const analysis = await analyzeDelimited(input, delimiter, context);
  if (!analysis.rawHeaders?.length) throw new Error('Delimited dataset appears to be empty.');
  if (context.isCancelled()) throw abortError();
  return buildDelimited(input, delimiter, analysis, context);
}

export function readCsv(source, options = {}) {
  return readDelimited(source, options, '');
}

export function readTsv(source, options = {}) {
  return readDelimited(source, options, '\t');
}
