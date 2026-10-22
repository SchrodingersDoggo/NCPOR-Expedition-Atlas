import { normalizeFileExtension } from './normalize.js';

export const V1_READER_EXTENSIONS = Object.freeze(['.csv', '.tsv', '.xls', '.xlsx', '.json', '.cnv', '.nc', '.nc4', '.h5', '.hdf5']);
const SUPPORTED = new Set(V1_READER_EXTENSIONS);

export function getReaderExtension(fileName = '') {
  return normalizeFileExtension(fileName);
}

export function canReadDataset(fileName = '') {
  return SUPPORTED.has(getReaderExtension(fileName));
}

async function loadReader(extension) {
  switch (extension) {
    case '.csv': return (await import('./readers/csv.js')).readCsv;
    case '.tsv': return (await import('./readers/csv.js')).readTsv;
    case '.xls':
    case '.xlsx': return (await import('./readers/xlsx.js')).readXlsx;
    case '.json': return (await import('./readers/json.js')).readJson;
    case '.cnv': return (await import('./readers/cnv.js')).readCnv;
    case '.nc': return (await import('./readers/netcdfAuto.js')).readNetcdfAuto;
    case '.nc4':
    case '.h5':
    case '.hdf5': return (await import('./readers/hdf5.js')).readHdf5Scientific;
    default: throw new Error(`No visualization reader is registered for ${extension || 'this file type'}.`);
  }
}

// Offline warm-up: load (and let the service worker cache) the reader code
// for these extensions without parsing anything. Failures are ignored.
export async function preloadReaders(extensions = [], { hdf5 = false } = {}) {
  const unique = [...new Set(extensions.map((value) => String(value || '').toLowerCase()))].filter((value) => SUPPORTED.has(value));
  const results = await Promise.allSettled(unique.map((extension) => loadReader(extension)));
  if (hdf5) {
    try {
      const module = await import('./readers/hdf5.js');
      await module.preloadHdf5Backend?.();
    } catch {
      // Best effort only.
    }
  }
  return unique.filter((_, index) => results[index].status === 'fulfilled');
}

export async function readDataset(source, options = {}) {
  const fileName = options.fileName || source?.name || '';
  const extension = getReaderExtension(fileName);
  if (!SUPPORTED.has(extension)) {
    const error = new Error(`Unsupported visualization format "${extension || 'unknown'}". Supported formats: ${V1_READER_EXTENSIONS.join(', ')}.`);
    error.code = 'VIZ_UNSUPPORTED_FORMAT';
    throw error;
  }
  const reader = await loadReader(extension);
  return reader(source, { ...options, fileName });
}
