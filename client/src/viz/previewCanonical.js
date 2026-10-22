import { canonicalFromRows } from './model.js';

function normalizeMeta(raw) {
  if (!raw) return null;
  let meta = raw;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return null; }
  }
  return meta && typeof meta === 'object' ? meta : null;
}

export function canonicalFromDatasetMeta(item, { datasetFingerprint = null, fileName = '' } = {}) {
  const meta = normalizeMeta(item?.datasetMeta);
  const columns = Array.isArray(meta?.columns) ? meta.columns : [];
  const sourceRows = Array.isArray(meta?.preview_rows) ? meta.preview_rows : [];
  if (!columns.length || !sourceRows.length) return null;
  const headers = columns.map((column, index) => column?.name || `column_${index + 1}`);
  const rows = sourceRows.map((row) => Array.isArray(row) ? row : headers.map((name) => row?.[name] ?? null));
  const fieldMeta = columns.map((column, index) => ({
    originalName: column?.name || headers[index],
    normalizedName: column?.name || headers[index],
    unit: column?.unit || null,
    description: column?.description || null,
  }));
  const dataset = canonicalFromRows(headers, rows, {
    contentId: item?.id || null,
    sourceId: `metadata-preview:${item?.id || 'unknown'}`,
    fileName: fileName || item?.fileName || item?.title || 'preview.csv',
    datasetFingerprint,
    fieldMeta,
    provenance: [{ step: 'preview', source: 'datasetMeta.preview_rows' }],
    sourceMeta: { preview: true, sourceRowCount: Number(meta?.row_count || rows.length) },
  });
  dataset.sourceRowCount = Number(meta?.row_count || rows.length);
  dataset.sourceRowCountKnown = Number(meta?.row_count || 0) > 0;
  dataset.isPreview = true;
  return dataset;
}
