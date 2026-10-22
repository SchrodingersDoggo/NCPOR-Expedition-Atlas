import * as XLSX from 'xlsx';
import { cleanRectangularRows, findHeaderRow, readerContext, rowsToCanonical, sourceToArrayBuffer } from './shared.js';

function analyzeSheet(name, rows) {
  if (!rows.length) return { name, useful: false, rowCount: 0, columnCount: 0, headerRow: 0, numericRatio: 0, score: -Infinity };
  const header = findHeaderRow(rows);
  const headers = rows[header.index] || [];
  const width = headers.length;
  const dataRows = cleanRectangularRows(rows.slice(header.index + 1), width);
  let numeric = 0;
  let populated = 0;
  for (const row of dataRows.slice(0, 200)) {
    for (const value of row) {
      if (String(value ?? '').trim() === '') continue;
      populated += 1;
      if (Number.isFinite(Number(value))) numeric += 1;
    }
  }
  const numericRatio = populated ? numeric / populated : 0;
  const useful = width >= 2 && dataRows.length >= 1;
  const score = useful ? Math.log10(dataRows.length + 1) * 4 + Math.min(width, 20) + numericRatio * 10 - header.index * 0.1 : -Infinity;
  return { name, useful, rowCount: dataRows.length, columnCount: width, headerRow: header.index, numericRatio, score, headers, dataRows, headerConfidence: header.confidence };
}

export async function readXlsx(source, options = {}) {
  const context = readerContext(options);
  const buffer = await sourceToArrayBuffer(source);
  if (context.isCancelled()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');
  context.onProgress?.({ stage: 'parse', loaded: 0, total: buffer.byteLength, percent: 10 });

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false, dense: false });
  } catch (error) {
    throw new Error(`Could not read spreadsheet: ${error.message}`);
  }
  if (!workbook.SheetNames.length) throw new Error('Spreadsheet has no worksheets.');

  const analyses = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null, raw: true });
    return analyzeSheet(name, rows);
  });
  const requested = options.sheetName ? analyses.find((item) => item.name === options.sheetName) : null;
  if (options.sheetName && !requested) throw new Error(`Worksheet "${options.sheetName}" does not exist.`);
  const selected = requested || analyses.filter((item) => item.useful).sort((a, b) => b.score - a.score)[0];
  if (!selected?.useful) throw new Error('Spreadsheet does not contain a useful tabular worksheet.');

  const warnings = [];
  if (selected.headerRow > 0) warnings.push(`Ignored ${selected.headerRow} row${selected.headerRow === 1 ? '' : 's'} before the detected header in worksheet "${selected.name}".`);
  if (selected.headerConfidence !== 'high') warnings.push(`Header detection confidence is low for worksheet "${selected.name}".`);

  context.onProgress?.({ stage: 'normalize', loaded: 0, total: selected.dataRows.length, percent: 60 });
  const canonical = rowsToCanonical(selected.headers, selected.dataRows, {
    ...context,
    warnings,
    provenance: [{ step: 'reader', format: context.fileName.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx', sheet: selected.name, headerRow: selected.headerRow }],
    sourceMeta: {
      xlsx: {
        sheetNames: [...workbook.SheetNames],
        selectedSheet: selected.name,
        sheets: analyses.map(({ name, useful, rowCount, columnCount, headerRow, numericRatio }) => ({ name, useful, rowCount, columnCount, headerRow, numericRatio })),
      },
    },
  });
  context.onProgress?.({ stage: 'complete', loaded: buffer.byteLength, total: buffer.byteLength, percent: 100 });
  return canonical;
}
