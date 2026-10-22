import api from '../api/client.js';
import {
  listPendingContent,
  updatePendingContent,
  claimPendingContent,
  updateClaimedPendingContent,
  listPendingExpeditions,
  updatePendingExpedition,
  claimPendingExpedition,
  updateClaimedPendingExpedition,
  reassignPendingContentExpedition,
  releaseSyncedContentFile,
} from './queue.js';
import {
  QUEUE_STATUS,
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  RETRY_JITTER_RATIO,
  SYNC_POLL_MS,
  SYNC_BLOCK,
} from './constants.js';
import { classifySyncError, isQuotaExceededError, ERROR_KIND } from './errors.js';
import { notifySyncState } from './syncChannel.js';
import { requestPersistentStorage } from './storage.js';
import { updateExpedition } from '../api/expeditions.js';
import { cacheExpedition } from './queue.js';
import { uploadDatasetMultipart } from '../api/datasetUpload.js';
import { removeDatasetUploadSession } from './datasetUploads.js';

// Phase 7 builds on the Phase 3C ordering and claiming, and replaces its
// single "is this temporary?" test with the classification in errors.js.
// What changed, and why:
//
//   * Expired sessions no longer destroy work. A 401 used to be a permanent
//     4xx failure, so a token expiring overnight turned an entire queue red.
//     Now it stalls the run with a stated reason and resumes on sign-in.
//   * Connectivity failures no longer consume retry attempts. Only failures
//     the server actually produced count toward MAX_ATTEMPTS.
//   * Retries back off exponentially instead of re-firing every poll.
//   * A file already uploaded to its final object store is not uploaded twice.
//     Non-dataset files keep Cloudinary; queued dataset files use MinIO. The
//     upload result is persisted before /content so retries reuse it.
//   * Nothing is ever deleted on failure, and nothing reaches 'synced'
//     without a successful backend response — both unchanged from 3C, and
//     both now covered by the end-to-end checks in the README.

const ARTICLE_TYPES = ['report', 'publication'];

let syncing = false;
let listenersAttached = false;
let pollTimer = null;
let retryTimer = null;
let activeAbortController = null;

// Why the whole run is stalled, as opposed to why one item failed. null when
// the queue is simply working through its items.
let blockReason = null;

// In-memory only — see syncChannel.notifySyncState.
let progress = null; // { localId, loaded, total }

function emitState() {
  notifySyncState({ syncing, blockReason, progress });
}

function setBlockReason(reason) {
  if (blockReason === reason) return;
  blockReason = reason;
  emitState();
}

export function getSyncState() {
  return { syncing, blockReason, progress };
}

// --- session ---------------------------------------------------------------

// Decode the JWT's exp claim locally so an expired session is detected
// *before* firing a queue's worth of doomed requests at the server. Any
// parsing problem falls through to "let the server decide", which is the
// safe direction: a bad guess here would stall sync for no reason.
function isTokenExpired(token) {
  try {
    const [, payload] = token.split('.');
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!json.exp) return false;
    // 30s skew so we don't start an upload that expires mid-flight.
    return json.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

function sessionState() {
  const token = localStorage.getItem('ncpor_token');
  if (!token) return 'missing';
  if (isTokenExpired(token)) return 'expired';
  return 'valid';
}

function storedUserId() {
  try {
    const raw = localStorage.getItem('ncpor_user');
    return raw ? JSON.parse(raw)?.id || null : null;
  } catch {
    return null;
  }
}

// --- retry scheduling ------------------------------------------------------

function backoffDelay(attempts) {
  const base = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
  const jitter = base * RETRY_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(base + jitter));
}

function isDue(item) {
  return !item.nextAttemptAt || item.nextAttemptAt <= Date.now();
}

// Wake up exactly when the earliest backed-off item becomes eligible, rather
// than waiting for the next 30s poll — a 5s first retry should happen in 5s.
async function scheduleNextRetry() {
  clearTimeout(retryTimer);
  if (!navigator.onLine || blockReason === SYNC_BLOCK.AUTH) return;

  const [expeditions, content] = await Promise.all([listPendingExpeditions(), listPendingContent()]);
  const waits = [...expeditions, ...content]
    .filter((item) => item.status === QUEUE_STATUS.QUEUED && item.nextAttemptAt)
    .map((item) => item.nextAttemptAt - Date.now())
    .filter((delay) => delay > 0);

  if (waits.length === 0) return;
  retryTimer = setTimeout(() => runSync(), Math.min(...waits) + 250);
}

// --- failure handling ------------------------------------------------------

