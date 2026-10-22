import api from './client.js';
import {
  DATASET_UPLOAD_STALE_MS,
  findMatchingDatasetUpload,
  fileMatchesDatasetUpload,
  listDatasetUploadSessions,
  listStaleDatasetUploadSessions,
  removeDatasetUploadSession,
  saveDatasetUploadSession,
  updateDatasetUploadSession,
} from '../offline/datasetUploads.js';

function sessionHeaders(sessionToken) {
  return { 'x-dataset-upload-session': sessionToken };
}

export async function initDatasetUpload(file) {
  const { data } = await api.post('/dataset-upload/init', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
  });
  return data;
}

export async function getDatasetPartUrl(sessionToken, partNumber, checksumSHA256 = null) {
  const body = { partNumber };
  if (checksumSHA256) body.checksumSHA256 = checksumSHA256;

  const { data } = await api.post(
    '/dataset-upload/part-url',
    body,
    { headers: sessionHeaders(sessionToken) }
  );
  return data;
}

export async function getDatasetUploadStatus(sessionToken) {
  const { data } = await api.get('/dataset-upload/status', {
    headers: sessionHeaders(sessionToken),
  });
  return data;
}

export async function completeDatasetUpload(sessionToken, wholeFileSha256 = null) {
  const { data } = await api.post(
    '/dataset-upload/complete',
    wholeFileSha256 ? { wholeFileSha256 } : {},
    { headers: sessionHeaders(sessionToken) }
  );
  return data;
}

export async function abortDatasetUpload(sessionToken) {
  const { data } = await api.delete('/dataset-upload/abort', {
    headers: sessionHeaders(sessionToken),
  });
  return data;
}

async function getDatasetUploadStatusForCleanup(sessionToken) {
  const response = await api.get('/dataset-upload/status', {
    headers: sessionHeaders(sessionToken),
    // A stale multipart bearer token can legitimately return 401 while the
    // main login JWT is still valid. Keep that cleanup probe out of the global
    // Axios 401 interceptor so it cannot accidentally log the researcher out.
    validateStatus: () => true,
  });
  return response.status === 200 ? response.data : null;
}

export async function reissueDatasetUploadSessionToken(sessionId) {
  const { data } = await api.post('/dataset-upload/session-token', { sessionId });
  return data;
}

export async function cleanupStaleDatasetUploadSessions(ownerId) {
  if (!ownerId) return { checked: 0, results: [] };

  const staleLocal = await listStaleDatasetUploadSessions(ownerId);
  const reconciled = new Map();

  // Requirement: before deleting stale local metadata, reconcile with the
  // existing /status endpoint whenever a still-valid session token exists.
  for (const local of staleLocal) {
    if (local.status === 'completed' || !local.sessionToken) continue;
    try {
      const status = await getDatasetUploadStatusForCleanup(local.sessionToken);
      if (!status) continue;
      reconciled.set(local.sessionId, status);
      if (status.uploadStatus === 'completed') {
        await persistServerStatus(local.sessionId, status);
      }
    } catch {
      // Expired tokens, temporary outages and other failures are not grounds
      // for deleting local state. The authenticated server cleanup below can
      // still reconcile stale DB sessions without trusting the local token.
    }
  }

  let serverCleanup;
  try {
    const { data } = await api.post('/dataset-upload/cleanup-stale');
    serverCleanup = data;
  } catch {
    // Cleanup is best-effort. Never destroy local resume metadata just because
    // the control plane is temporarily unreachable.
    return { checked: staleLocal.length, results: [] };
  }

  const serverById = new Map(
    (serverCleanup.results || []).map((entry) => [entry.sessionId, entry])
  );

  for (const local of staleLocal) {
    const status = reconciled.get(local.sessionId);
    if (status?.uploadStatus === 'completed') continue;

    const server = serverById.get(local.sessionId);
    if (server?.status === 'completed') {
      await updateDatasetUploadSession(local.sessionId, {
        status: 'completed',
        uploadedBytes: Number(local.fileSize || 0),
        lastError: null,
        lastErrorCode: null,
      });
      continue;
    }

    if (server?.status === 'aborted' || server?.status === 'failed') {
      await removeDatasetUploadSession(local.sessionId);
      continue;
    }

    if (status?.uploadStatus === 'aborted' || status?.uploadStatus === 'failed') {
      await removeDatasetUploadSession(local.sessionId);
    }
  }

  return serverCleanup;
}

