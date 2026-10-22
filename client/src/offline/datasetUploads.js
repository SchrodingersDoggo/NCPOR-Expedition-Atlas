import { getDb } from './db.js';
import { STORE_DATASET_UPLOADS } from './constants.js';

const RESUMABLE_STATUSES = new Set([
  'initiated',
  'uploading',
  'paused',
  'waiting-network',
  'storage-unavailable',
  'integrity-error',
  'finalizing',
  'completed',
]);

export const DATASET_UPLOAD_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function normalizePartNumbers(parts) {
  const values = (parts || [])
    .map((part) => Number(typeof part === 'object' ? part.partNumber : part))
    .filter((partNumber) => Number.isInteger(partNumber) && partNumber > 0);
  return [...new Set(values)].sort((a, b) => a - b);
}

// Only serializable control metadata is accepted here. In particular there is
// intentionally no `file`/`blob` property in the stored shape.
export async function saveDatasetUploadSession(record) {
  const db = await getDb();
  const now = Date.now();
  const stored = {
    sessionId: record.sessionId,
    sessionToken: record.sessionToken,
    ownerId: record.ownerId,
    fileName: record.fileName,
    fileSize: Number(record.fileSize),
    lastModified: Number(record.lastModified || 0),
    mimeType: record.mimeType || 'application/octet-stream',
    partSize: Number(record.partSize),
    totalParts: Number(record.totalParts),
    completedParts: normalizePartNumbers(record.completedParts),
    uploadedBytes: Number(record.uploadedBytes || 0),
    status: record.status || 'initiated',
    objectKey: record.objectKey || null,
    etag: record.etag || null,
    checksumSHA256: record.checksumSHA256 || null,
    wholeFileSha256: record.wholeFileSha256 || null,
    checksumAlgorithm: record.checksumAlgorithm || null,
    versionId: record.versionId || null,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  await db.put(STORE_DATASET_UPLOADS, stored);
  return stored;
}

export async function updateDatasetUploadSession(sessionId, patch) {
  const db = await getDb();
  const existing = await db.get(STORE_DATASET_UPLOADS, sessionId);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...patch,
    ...(patch.completedParts ? { completedParts: normalizePartNumbers(patch.completedParts) } : {}),
    updatedAt: Date.now(),
  };
  // Safety invariant: never let a caller accidentally persist a File/Blob.
  delete updated.file;
  delete updated.blob;
  await db.put(STORE_DATASET_UPLOADS, updated);
  return updated;
}

export async function getDatasetUploadSession(sessionId) {
  const db = await getDb();
  return db.get(STORE_DATASET_UPLOADS, sessionId);
}

export async function removeDatasetUploadSession(sessionId) {
  const db = await getDb();
  await db.delete(STORE_DATASET_UPLOADS, sessionId);
}

export async function listDatasetUploadSessions(ownerId) {
  if (!ownerId) return [];
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE_DATASET_UPLOADS, 'ownerId', ownerId);
  return rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function listStaleDatasetUploadSessions(ownerId, now = Date.now()) {
  const rows = await listDatasetUploadSessions(ownerId);
  const cutoff = Number(now) - DATASET_UPLOAD_STALE_MS;
  return rows.filter((row) => Number(row.updatedAt || row.createdAt || 0) < cutoff);
}

// Logout/account switching should not leave reusable multipart bearer tokens
// available to the next account that uses the browser. Keep the non-sensitive
// upload metadata so the owning researcher can still see/reconcile the record
// after signing in again. Preserve updatedAt so token scrubbing itself does not
// make an abandoned upload look recently active to the stale-session cleanup.
export async function scrubDatasetUploadSessionTokens(ownerId) {
  if (!ownerId) return 0;
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE_DATASET_UPLOADS, 'ownerId', ownerId);
  let changed = 0;

  for (const row of rows) {
    if (!row.sessionToken) continue;
    await db.put(STORE_DATASET_UPLOADS, {
      ...row,
      sessionToken: null,
      tokenScrubbedAt: Date.now(),
    });
    changed += 1;
  }

  return changed;
}

export async function listResumableDatasetUploads(ownerId) {
  const rows = await listDatasetUploadSessions(ownerId);
  return rows.filter((row) => RESUMABLE_STATUSES.has(row.status));
}

export function fileMatchesDatasetUpload(file, session) {
  if (!file || !session) return false;
  return (
    file.name === session.fileName &&
    Number(file.size) === Number(session.fileSize) &&
    Number(file.lastModified || 0) === Number(session.lastModified || 0)
  );
}

export async function findMatchingDatasetUpload(file, ownerId) {
  if (!file || !ownerId) return null;
  const rows = await listResumableDatasetUploads(ownerId);
  return rows.find((row) => fileMatchesDatasetUpload(file, row)) || null;
}