// Shared by both stores. Returns the classification so the calling loop can
// decide whether to stop the whole run.
async function applyFailure(markResult, claimed, syncToken, err) {
  const info = classifySyncError(err);
  const attempts = (claimed.attempts || 0) + (info.countAttempt ? 1 : 0);
  const exhausted = info.countAttempt && attempts >= MAX_ATTEMPTS;
  const giveUp = !info.retry || exhausted;

  await markResult(claimed, syncToken, {
    status: giveUp ? QUEUE_STATUS.FAILED : QUEUE_STATUS.QUEUED,
    attempts,
    lastError: exhausted ? `${info.message} (gave up after ${attempts} attempts)` : info.message,
    lastErrorKind: info.kind,
    needsAttention: giveUp,
    conflict: info.conflict ?? claimed.conflict ?? null,
    // A retryable item gets a backoff; a failed one waits for a human, so it
    // carries no schedule at all.
    nextAttemptAt: giveUp ? null : Date.now() + (info.retryAfterMs ?? backoffDelay(attempts)),
  });

  if (info.kind === ERROR_KIND.AUTH) setBlockReason(SYNC_BLOCK.AUTH);
  if (info.kind === ERROR_KIND.STORAGE) setBlockReason(SYNC_BLOCK.STORAGE);
  if (info.kind === ERROR_KIND.OFFLINE || info.kind === ERROR_KIND.ABORTED) {
    if (!navigator.onLine) setBlockReason(SYNC_BLOCK.OFFLINE);
  }

  return info;
}

const markContentResult = (item, syncToken, patch) =>
  updateClaimedPendingContent(item.localId, syncToken, patch);
const markExpeditionResult = (item, syncToken, patch) =>
  updateClaimedPendingExpedition(item.localId, syncToken, patch);

function requestConfig(extra = {}) {
  return { signal: activeAbortController?.signal, ...extra };
}

// --- content ---------------------------------------------------------------

async function syncOneItem(item) {
  const claimed = await claimPendingContent(item.localId);
  if (!claimed) return null;

  const { syncToken } = claimed;

  try {
    // Resume point. If a previous attempt got the bytes to their final store
    // but died before /content accepted the metadata, reuse that upload.
    // Scientific datasets always use MinIO; every other queued content type
    // preserves the existing Cloudinary path.
    let fileResult = claimed.uploadedFile || null;

    // A queue entry created by an older build may contain a Cloudinary
    // upload result for a dataset whose /content request never succeeded.
    // The original Blob is still present until sync succeeds, so ignore that
    // legacy result and send the dataset to MinIO under the final policy.
    if (claimed.type === 'dataset' && fileResult && !fileResult.upload_session_id) {
      fileResult = null;
    }

    if (claimed.file && !fileResult) {
      if (claimed.type === 'dataset') {
        const completed = await uploadDatasetMultipart(claimed.file, {
          ownerId: storedUserId(),
          onProgress: (datasetProgress) => {
            progress = {
              localId: claimed.localId,
              loaded: Number(datasetProgress?.uploadedBytes || 0),
              total: Number(datasetProgress?.totalBytes || claimed.file.size || 0),
            };
            emitState();
          },
        });

        fileResult = {
          storage_provider: 'minio',
          upload_session_id: completed.sessionId,
          object_key: completed.objectKey || null,
          original_file_name: completed.fileName || claimed.fileName || claimed.file.name || null,
          mime_type: completed.mimeType || claimed.file.type || 'application/octet-stream',
          file_size_bytes: Number(completed.fileSize || claimed.file.size || 0),
          checksum_sha256: completed.checksumSHA256 || null,
          upload_status: completed.uploadStatus || 'completed',
        };
      } else {
        const form = new FormData();
        form.append('file', claimed.file, claimed.fileName || 'upload');

        const uploadRes = await api.post(
          '/upload',
          form,
          requestConfig({
            headers: { 'Content-Type': 'multipart/form-data' },
            // Large expedition videos legitimately take a long time on a
            // satellite link; no client-side timeout should cut them off.
            timeout: 0,
            onUploadProgress: (event) => {
              progress = {
                localId: claimed.localId,
                loaded: event.loaded,
                total: event.total || claimed.file.size || 0,
              };
              emitState();
            },
          })
        );
        fileResult = uploadRes.data;
      }

      // Persist before the next request. status stays 'uploading' so this
      // worker keeps its claim and a metadata/API retry does not re-upload.
      await markContentResult(claimed, syncToken, {
        status: QUEUE_STATUS.UPLOADING,
        uploadedFile: fileResult,
      });
    }

    progress = null;
    emitState();

    const payload = {
      expedition_id: claimed.expeditionId,
      type: claimed.type,
      title: claimed.title,
      description: claimed.description,
      body: ARTICLE_TYPES.includes(claimed.type) ? claimed.body : undefined,
      summary: ARTICLE_TYPES.includes(claimed.type) ? claimed.summary : undefined,
      file_url: claimed.type === 'dataset' ? null : (fileResult?.file_url || null),
      thumbnail_url: fileResult?.thumbnail_url || null,
      mime_type: fileResult?.mime_type || claimed.file?.type || null,
      file_size_bytes: fileResult?.file_size_bytes || claimed.file?.size || claimed.fileSize || null,
      ...(claimed.type === 'dataset' && fileResult?.upload_session_id ? {
        storage_provider: 'minio',
        upload_session_id: fileResult.upload_session_id,
      } : {}),
      // Unchanged from Phase 4: the server treats this as an idempotency key,
      // so a retry after a lost response returns the original record instead
      // of creating a duplicate.
      client_request_id: claimed.localId,
    };
    if (claimed.type === 'dataset' && claimed.datasetMeta) {
      payload.datasetMeta = claimed.datasetMeta;
    }

    const { data: created } = await api.post('/content', payload, requestConfig());

    if (claimed.type === 'dataset' && fileResult?.upload_session_id) {
      try {
        await removeDatasetUploadSession(fileResult.upload_session_id);
      } catch (error) {
        console.warn('Could not clear completed dataset upload resume state:', error);
      }
    }

    await markContentResult(claimed, syncToken, {
      status: QUEUE_STATUS.SYNCED,
      attempts: claimed.attempts || 0,
      lastError: null,
      lastErrorKind: null,
      needsAttention: false,
      nextAttemptAt: null,
      remoteId: created?.id || null,
      syncedAt: Date.now(),
    });

    // Safe now, and only now: the bytes exist on the server. The queue record
    // itself is kept so the Sync Center can still show what was uploaded.
    await releaseSyncedContentFile(claimed.localId);

    return null;
  } catch (err) {
    progress = null;
    return applyFailure(markContentResult, claimed, syncToken, err);
  }
}