export async function restoreDatasetUploadSessionTokens(ownerId) {
  if (!ownerId) return 0;
  const rows = await listDatasetUploadSessions(ownerId);
  const now = Date.now();
  let restored = 0;

  for (const row of rows) {
    if (row.sessionToken) continue;
    if (row.status === 'aborted' || row.status === 'failed') continue;
    // Completed uploads may still need their owner-validated session token to
    // finish the DatasetMetadata/ContentItem attachment after logout or an
    // account switch. They are not abandoned multipart uploads, so the
    // seven-day stale cutoff must not strand a safely completed MinIO object
    // in "finalization pending" forever. Only incomplete sessions are
    // subject to stale cleanup before token restoration.
    if (row.status !== 'completed'
      && Number(row.updatedAt || row.createdAt || 0) < now - DATASET_UPLOAD_STALE_MS) continue;

    try {
      const reissued = await reissueDatasetUploadSessionToken(row.sessionId);
      await updateDatasetUploadSession(row.sessionId, { sessionToken: reissued.sessionToken });
      restored += 1;
    } catch {
      // Ownership/status is enforced server-side. Leave metadata intact if a
      // token cannot be safely reissued.
    }
  }

  return restored;
}

const PAUSED_PART_CODE = 'DATASET_PART_PAUSED';
const NETWORK_PART_CODE = 'DATASET_PART_NETWORK';
const INTEGRITY_PART_CODE = 'DATASET_PART_INTEGRITY';
const MAX_INTEGRITY_ATTEMPTS = 3;
const MAX_PRESIGNED_REFRESH_ATTEMPTS = 3;
const MAX_STORAGE_RETRY_ATTEMPTS = 3;
const PRESIGNED_EXPIRED_CODE = 'DATASET_PART_PRESIGNED_EXPIRED';
const STORAGE_UNAVAILABLE_CODE = 'DATASET_STORAGE_UNAVAILABLE';

function makePartError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status != null) error.status = status;
  return error;
}

// S3-compatible stores return structured error codes for checksum failures.
// Only those explicit integrity errors are retryable here; generic 400/403
// responses (expired signature, auth/session problems, malformed requests, etc.)
// must remain terminal so they are not misclassified as data corruption.
function getS3ErrorCode(xhr) {
  const headerCode = String(xhr.getResponseHeader('x-amz-error-code') || '').trim();
  if (headerCode) return headerCode;

  const body = String(xhr.responseText || '');
  const match = body.match(/<Code>\s*([^<]+?)\s*<\/Code>/i);
  return match ? match[1].trim() : '';
}

function isChecksumIntegrityResponse(xhr) {
  if (xhr.status !== 400 && xhr.status !== 422) return false;
  const code = getS3ErrorCode(xhr);
  return code === 'BadDigest'
    || code === 'XAmzContentSHA256Mismatch'
    || code === 'ChecksumMismatch';
}

function isExpiredPresignedResponse(xhr) {
  if (xhr.status !== 400 && xhr.status !== 403) return false;
  const code = getS3ErrorCode(xhr);
  if (code === 'RequestExpired' || code === 'ExpiredToken') return true;

  // S3-compatible stores sometimes report an expired presigned URL as
  // AccessDenied. Only treat it as expiry when the response explicitly says
  // the request expired; generic 403/auth failures remain terminal.
  if (code !== 'AccessDenied') return false;
  return /request\s+has\s+expired|presigned\s+url\s+has\s+expired/i.test(String(xhr.responseText || ''));
}

function isTransientMinioResponse(xhr) {
  return [500, 502, 503, 504].includes(Number(xhr.status));
}

function apiErrorCode(error) {
  return String(error?.response?.data?.code || error?.code || '').trim();
}

function isTemporaryStorageFailure(error) {
  const code = apiErrorCode(error);
  return code === 'DATASET_STORAGE_UNAVAILABLE' || code === 'DATASET_STATE_UNAVAILABLE';
}

function storageUnavailableMessage(operation = 'continue') {
  return `Dataset storage is temporarily unavailable. The upload was kept resumable; try again later to ${operation}.`;
}

