import { readerContext, rowsToCanonical, sourceToText } from './shared.js';

function chooseRecordArray(parsed) {
  if (Array.isArray(parsed)) return { records: parsed, path: '$' };
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON dataset must contain an array of records or an object containing one record array.');

  const arrays = Object.entries(parsed).filter(([, value]) => Array.isArray(value));
  const preferred = ['data', 'records', 'observations', 'items', 'results'];
  for (const key of preferred) {
    const match = arrays.find(([name]) => name.toLowerCase() === key);
    if (match) return { records: match[1], path: `$.${match[0]}` };
  }
  if (arrays.length === 1) return { records: arrays[0][1], path: `$.${arrays[0][0]}` };
  if (arrays.length > 1) throw new Error('JSON contains multiple record arrays; the visualizer will not guess which one is the scientific dataset.');
  throw new Error('JSON object does not contain an obvious record array.');
}

function flattenOneLevel(record) {
  const output = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        const flatKey = `${key}.${nestedKey}`;
        if (nestedValue && typeof nestedValue === 'object') output[flatKey] = JSON.stringify(nestedValue);
        else output[flatKey] = nestedValue;
      }
    } else if (Array.isArray(value)) {
      output[key] = JSON.stringify(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function readJson(source, options = {}) {
  const context = readerContext(options);
  const text = await sourceToText(source);
  if (context.isCancelled()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Malformed JSON dataset: ${error.message}`);
  }

  const { records, path } = chooseRecordArray(parsed);
  if (!records.length) throw new Error('JSON record array is empty.');
  if (!records.every((record) => record && typeof record === 'object' && !Array.isArray(record))) {
    throw new Error('JSON datasets must be an array of record objects (not scalars or nested arrays).');
  }

  const flattened = records.map(flattenOneLevel);
  const headers = [];
  const seen = new Set();
  for (const record of flattened) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  const rows = flattened.map((record) => headers.map((header) => record[header] ?? null));

  context.onProgress?.({ stage: 'normalize', loaded: 0, total: rows.length, percent: 25 });
  const canonical = rowsToCanonical(headers, rows, {
    ...context,
    warnings: [],
    provenance: [{ step: 'reader', format: 'json', recordPath: path, flattenDepth: 1 }],
    sourceMeta: { recordPath: path, flattenDepth: 1 },
  });
  context.onProgress?.({ stage: 'complete', loaded: rows.length, total: rows.length, percent: 100 });
  return canonical;
}