// --- expeditions -----------------------------------------------------------

async function syncOneExpedition(item) {
  const claimed = await claimPendingExpedition(item.localId);
  if (!claimed) return null;

  const { syncToken } = claimed;

  try {
    // Phase 8: existing-expedition edits use the same durable queue as new
    // expedition creates, but are distinguished by `operation`. The server
    // receives the version the edit was based on and refuses stale writes.
    if (claimed.operation === 'update') {
      const { data: updated } = await updateExpedition(
        claimed.expeditionId,
        claimed.changes || {},
        claimed.expectedUpdatedAt,
        claimed.clientRequestId,
        requestConfig()
      );
      await cacheExpedition(updated);
      await markExpeditionResult(claimed, syncToken, {
        status: QUEUE_STATUS.SYNCED,
        remoteId: claimed.expeditionId,
        attempts: claimed.attempts || 0,
        lastError: null,
        lastErrorKind: null,
        needsAttention: false,
        conflict: null,
        nextAttemptAt: null,
        syncedAt: Date.now(),
      });
      return null;
    }

    const payload = {
      name: claimed.name,
      region: claimed.region,
      description: claimed.description,
      start_date: claimed.start_date,
      end_date: claimed.end_date,
      latitude: claimed.latitude,
      longitude: claimed.longitude,
      principal_investigator: claimed.principal_investigator,
      client_request_id: claimed.localId,
    };

    const { data: created } = await api.post('/expeditions', payload, requestConfig());
    await reassignPendingContentExpedition(claimed.localId, created.id);
    await cacheExpedition(created);

    await markExpeditionResult(claimed, syncToken, {
      status: QUEUE_STATUS.SYNCED,
      remoteId: created.id,
      attempts: claimed.attempts || 0,
      lastError: null,
      lastErrorKind: null,
      needsAttention: false,
      nextAttemptAt: null,
      syncedAt: Date.now(),
    });

    return null;
  } catch (err) {
    return applyFailure(markExpeditionResult, claimed, syncToken, err);
  }
}

// --- run -------------------------------------------------------------------

function shouldStop(info) {
  if (!navigator.onLine) return true;
  if (blockReason === SYNC_BLOCK.AUTH || blockReason === SYNC_BLOCK.STORAGE) return true;
  return Boolean(info?.halt);
}