let checksumWorker = null;
let checksumRequestId = 0;
const checksumRequests = new Map();

function failChecksumRequests(message) {
  const error = new Error(message || 'Dataset checksum worker failed.');
  for (const { reject } of checksumRequests.values()) reject(error);
  checksumRequests.clear();
}

function getChecksumWorker() {
  if (checksumWorker) return checksumWorker;

  const worker = new Worker(
    new URL('../workers/datasetChecksum.worker.js', import.meta.url),
    { type: 'module' }
  );

  worker.onmessage = (event) => {
    const { id, checksumSHA256, wholeFileSha256, error } = event.data || {};
    const request = checksumRequests.get(id);
    if (!request) return;
    checksumRequests.delete(id);
    if (error) request.reject(new Error(error));
    else request.resolve(wholeFileSha256 || checksumSHA256);
  };

  worker.onerror = (event) => {
    failChecksumRequests(event?.message || 'Dataset checksum worker failed.');
    worker.terminate();
    if (checksumWorker === worker) checksumWorker = null;
  };

  checksumWorker = worker;
  return worker;
}

export function hashDatasetPartSHA256(blob) {
  return new Promise((resolve, reject) => {
    const worker = getChecksumWorker();
    const id = `checksum-${Date.now()}-${++checksumRequestId}`;
    checksumRequests.set(id, { resolve, reject });
    worker.postMessage({ id, blob });
  });
}

export function hashDatasetFileSHA256(file) {
  return new Promise((resolve, reject) => {
    const worker = getChecksumWorker();
    const id = `whole-checksum-${Date.now()}-${++checksumRequestId}`;
    checksumRequests.set(id, { resolve, reject });
    worker.postMessage({ id, blob: file, mode: 'whole-file' });
  });
}

// Whole-file fingerprints only serve browser visualization caching. Files
// larger than the biggest browser visualization limit (100 MiB) are never
// fully parsed client-side, and hashing them in JavaScript runs at roughly
// 30–40 MiB/s — minutes of CPU for multi-GB files, all before /complete is
// called. Those uploads use the existing legacy ETag/version fingerprint.
// Per-part integrity checksums are unaffected.
export const MAX_WHOLE_FILE_FINGERPRINT_BYTES = 100 * 1024 * 1024;

async function tryHashDatasetFileSHA256(file) {
  if (!file || Number(file.size) > MAX_WHOLE_FILE_FINGERPRINT_BYTES) return null;
  try {
    return await hashDatasetFileSHA256(file);
  } catch (error) {
    // Whole-file fingerprints are additive V0 metadata. A browser/worker
    // hashing failure must never strand an otherwise valid existing MinIO
    // upload; the visualizer can use its legacy ETag/version fallback.
    console.warn('Could not calculate whole-file SHA-256; using legacy dataset fingerprint fallback.', error);
    return null;
  }
}

// Small state object kept only in memory. Pausing aborts the currently active
// PUT (the part is retried later); resuming wakes the same upload promise, so
// the form submission does not unwind or enqueue a multi-GB Blob elsewhere.
export function createMultipartUploadControl() {
  let paused = false;
  let currentAbort = null;
  let resumeWaiters = [];

  return {
    pause() {
      if (paused) return;
      paused = true;
      currentAbort?.();
    },
    resume() {
      if (!paused) return;
      paused = false;
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const resolve of waiters) resolve();
    },
    isPaused() {
      return paused;
    },
    async waitIfPaused() {
      if (!paused) return;
      await new Promise((resolve) => resumeWaiters.push(resolve));
    },
    setCurrentAbort(abortFn) {
      currentAbort = typeof abortFn === 'function' ? abortFn : null;
    },
    clearCurrentAbort(abortFn) {
      if (!abortFn || currentAbort === abortFn) currentAbort = null;
    },
  };
}

