import { fetchDatasetRange, getDatasetAccess } from './datasetAccess.js';

export const VIZ_PREVIEW_RANGE_BYTES = 1024 * 1024;
const LINE_ORIENTED_EXTENSIONS = new Set(['.csv', '.tsv', '.cnv']);
const NON_RANGE_PREVIEW_EXTENSIONS = new Set(['.xls', '.xlsx', '.json']);

function extensionFromName(fileName = '') {
  const clean = String(fileName).toLowerCase().split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot) : '';
}

function metadataPreview(datasetMeta) {
  const rows = datasetMeta?.preview_rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return {
    source: 'metadata',
    rows,
    columns: Array.isArray(datasetMeta?.columns) ? datasetMeta.columns : [],
    rowCount: Number(datasetMeta?.row_count || rows.length),
    complete: false,
  };
}

// A byte-range preview is intentionally text/record oriented here. V1 owns
// scientific parsing; V0 only guarantees a real bounded source of complete
// records instead of a fake generic Preview button.
export function completeTextRecords(text, { finalChunkIsComplete = false } = {}) {
  const normalized = String(text || '').replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  const endsWithLineBreak = /(?:\r?\n)$/.test(normalized);
  if (!finalChunkIsComplete && !endsWithLineBreak && lines.length) lines.pop();
  if (endsWithLineBreak && lines.at(-1) === '') lines.pop();
  return lines;
}

export async function getDatasetPreview(contentId, { rangeBytes = VIZ_PREVIEW_RANGE_BYTES, signal = null } = {}) {
  if (!Number.isSafeInteger(rangeBytes) || rangeBytes <= 0) {
    throw new Error('rangeBytes must be a positive integer.');
  }
  const access = await getDatasetAccess(contentId, { signal });
  const saved = metadataPreview(access.datasetMeta);
  if (saved) return { ...saved, access };

  const extension = extensionFromName(access.fileName);
  if (LINE_ORIENTED_EXTENSIONS.has(extension)) {
    const fileSize = Number(access.fileSize || 0);
    const end = Math.max(0, Math.min(
      Number.isSafeInteger(fileSize) && fileSize > 0 ? fileSize - 1 : rangeBytes - 1,
      rangeBytes - 1
    ));
    const { response, access: refreshedAccess } = await fetchDatasetRange(contentId, { start: 0, end, signal });
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    const fullFileReceived = Number(refreshedAccess.fileSize || 0) > 0
      && buffer.byteLength >= Number(refreshedAccess.fileSize);
    const lines = completeTextRecords(text, { finalChunkIsComplete: fullFileReceived });

    return {
      source: 'range',
      extension,
      lines,
      text: lines.join('\n'),
      bytesRead: buffer.byteLength,
      contentRange: response.headers.get('Content-Range'),
      acceptRanges: response.headers.get('Accept-Ranges'),
      complete: fullFileReceived,
      access: refreshedAccess,
    };
  }

  if (NON_RANGE_PREVIEW_EXTENSIONS.has(extension)) {
    return {
      source: 'none',
      extension,
      reason: `${extension || 'This format'} requires a complete file download when no metadata preview is available.`,
      requiresFullDownload: true,
      access,
    };
  }

  return {
    source: 'none',
    extension,
    reason: 'No partial preview is available for this format.',
    requiresFullDownload: true,
    access,
  };
}