export async function runSync() {
  if (syncing) return;
  if (!navigator.onLine) {
    setBlockReason(SYNC_BLOCK.OFFLINE);
    return;
  }

  const session = sessionState();
  if (session !== 'valid') {
    // Queued work is untouched — it simply waits for a usable session. The
    // researcher sees "Sign in to sync" rather than a wall of failures. A
    // logged-out visitor with an empty queue has nothing to be warned about,
    // so the block is only raised when there is actually work waiting.
    setBlockReason((await hasPendingWork()) ? SYNC_BLOCK.AUTH : null);
    return;
  }

  setBlockReason(null);
  syncing = true;
  activeAbortController = new AbortController();
  emitState();

  try {
    // Expeditions first: a successful create unlocks its dependent content.
    const expeditions = await listPendingExpeditions();
    for (const item of expeditions.filter((e) => e.status === QUEUE_STATUS.QUEUED && isDue(e))) {
      const info = await syncOneExpedition(item);
      if (shouldStop(info)) return;
    }

    const content = await listPendingContent();
    const due = content.filter(
      (item) =>
        item.status === QUEUE_STATUS.QUEUED &&
        // Still waiting on an expedition that hasn't synced — not eligible.
        !item.localExpeditionId &&
        isDue(item)
    );

    for (const item of due) {
      const info = await syncOneItem(item);
      if (shouldStop(info)) return;
    }
  } catch (err) {
    // Anything that escapes the per-item handling — most plausibly IndexedDB
    // refusing a write because the device filled up mid-run. Stall the run
    // with a stated reason rather than dying silently; the queue is intact.
    if (isQuotaExceededError(err)) setBlockReason(SYNC_BLOCK.STORAGE);
    else console.error('Sync run stopped unexpectedly', err);
  } finally {
    activeAbortController = null;
    syncing = false;
    progress = null;
    if (blockReason === SYNC_BLOCK.OFFLINE && navigator.onLine) blockReason = null;
    emitState();
    void scheduleNextRetry();
  }
}

async function hasPendingWork() {
  const [expeditions, content] = await Promise.all([listPendingExpeditions(), listPendingContent()]);
  return [...expeditions, ...content].some((item) => item.status !== QUEUE_STATUS.SYNCED);
}

// 'uploading' is transient and owned by a live worker in one JS context. If
// the app has started again, no such worker exists, so those claims are
// recovered to 'queued' — including any uploadedFile already obtained, which
// is exactly what lets the retry skip re-uploading.
async function recoverInterruptedUploads() {
  const [expeditions, content] = await Promise.all([listPendingExpeditions(), listPendingContent()]);

  await Promise.all([
    ...expeditions
      .filter((item) => item.status === QUEUE_STATUS.UPLOADING)
      .map((item) =>
        updatePendingExpedition(item.localId, {
          status: QUEUE_STATUS.QUEUED,
          syncToken: undefined,
          syncStartedAt: undefined,
          nextAttemptAt: null,
        })
      ),
    ...content
      .filter((item) => item.status === QUEUE_STATUS.UPLOADING)
      .map((item) =>
        updatePendingContent(item.localId, {
          status: QUEUE_STATUS.QUEUED,
          syncToken: undefined,
          syncStartedAt: undefined,
          nextAttemptAt: null,
        })
      ),
  ]);
}

export function initSyncManager() {
  if (listenersAttached) return;
  listenersAttached = true;

  // Ask the browser not to evict this origin. The queue is the only copy of
  // unsynced fieldwork, so silent eviction would be real data loss.
  void requestPersistentStorage();

  window.addEventListener('online', () => {
    setBlockReason(null);
    runSync();
  });

  window.addEventListener('offline', () => {
    setBlockReason(SYNC_BLOCK.OFFLINE);
    // Abort in-flight requests so the loop doesn't sit on a long browser
    // timeout. The catch path turns this into an ordinary queued retry —
    // the abort itself costs no attempt.
    activeAbortController?.abort();
  });

  // api/client.js fires this on any 401. Stop pushing at a dead session.
  window.addEventListener('ncpor:auth:logout', () => {
    setBlockReason(SYNC_BLOCK.AUTH);
    activeAbortController?.abort();
  });

  // AuthContext fires this after a successful login — the queue that stalled
  // on an expired token should resume immediately, not at the next poll.
  window.addEventListener('ncpor:auth:login', () => {
    setBlockReason(null);
    runSync();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) runSync();
  });

  recoverInterruptedUploads().then(() => {
    if (navigator.onLine) runSync();
    else setBlockReason(SYNC_BLOCK.OFFLINE);
  });

  pollTimer = setInterval(() => {
    if (navigator.onLine) runSync();
  }, SYNC_POLL_MS);

  void pollTimer;
}
