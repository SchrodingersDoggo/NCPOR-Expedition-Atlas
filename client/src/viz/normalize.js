import { looksLikeTimestamp } from './timeParse.js';

const DEFAULT_MISSING_STRINGS = new Set([
  '',
  'nan',
  'na',
  'n/a',
  'null',
  'undefined',
  '-999',
  '-9999',
  '9.96921e36',
]);

export function normalizeHeaderName(value, index = 0) {
  const text = String(value ?? '').replace(/^\uFEFF/, '').trim();
  return text || `column_${index + 1}`;
}

export function makeUniqueHeaders(headers = []) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = normalizeHeaderName(header, index);
    const key = base.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function isMissingValue(value, { badFlag = null } = {}) {
  if (value == null) return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return true;
    if (value === -999 || value === -9999 || value === 9.96921e36) return true;
    if (badFlag != null && Number.isFinite(Number(badFlag)) && value === Number(badFlag)) return true;
    return false;
  }

  const text = String(value).trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  if (DEFAULT_MISSING_STRINGS.has(lower)) return true;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    if (numeric === -999 || numeric === -9999 || numeric === 9.96921e36) return true;
    if (badFlag != null && Number.isFinite(Number(badFlag)) && numeric === Number(badFlag)) return true;
  }
  return false;
}

export function toFiniteNumber(value, options = {}) {
  if (isMissingValue(value, options)) return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeScalar(value, options = {}) {
  if (isMissingValue(value, options)) return null;
  if (typeof value === 'string') return value.trim();
  return value;
}

export function inferValueKind(values = [], { badFlag = null, sampleSize = 200 } = {}) {
  let numeric = 0;
  let nonMissing = 0;
  let dateLike = 0;
  for (let i = 0; i < values.length && nonMissing < sampleSize; i += 1) {
    const raw = values[i];
    if (isMissingValue(raw, { badFlag })) continue;
    nonMissing += 1;
    if (toFiniteNumber(raw, { badFlag }) != null) {
      numeric += 1;
      continue;
    }
    const text = String(raw).trim();
    if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}:\d{2}/.test(text) && looksLikeTimestamp(text)) {
      dateLike += 1;
    }
  }

  if (nonMissing === 0) return 'text';
  if (numeric / nonMissing >= 0.95) return 'number';
  if (dateLike / nonMissing >= 0.9) return 'date';
  return 'text';
}

export function normalizeFileExtension(fileName = '') {
  const clean = String(fileName).toLowerCase().split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot) : '';
}