// Deliberately uses a plain XMLHttpRequest instead of the portal Axios
// instance: the destination is a presigned MinIO URL, so the portal JWT must
// never be attached to this cross-origin request. XHR also gives reliable
// upload progress for a single multipart part.
export function putDatasetPart({ url, blob, requiredHeaders = {}, onProgress, control }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);

    for (const [name, value] of Object.entries(requiredHeaders || {})) {
      if (value !== undefined && value !== null) xhr.setRequestHeader(name, String(value));
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      control?.clearCurrentAbort(abortCurrent);
      fn(value);
    };
    const abortCurrent = () => {
      if (!settled) xhr.abort();
    };
    control?.setCurrentAbort(abortCurrent);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve, { etag: xhr.getResponseHeader('ETag') || null });
      } else if (isChecksumIntegrityResponse(xhr)) {
        finish(
          reject,
          makePartError(
            `MinIO rejected the dataset part because its checksum did not match.`,
            INTEGRITY_PART_CODE,
            xhr.status
          )
        );
      } else if (isExpiredPresignedResponse(xhr)) {
        finish(
          reject,
          makePartError(
            'The presigned MinIO part URL expired before the upload completed.',
            PRESIGNED_EXPIRED_CODE,
            xhr.status
          )
        );
      } else if (isTransientMinioResponse(xhr)) {
        finish(
          reject,
          makePartError(
            'MinIO is temporarily unavailable while uploading this dataset part.',
            STORAGE_UNAVAILABLE_CODE,
            xhr.status
          )
        );
      } else {
        finish(
          reject,
          makePartError(
            `MinIO rejected part upload with HTTP ${xhr.status}.`,
            'DATASET_PART_HTTP',
            xhr.status
          )
        );
      }
    };

    xhr.onerror = () => finish(
      reject,
      makePartError('Network error while uploading dataset part to MinIO.', NETWORK_PART_CODE)
    );
    xhr.onabort = () => finish(
      reject,
      makePartError(
        control?.isPaused()
          ? 'Dataset part upload paused.'
          : 'Dataset part upload was aborted.',
        control?.isPaused() ? PAUSED_PART_CODE : 'DATASET_PART_ABORTED'
      )
    );
    xhr.ontimeout = () => finish(
      reject,
      makePartError('Dataset part upload timed out.', NETWORK_PART_CODE)
    );

    xhr.send(blob);
  });
}

function partNumbers(parts) {
  return new Set(
    (parts || [])
      .map((part) => Number(typeof part === 'object' ? part.partNumber : part))
      .filter((partNumber) => Number.isInteger(partNumber) && partNumber > 0)
  );
}

function isNetworkFailure(error) {
  if (!error) return false;
  if (error.code === NETWORK_PART_CODE) return true;
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') return true;
  // Axios network failures have a request but no HTTP response.
  if (error.request && !error.response) return true;
  return false;
}

function browserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStorageRetry(control, attempt) {
  await control?.waitIfPaused();
  const backoffMs = Math.min(8000, 1000 * (2 ** Math.max(0, attempt - 1)));
  await delay(backoffMs);
  await control?.waitIfPaused();
}

async function waitForConnectivity(control) {
  await control?.waitIfPaused();
  if (browserOnline()) {
    // navigator.onLine can be optimistic. Avoid a tight retry loop when the
    // network interface is up but the satellite/uplink is still unavailable.
    await delay(1500);
    return;
  }

  await new Promise((resolve) => {
    const onOnline = () => {
      window.removeEventListener('online', onOnline);
      resolve();
    };
    window.addEventListener('online', onOnline, { once: true });
  });
  await control?.waitIfPaused();
}

function makeProgress(status, {
  uploadedBytes,
  totalBytes,
  partNumber,
  totalParts,
  resumed = false,
}) {
  return {
    status,
    uploadedBytes: Number(uploadedBytes || 0),
    totalBytes: Number(totalBytes || 0),
    percent: totalBytes ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0,
    partNumber: Number(partNumber || 0),
    totalParts: Number(totalParts || 0),
    resumed,
  };
}

async function persistServerStatus(sessionId, status) {
  const completed = [...partNumbers(status.completedParts)];
  const patch = {
    status: status.uploadStatus || 'uploading',
    uploadedBytes: Number(status.uploadedBytes || 0),
    completedParts: completed,
    // Any successful reconciliation means a previous client-only integrity
    // error is no longer the current state. The server/MinIO part list is
    // authoritative, so clear the display-only error metadata here.
    lastError: null,
    lastErrorCode: null,
  };
  if (status.objectKey) patch.objectKey = status.objectKey;
  if (status.checksumAlgorithm !== undefined) patch.checksumAlgorithm = status.checksumAlgorithm || null;
  if (status.etag) patch.etag = status.etag;
  if (status.checksumSHA256) patch.checksumSHA256 = status.checksumSHA256;
  if (status.wholeFileSha256) patch.wholeFileSha256 = status.wholeFileSha256;
  if (status.versionId) patch.versionId = status.versionId;
  return updateDatasetUploadSession(sessionId, patch);
}

