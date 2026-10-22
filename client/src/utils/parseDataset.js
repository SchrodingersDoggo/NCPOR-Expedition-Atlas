import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Kept small on purpose — this only needs to be "good enough" to catch
// obvious mistakes and give a useful preview, not perfectly validate data.
const PREVIEW_ROWS = 8;
const TYPE_SAMPLE_SIZE = 20;

function isNumberLike(v) {
  return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
}

function isDateLike(v) {
  if (isNumberLike(v)) return false; // a bare "2024" is a number, not a date
  const d = new Date(v);
  return !isNaN(d.getTime()) && /\d{4}/.test(String(v));
}

function inferColumnType(values) {
  const sample = values
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .slice(0, TYPE_SAMPLE_SIZE);

  if (sample.length === 0) return 'text';
  if (sample.every(isNumberLike)) return 'number';
  if (sample.every(isDateLike)) return 'date';
  return 'text';
}

// Re-export for use in UI components
export { inferColumnType };

// headers: string[], rows: array of arrays (same column order as headers)
function buildMeta(headers, rows) {
  const columns = headers.map((name, i) => ({
    name: String(name ?? `column_${i + 1}`).trim() || `column_${i + 1}`,
    type: inferColumnType(rows.map((r) => r[i])),
  }));

  return {
    row_count: rows.length,
    columns,
    preview_rows: rows
      .slice(0, PREVIEW_ROWS)
      .map((r) => r.map((v) => (v === undefined || v === null ? '' : String(v)))),
  };
}

// CSV / TSV via PapaParse — handles quoted fields, mixed line endings, etc.
// Resolves { headers, rows } — the full parsed table, not just the preview.
function parseDelimitedRaw(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const rows = result.data;
        if (!rows.length) return reject(new Error('File appears to be empty.'));
        const [headerRow, ...dataRows] = rows;
        resolve({ headers: headerRow, rows: dataRows });
      },
      error: (err) => reject(err),
    });
  });
}

// .xlsx / .xls via SheetJS — first sheet only, which covers the vast
// majority of researcher-uploaded spreadsheets. Resolves { headers, rows }.
async function parseExcelRaw(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (!rows.length) throw new Error('Spreadsheet appears to be empty.');
  const [headerRow, ...dataRows] = rows;
  return { headers: headerRow, rows: dataRows };
}

// Manually-built table from the in-browser table builder.
// table shape: { columns: ['Depth (m)', 'Temperature (C)', ...], rows: [[...], ...] }
function parseManualTableRaw(table) {
  const { columns = [], rows = [] } = table;
  if (!columns.length) throw new Error('Table needs at least one column.');
  return { headers: columns, rows };
}

const EXCEL_EXTENSIONS = ['.xlsx', '.xls'];

function isExcelFile(file) {
  const name = (file.name || '').toLowerCase();
  return EXCEL_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isCnvFile(file) {
  return (file?.name || '').toLowerCase().endsWith('.cnv');
}

async function parseCnvRaw(file) {
  // V1's dedicated Sea-Bird reader understands the instrument header,
  // bad_flag and measurement section. Adapt its canonical columns back into
  // this legacy upload-preview shape without changing existing CSV/XLS paths.
  const { readCnv } = await import('../viz/readers/cnv.js');
  const dataset = await readCnv(file, { fileName: file.name });
  const headers = dataset.fields.map((field) => field.normalizedName);
  const rows = Array.from({ length: dataset.rowCount }, (_, rowIndex) =>
    dataset.fields.map((field) => {
      const value = field.values?.[rowIndex];
      return field.type === 'number' && Number.isNaN(value) ? '' : (value ?? '');
    })
  );
  return { headers, rows };
}

// Shared by parseDataset() and parseDatasetFull() so a File/table only ever
// gets parsed once. Resolves { headers, rows } — the full table.
function parseRawRows(source) {
  if (source instanceof File) {
    if (isCnvFile(source)) return parseCnvRaw(source);
    return isExcelFile(source) ? parseExcelRaw(source) : parseDelimitedRaw(source);
  }
  if (source && typeof source === 'object' && Array.isArray(source.rows)) {
    return Promise.resolve(parseManualTableRaw(source));
  }
  return Promise.reject(new Error('parseDataset expects a File or a { columns, rows } table object.'));
}

/**
 * Main entry point for Phase 3's upload form.
 *
 * Pass either:
 *   - a File (CSV/TSV routed to PapaParse, .xlsx/.xls to SheetJS, .cnv to the V1 Sea-Bird reader), or
 *   - a manual table object: { columns: string[], rows: any[][] }
 *
 * Always resolves to the same shape, which is exactly what gets stored in
 * ContentItem.datasetMeta:
 *   { row_count, columns: [{ name, type }], preview_rows }
 *
 * Runs entirely client-side, synchronously with the upload UI, so the
 * preview can render before the researcher submits anything.
 */
export async function parseDataset(source) {
  const { headers, rows } = await parseRawRows(source);
  return buildMeta(headers, rows);
}

/**
 * Same inputs as parseDataset(), but also resolves the full parsed table
 * (every row, not just the 8-row preview kept in datasetMeta). Used by the
 * upload flow to build the in-browser 3D ocean-section viewer — that full
 * table is never sent to the server, only the usual `meta` is.
 *
 * Resolves { meta, headers, rows }.
 */
export async function parseDatasetFull(source) {
  const { headers, rows } = await parseRawRows(source);
  return { meta: buildMeta(headers, rows), headers, rows };
}
