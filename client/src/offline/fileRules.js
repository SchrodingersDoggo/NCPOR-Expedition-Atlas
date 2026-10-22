// Phase 7 — large files / videos.
//
// The server already enforces a 100MB cap and a MIME allow-list
// (server/src/middleware/upload.middleware.js). Offline, that enforcement
// arrives far too late to be useful: a researcher picks a 400MB dive video
// in the field, the app cheerfully queues it, and the rejection only lands
// days later when the ship regains a signal — by which time re-shooting or
// re-exporting is impossible.
//
// These rules mirror the server's so the same file is rejected at the moment
// it is chosen, while the researcher can still do something about it. Keep
// this list in step with the server's ALLOWED_MIME_TYPES.

import { formatBytes } from './storage.js';

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // must match multer's limit

// Not a hard limit — just the point where a satellite uplink makes the
// upload a multi-hour affair worth warning about before it is queued.
export const LARGE_FILE_WARN_BYTES = 25 * 1024 * 1024;


// Phase 0 — scientific dataset routing.
//
// Dataset selection has different requirements from the legacy media/document
// uploader. In particular, multi-GB scientific files must not inherit the
// global Multer/Cloudinary 100 MiB cap because they will use the dedicated
// direct-to-object-storage multipart path introduced in later phases.
//
// Keep validateFile() below unchanged for the existing /api/upload path.
export const DATASET_EXTENSIONS = [
  'csv',
  'tsv',
  'xls',
  'xlsx',
  'json',
  'cnv',
  'nc',
  'nc4',
  'h5',
  'hdf5',
  'grib',
  'grb',
  'zip',
];

export const DATASET_ACCEPT = DATASET_EXTENSIONS.map((ext) => `.${ext}`).join(',');

// parseDatasetFull() materialises the whole table (and Excel first reads the
// whole workbook into an ArrayBuffer), so only small, structured tables are
// eligible for the current preview/3D path. The file itself is still valid if
// it is larger; preview is simply skipped.
export const DATASET_PREVIEW_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
const DATASET_PREVIEW_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'cnv']);

// Browser MIME reporting for scientific formats is inconsistent. Extension
// is therefore the primary selector; when a browser supplies a useful MIME,
// reject only an obvious mismatch. Generic binary/empty MIME values remain
// valid for formats such as NetCDF/HDF/GRIB.
const DATASET_MIME_BY_EXTENSION = {
  csv: new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']),
  tsv: new Set(['text/tab-separated-values', 'text/plain']),
  xls: new Set(['application/vnd.ms-excel', 'application/octet-stream']),
  xlsx: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
  ]),
  json: new Set(['application/json', 'text/json', 'text/plain']),
  cnv: new Set(['text/plain', 'application/octet-stream']),
  nc: new Set(['application/x-netcdf', 'application/netcdf', 'application/octet-stream']),
  nc4: new Set(['application/x-netcdf', 'application/netcdf', 'application/x-hdf5', 'application/octet-stream']),
  h5: new Set(['application/x-hdf5', 'application/x-hdf', 'application/octet-stream']),
  hdf5: new Set(['application/x-hdf5', 'application/x-hdf', 'application/octet-stream']),
  grib: new Set(['application/x-grib', 'application/grib', 'application/octet-stream']),
  grb: new Set(['application/x-grib', 'application/grib', 'application/octet-stream']),
  zip: new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
};

function extensionOf(file) {
  const name = file?.name || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function validateDatasetFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };

  if (file.size === 0) {
    return { ok: false, error: `"${file.name}" is empty (0 bytes) and cannot be uploaded.` };
  }

  const ext = extensionOf(file);
  if (!DATASET_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error:
        `"${file.name}" is not a supported scientific dataset format. ` +
        `Accepted: ${DATASET_EXTENSIONS.map((value) => `.${value}`).join(', ')}.`,
    };
  }

  const mime = (file.type || '').toLowerCase();
  const reliableMime = mime && mime !== 'application/octet-stream';
  const allowedForExtension = DATASET_MIME_BY_EXTENSION[ext];
  if (reliableMime && allowedForExtension && !allowedForExtension.has(mime)) {
    return {
      ok: false,
      error: `"${file.name}" has an unexpected file type (${mime}) for .${ext}.`,
    };
  }

  return { ok: true };
}

export function shouldPreviewDatasetFile(file) {
  const ext = extensionOf(file);
  return DATASET_PREVIEW_EXTENSIONS.has(ext) && file.size <= DATASET_PREVIEW_MAX_BYTES;
}

// Final dataset storage policy: every supported scientific dataset uses the
// direct MinIO multipart path while online, regardless of file size. Small
// table files may still be parsed locally for preview before this upload.
export function getDatasetUploadRoute(file) {
  const ext = extensionOf(file);
  return DATASET_EXTENSIONS.includes(ext) ? 'multipart' : null;
}

// Preserve the existing offline Blob queue only for dataset files that fit
// inside its established 100 MiB safety boundary. The queue's own quota check
// still decides whether the device actually has enough free storage. Large
// datasets are never copied into IndexedDB.
export function canQueueDatasetOffline(file) {
  return Boolean(file) && validateDatasetFile(file).ok && file.size <= MAX_FILE_SIZE_BYTES;
}

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
];

// Some browsers hand back an empty or generic type for CSV/Excel picked from
// certain file managers; fall back to the extension before rejecting, since
// the server sees the same MIME we forward and a false rejection here would
// block a legitimate dataset.
const EXTENSION_FALLBACK = {
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function resolveMimeType(file) {
  if (file?.type && ALLOWED_MIME_TYPES.includes(file.type)) return file.type;
  const ext = file?.name?.split('.').pop()?.toLowerCase();
  return EXTENSION_FALLBACK[ext] || file?.type || '';
}

// Returns { ok, error, warning }. `error` blocks the file outright;
// `warning` is advisory and still allows queuing.
export function validateFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };

  if (file.size === 0) {
    return { ok: false, error: `"${file.name}" is empty (0 bytes) and cannot be uploaded.` };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error:
        `"${file.name}" is ${formatBytes(file.size)}. The maximum accepted size is ` +
        `${formatBytes(MAX_FILE_SIZE_BYTES)} — compress or trim it before uploading.`,
    };
  }

  const mime = resolveMimeType(file);
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    return {
      ok: false,
      error: `"${file.name}" is a file type the portal does not accept${mime ? ` (${mime})` : ''}.`,
    };
  }

  if (file.size > LARGE_FILE_WARN_BYTES) {
    return {
      ok: true,
      warning: `"${file.name}" is ${formatBytes(file.size)} — it will upload slowly on a weak link, but it stays saved on this device until it succeeds.`,
    };
  }

  return { ok: true };
}