async function getStatusWithReconnect({ sessionToken, sessionId, control, onProgress, fileSize, totalParts }) {
  let storageAttempts = 0;

  for (;;) {
    if (control?.isPaused()) {
      await updateDatasetUploadSession(sessionId, { status: 'paused' });
      onProgress?.(makeProgress('paused', {
        uploadedBytes: 0,
        totalBytes: fileSize,
        partNumber: 0,
        totalParts,
        resumed: true,
      }));
      await control.waitIfPaused();
    }

    try {
      const status = await getDatasetUploadStatus(sessionToken);
      await persistServerStatus(sessionId, status);
      return status;
    } catch (error) {
      if (isTemporaryStorageFailure(error)) {
        storageAttempts += 1;
        if (storageAttempts >= MAX_STORAGE_RETRY_ATTEMPTS) {
          const message = storageUnavailableMessage('resume');
          await updateDatasetUploadSession(sessionId, {
            status: 'storage-unavailable',
            lastError: message,
            lastErrorCode: STORAGE_UNAVAILABLE_CODE,
          });
          throw makePartError(message, STORAGE_UNAVAILABLE_CODE, error?.response?.status || null);
        }
        await waitForStorageRetry(control, storageAttempts);
        continue;
      }

      if (!isNetworkFailure(error)) throw error;
      storageAttempts = 0;
      await updateDatasetUploadSession(sessionId, { status: 'waiting-network' });
      onProgress?.(makeProgress('waiting-network', {
        uploadedBytes: 0,
        totalBytes: fileSize,
        partNumber: 0,
        totalParts,
        resumed: true,
      }));
      await waitForConnectivity(control);
    }
  }
}

function completedResultFromStatus(status, sessionRecord) {
  return {
    ...status,
    sessionId: sessionRecord.sessionId,
    sessionToken: sessionRecord.sessionToken,
    fileName: status.fileName || sessionRecord.fileName,
    fileSize: Number(status.fileSize || sessionRecord.fileSize),
    mimeType: status.mimeType || sessionRecord.mimeType,
    objectKey: status.objectKey || sessionRecord.objectKey,
    uploadStatus: 'completed',
    storageProvider: 'minio',
  };
}

