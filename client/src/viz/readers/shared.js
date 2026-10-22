import { canonicalFromRows } from '../model.js';

export async function sourceToText(source) {
  if (typeof source === 'string') return source;
  if (source instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(source);
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder('utf-8').decode(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  if (source && typeof source.text === 'function') return source.text();
  throw new Error('Reader expected text, Blob/File, ArrayBuffer, or typed-array input.');
}

export async function sourceToArrayBuffer(source) {
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  if (source && typeof source.arrayBuffer === 'function') return source.arrayBuffer();
  if (typeof source === 'string') return new TextEncoder().encode(source).buffer;
  throw new Error('Reader expected Blob/File, ArrayBuffer, typed-array, or string input.');
}

function nonEmptyCells(row) {
  return (row || []).filter((value) => String(value ?? '').trim() !== '');
}

function numberLike(value) {
  const text = String(value ?? '').trim();
  return text !== '' && Number.isFinite(Number(text));
}

export function findHeaderRow(rows, { maxScan = 80 } = {}) {
  const limit = Math.min(rows.length, maxScan);
  let best = null;

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || [];
    const cells = nonEmptyCells(row);
    if (cells.length < 2) continue;
    const width = row.length;
    const unique = new Set(cells.map((value) => String(value).trim().toLowerCase())).size;
    const stringCount = cells.filter((value) => !numberLike(value)).length;
    const alphaCount = cells.filter((value) => /[A-Za-z]/.test(String(value))).length;
    const nextRows = rows.slice(index + 1, Math.min(rows.length, index + 6));
    const compatible = nextRows.filter((next) => {
      const count = nonEmptyCells(next).length;
      return count >= Math.max(2, Math.floor(cells.length * 0.6));
    });
    const nextNumeric = compatible.reduce((sum, next) => sum + nonEmptyCells(next).filter(numberLike).length, 0);
    const score = (
      Math.min(width, 12) * 1.5
      + unique
      + stringCount * 1.2
      + alphaCount
      + compatible.length * 2
      + Math.min(nextNumeric, 12) * 0.5
      - index * 0.08
    );
    if (!best || score > best.score) best = { index, score, width, confidence: compatible.length >= 1 ? 'high' : 'low' };
  }

  if (best) return best;
  const fallback = rows.findIndex((row) => nonEmptyCells(row).length >= 1);
  return { index: fallback >= 0 ? fallback : 0, score: 0, width: rows[fallback]?.length || 0, confidence: 'low' };
}

export function rowsToCanonical(headers, rows, context = {}) {
  return canonicalFromRows(headers, rows, context);
}

export function cleanRectangularRows(rows, width) {
  return (rows || [])
    .filter((row) => (row || []).some((value) => String(value ?? '').trim() !== ''))
    .map((row) => Array.from({ length: width }, (_, index) => row?.[index] ?? null));
}

export function readerContext(options = {}, additions = {}) {
  return {
    sourceId: options.sourceId ?? null,
    contentId: options.contentId ?? null,
    fileName: options.fileName ?? '',
    datasetFingerprint: options.datasetFingerprint ?? null,
    isCancelled: options.isCancelled || (() => false),
    onProgress: options.onProgress || null,
    ...additions,
  };
}