// Phase 6: resumable, sequential multipart uploader. IndexedDB stores only
// session metadata. The File object stays in memory; after a page restart the
// researcher must reselect the same file, which is verified by name + size +
// lastModified before this function will resume the existing MinIO upload.
export async function uploadDatasetMultipart(file, {
  onProgress,
  ownerId,
  resumeSession = null,
  control = null,
} = {}) {
  const uploadControl = control || createMultipartUploadControl();

  let sessionRecord = resumeSession || await findMatchingDatasetUpload(file, ownerId);
  let resumed = Boolean(sessionRecord);

  if (sessionRecord && !fileMatchesDatasetUpload(file, sessionRecord)) {
    throw new Error(
      'This is not the same local file that started the interrupted dataset upload. ' +
      'Please reselect the original file.'
    );
  }

  if (!sessionRecord) {
    const session = await initDatasetUpload(file);
    sessionRecord = await saveDatasetUploadSession({
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      ownerId,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified || 0,
      mimeType: file.type || 'application/octet-stream',
      partSize: session.partSize,
      totalParts: session.totalParts,
      completedParts: [],
      uploadedBytes: 0,
      status: session.uploadStatus || 'initiated',
      objectKey: session.objectKey || null,
      checksumAlgorithm: session.checksumAlgorithm || null,
    });
  }

  const {
    sessionId,
    sessionToken,
    partSize,
    totalParts,
  } = sessionRecord;

  // Always reconcile resumptions with MinIO. IndexedDB is only a local hint;
  // /status -> ListParts is the authoritative record of committed parts.
  let status = await getStatusWithReconnect({
    sessionToken,
    sessionId,
    control: uploadControl,
    onProgress,
    fileSize: file.size,
    totalParts,
  });
  const checksumAlgorithm = status.checksumAlgorithm || sessionRecord.checksumAlgorithm || null;
  if (checksumAlgorithm && checksumAlgorithm !== 'SHA256') {
    throw new Error(`Unsupported dataset multipart checksum algorithm: ${checksumAlgorithm}.`);
  }
  if (checksumAlgorithm !== sessionRecord.checksumAlgorithm) {
    sessionRecord = await updateDatasetUploadSession(sessionId, { checksumAlgorithm });
  }

  if (status.uploadStatus === 'completed') {
    let durableStatus = status;
    if (!status.wholeFileSha256) {
      const wholeFileSha256 = await tryHashDatasetFileSHA256(file);
      if (wholeFileSha256) {
        durableStatus = await completeDatasetUpload(sessionToken, wholeFileSha256);
      }
    }
    await updateDatasetUploadSession(sessionId, {
      status: 'completed',
      uploadedBytes: file.size,
      objectKey: durableStatus.objectKey || sessionRecord.objectKey,
      etag: durableStatus.etag || null,
      checksumSHA256: durableStatus.checksumSHA256 || null,
      wholeFileSha256: durableStatus.wholeFileSha256 || null,
      versionId: durableStatus.versionId || null,
    });
    onProgress?.(makeProgress('completed', {
      uploadedBytes: file.size,
      totalBytes: file.size,
      partNumber: totalParts,
      totalParts,
      resumed,
    }));
    return completedResultFromStatus(durableStatus, sessionRecord);
  }

  if (status.uploadStatus === 'aborted' || status.uploadStatus === 'failed') {
    throw new Error(`Dataset multipart upload is ${status.uploadStatus} and cannot be resumed.`);
  }

  let completedParts = partNumbers(status.completedParts);
  let committedBytes = Number(status.uploadedBytes || 0);

  await updateDatasetUploadSession(sessionId, {
    status: 'uploading',
    completedParts: [...completedParts],
    uploadedBytes: committedBytes,
  });
  onProgress?.(makeProgress('uploading', {
    uploadedBytes: committedBytes,
    totalBytes: file.size,
    partNumber: completedParts.size ? Math.max(...completedParts) : 0,
    totalParts,
    resumed,
  }));

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (completedParts.has(partNumber)) continue;

    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);
    // New Phase 7 sessions hash each missing part in a dedicated worker. Old
    // pre-Phase-7 sessions have checksumAlgorithm=null and remain resumable.
    let checksumSHA256 = checksumAlgorithm === 'SHA256'
      ? await hashDatasetPartSHA256(chunk)
      : null;
    let integrityAttempts = 0;
    let presignedRefreshAttempts = 0;
    let storageAttempts = 0;

    for (;;) {
      if (uploadControl.isPaused()) {
        await updateDatasetUploadSession(sessionId, {
          status: 'paused',
          completedParts: [...completedParts],
          uploadedBytes: committedBytes,
        });
        onProgress?.(makeProgress('paused', {
          uploadedBytes: committedBytes,
          totalBytes: file.size,
          partNumber,
          totalParts,
          resumed,
        }));
        await uploadControl.waitIfPaused();
        await updateDatasetUploadSession(sessionId, { status: 'uploading' });
      }

      try {
        const signed = await getDatasetPartUrl(sessionToken, partNumber, checksumSHA256);
        if (uploadControl.isPaused()) {
          await updateDatasetUploadSession(sessionId, {
            status: 'paused',
            completedParts: [...completedParts],
            uploadedBytes: committedBytes,
          });
          onProgress?.(makeProgress('paused', {
            uploadedBytes: committedBytes,
            totalBytes: file.size,
            partNumber,
            totalParts,
            resumed,
          }));
          await uploadControl.waitIfPaused();
          // The presigned URL may have aged while paused, so discard it and
          // obtain a fresh one instead of risking an avoidable expiry error.
          continue;
        }

        await putDatasetPart({
          url: signed.url,
          blob: chunk,
          requiredHeaders: signed.requiredHeaders,
          control: uploadControl,
          onProgress: (partLoaded) => {
            const uploadedBytes = Math.min(file.size, committedBytes + partLoaded);
            onProgress?.(makeProgress('uploading', {
              uploadedBytes,
              totalBytes: file.size,
              partNumber,
              totalParts,
              resumed,
            }));
          },
        });

        completedParts.add(partNumber);
        committedBytes += chunk.size;
        presignedRefreshAttempts = 0;
        storageAttempts = 0;
        await updateDatasetUploadSession(sessionId, {
          status: 'uploading',
          completedParts: [...completedParts],
          uploadedBytes: committedBytes,
        });
        onProgress?.(makeProgress('uploading', {
          uploadedBytes: committedBytes,
          totalBytes: file.size,
          partNumber,
          totalParts,
          resumed,
        }));
        break;
      } catch (error) {
        if (error.code === INTEGRITY_PART_CODE) {
          integrityAttempts += 1;

          if (integrityAttempts >= MAX_INTEGRITY_ATTEMPTS) {
            const message =
              `Dataset part ${partNumber} failed SHA-256 integrity validation after ${MAX_INTEGRITY_ATTEMPTS} attempts. ` +
              'The upload was stopped; already completed parts were kept and can be resumed later.';
            await updateDatasetUploadSession(sessionId, {
              status: 'integrity-error',
              completedParts: [...completedParts],
              uploadedBytes: committedBytes,
              lastError: message,
              lastErrorCode: INTEGRITY_PART_CODE,
            });
            throw makePartError(message, INTEGRITY_PART_CODE, error.status);
          }

          // Hash the original local slice again before the retry. The next
          // loop iteration always asks the backend for a fresh presigned URL.
          checksumSHA256 = checksumAlgorithm === 'SHA256'
            ? await hashDatasetPartSHA256(chunk)
            : null;
          continue;
        }

        if (error.code === PRESIGNED_EXPIRED_CODE) {
          presignedRefreshAttempts += 1;
          if (presignedRefreshAttempts >= MAX_PRESIGNED_REFRESH_ATTEMPTS) {
            const message =
              `Dataset part ${partNumber} could not refresh an expired presigned URL after ${MAX_PRESIGNED_REFRESH_ATTEMPTS} attempts. ` +
              'The upload was kept resumable.';
            await updateDatasetUploadSession(sessionId, {
              status: 'storage-unavailable',
              completedParts: [...completedParts],
              uploadedBytes: committedBytes,
              lastError: message,
              lastErrorCode: PRESIGNED_EXPIRED_CODE,
            });
            throw makePartError(message, PRESIGNED_EXPIRED_CODE, error.status);
          }
          // Looping requests a brand-new presigned URL for the same local part.
          continue;
        }

        if (error.code === STORAGE_UNAVAILABLE_CODE || isTemporaryStorageFailure(error)) {
          storageAttempts += 1;
          if (storageAttempts >= MAX_STORAGE_RETRY_ATTEMPTS) {
            const message = storageUnavailableMessage(`resume from part ${partNumber}`);
            await updateDatasetUploadSession(sessionId, {
              status: 'storage-unavailable',
              completedParts: [...completedParts],
              uploadedBytes: committedBytes,
              lastError: message,
              lastErrorCode: STORAGE_UNAVAILABLE_CODE,
            });
            throw makePartError(message, STORAGE_UNAVAILABLE_CODE, error.status || error?.response?.status || null);
          }
          await waitForStorageRetry(uploadControl, storageAttempts);
          // Always request a fresh presigned URL after a temporary storage
          // failure; already completed parts remain untouched.
          continue;
        }

        if (error.code === PAUSED_PART_CODE) {
          await updateDatasetUploadSession(sessionId, {
            status: 'paused',
            completedParts: [...completedParts],
            uploadedBytes: committedBytes,
          });
          onProgress?.(makeProgress('paused', {
            uploadedBytes: committedBytes,
            totalBytes: file.size,
            partNumber,
            totalParts,
            resumed,
          }));
          await uploadControl.waitIfPaused();
          continue;
        }

        if (!isNetworkFailure(error)) throw error;

        await updateDatasetUploadSession(sessionId, {
          status: 'waiting-network',
          completedParts: [...completedParts],
          uploadedBytes: committedBytes,
        });
        onProgress?.(makeProgress('waiting-network', {
          uploadedBytes: committedBytes,
          totalBytes: file.size,
          partNumber,
          totalParts,
          resumed,
        }));

        await waitForConnectivity(uploadControl);
        status = await getStatusWithReconnect({
          sessionToken,
          sessionId,
          control: uploadControl,
          onProgress,
          fileSize: file.size,
          totalParts,
        });

        if (status.uploadStatus === 'completed') {
          completedParts = new Set(Array.from({ length: totalParts }, (_, index) => index + 1));
          committedBytes = file.size;
          break;
        }
        if (status.uploadStatus === 'aborted' || status.uploadStatus === 'failed') {
          throw new Error(`Dataset multipart upload is ${status.uploadStatus} and cannot be resumed.`);
        }

        completedParts = partNumbers(status.completedParts);
        committedBytes = Number(status.uploadedBytes || 0);
        if (completedParts.has(partNumber)) break;
      }
    }
  }

  await updateDatasetUploadSession(sessionId, {
    status: 'finalizing',
    completedParts: [...completedParts],
    uploadedBytes: file.size,
  });
  onProgress?.(makeProgress('finalizing', {
    uploadedBytes: file.size,
    totalBytes: file.size,
    partNumber: totalParts,
    totalParts,
    resumed,
  }));

  let completed;
  let completionStorageAttempts = 0;
  const wholeFileSha256 = await tryHashDatasetFileSHA256(file);
  for (;;) {
    if (uploadControl.isPaused()) {
      await updateDatasetUploadSession(sessionId, { status: 'paused' });
      onProgress?.(makeProgress('paused', {
        uploadedBytes: file.size,
        totalBytes: file.size,
        partNumber: totalParts,
        totalParts,
        resumed,
      }));
      await uploadControl.waitIfPaused();
    }

    try {
      completed = await completeDatasetUpload(sessionToken, wholeFileSha256);
      break;
    } catch (error) {
      if (isTemporaryStorageFailure(error)) {
        completionStorageAttempts += 1;
        if (completionStorageAttempts >= MAX_STORAGE_RETRY_ATTEMPTS) {
          const message = storageUnavailableMessage('finish multipart completion');
          await updateDatasetUploadSession(sessionId, {
            status: 'storage-unavailable',
            uploadedBytes: file.size,
            completedParts: [...completedParts],
            lastError: message,
            lastErrorCode: STORAGE_UNAVAILABLE_CODE,
          });
          throw makePartError(message, STORAGE_UNAVAILABLE_CODE, error?.response?.status || null);
        }
        await waitForStorageRetry(uploadControl, completionStorageAttempts);
        // Retry /complete directly. It is idempotent when the DB already says
        // completed, and Phase 4.1 recovers NoSuchUpload via HeadObject.
        continue;
      }

      if (!isNetworkFailure(error)) throw error;
      completionStorageAttempts = 0;
      await updateDatasetUploadSession(sessionId, { status: 'waiting-network' });
      onProgress?.(makeProgress('waiting-network', {
        uploadedBytes: file.size,
        totalBytes: file.size,
        partNumber: totalParts,
        totalParts,
        resumed,
      }));
      await waitForConnectivity(uploadControl);

      // Completion may already have succeeded server-side before the response
      // was lost. Retry /complete directly: it is idempotent when DB status is
      // completed, and Phase 4 recovers the MinIO-completed/DB-not-updated
      // NoSuchUpload race via HeadObject. Calling /status first would bypass
      // that narrow recovery path because ListParts no longer exists then.
    }
  }

  await updateDatasetUploadSession(sessionId, {
    status: 'completed',
    uploadedBytes: file.size,
    completedParts: [...completedParts],
    objectKey: completed.objectKey || sessionRecord.objectKey,
    etag: completed.etag || null,
    checksumSHA256: completed.checksumSHA256 || null,
    wholeFileSha256: completed.wholeFileSha256 || wholeFileSha256 || null,
    versionId: completed.versionId || null,
  });

  onProgress?.(makeProgress('completed', {
    uploadedBytes: file.size,
    totalBytes: file.size,
    partNumber: totalParts,
    totalParts,
    resumed,
  }));

  return {
    ...completed,
    sessionId,
    sessionToken,
  };
}
