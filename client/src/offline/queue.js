import { getDb } from './db.js';
import { notifyQueueChanged } from './syncChannel.js';
import { ensureSpaceFor, withStorageErrors } from './storage.js';
import {
  STORE_PENDING_EXPEDITIONS,
  STORE_PENDING_CONTENT,
  STORE_EXPEDITION_CACHE,
  QUEUE_STATUS,
} from './constants.js';

// Everything here is store-agnostic CRUD — callers pass one of the STORE_*
// constants. No network, no file-upload logic, no submit-flow wiring lives
// here; that's Phase B. This module's only job is "reliably get data in and
// out of IndexedDB."

// crypto.randomUUID() is supported in all current evergreen browsers and
// needs no extra dependency (the server already uses the npm `uuid`
// package for its own ids — this is the client-side equivalent).
export function generateLocalId() {
  return crypto.randomUUID();
}

// Adds a new entry. Callers supply their own record shape (expedition form
// fields, or a content item's fields + file Blob) — this just stamps the
// bookkeeping fields every queue entry needs regardless of store.
export async function enqueue(storeName, record) {
  const db = await getDb();

  // Phase 7: check before writing. A QuotaExceededError thrown halfway
  // through storing a 90MB blob leaves the researcher with an opaque failure
  // and no file; checking first lets the UI say what is actually wrong while
  // the file is still in their hands.
  if (record.file?.size) {
    await ensureSpaceFor(record.file.size);
  }

  const entry = {
    ...record,
    localId: record.localId || generateLocalId(),
    status: QUEUE_STATUS.QUEUED,
    attempts: 0,
    lastError: null,
    // Phase 7 bookkeeping: which *kind* of failure was last seen, when the
    // item next becomes eligible (backoff), whether a human needs to look at
    // it, and any server-side conflict payload to show them.
    lastErrorKind: null,
    nextAttemptAt: null,
    needsAttention: false,
    conflict: null,
    fileSize: record.file?.size ?? record.fileSize ?? null,
    createdAt: record.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  await withStorageErrors(() => db.put(storeName, entry), record.fileName || record.title || record.name || 'this item');
  notifyQueueChanged();
  return entry;
}

export async function listQueue(storeName) {
  const db = await getDb();
  return db.getAll(storeName);
}

export async function listQueueByStatus(storeName, status) {
  const db = await getDb();
  return db.getAllFromIndex(storeName, 'status', status);
}

export async function getQueueItem(storeName, localId) {
  const db = await getDb();
  return db.get(storeName, localId);
}

// Partial update — reads, merges, writes back. Used for things like
// bumping status/attempts/lastError as a sync attempt progresses (Phase C
// territory, but the primitive belongs here with the rest of the CRUD).
export async function updateQueueItem(storeName, localId, patch) {
  const db = await getDb();
  const existing = await db.get(storeName, localId);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  await db.put(storeName, updated);
  notifyQueueChanged();
  return updated;
}

// Atomically claim a queued item for one sync worker. This prevents repeated
// online events, polling, or multiple tabs from processing the same item at
// the same time. The IndexedDB transaction is the source of truth for the
// claim; callers must only continue when this returns a record.
export async function claimQueueItem(storeName, localId) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const existing = await store.get(localId);

  if (!existing || existing.status !== QUEUE_STATUS.QUEUED) {
    await tx.done;
    return null;
  }

  const claimed = {
    ...existing,
    status: QUEUE_STATUS.UPLOADING,
    syncToken: generateLocalId(),
    syncStartedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.put(claimed);
  await tx.done;
  notifyQueueChanged();
  return claimed;
}

// Update only if this sync worker still owns the item. If another worker
// recovered/reclaimed the row after a refresh, stale work must not be able to
// mark that newer attempt as synced/failed.
export async function updateClaimedQueueItem(storeName, localId, syncToken, patch) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const existing = await store.get(localId);

  if (!existing || existing.syncToken !== syncToken || existing.status !== QUEUE_STATUS.UPLOADING) {
    await tx.done;
    return null;
  }

  const updated = {
    ...existing,
    ...patch,
    syncToken: patch.status === QUEUE_STATUS.UPLOADING ? syncToken : undefined,
    syncStartedAt: patch.status === QUEUE_STATUS.UPLOADING ? existing.syncStartedAt : undefined,
    updatedAt: Date.now(),
  };
  await store.put(updated);
  await tx.done;
  notifyQueueChanged();
  return updated;
}

export async function removeQueueItem(storeName, localId) {
  const db = await getDb();
  await db.delete(storeName, localId);
  notifyQueueChanged();
}

// Convenience wrappers for the two stores, so call sites (e.g. UploadPage
// in Phase B) don't need to import the STORE_* constants directly.
export const enqueueExpedition = (record) => enqueue(STORE_PENDING_EXPEDITIONS, record);
export const listPendingExpeditions = () => listQueue(STORE_PENDING_EXPEDITIONS);
export const updatePendingExpedition = (localId, patch) => updateQueueItem(STORE_PENDING_EXPEDITIONS, localId, patch);
export const claimPendingExpedition = (localId) => claimQueueItem(STORE_PENDING_EXPEDITIONS, localId);
export const updateClaimedPendingExpedition = (localId, syncToken, patch) => updateClaimedQueueItem(STORE_PENDING_EXPEDITIONS, localId, syncToken, patch);
export const removePendingExpedition = (localId) => removeQueueItem(STORE_PENDING_EXPEDITIONS, localId);

export const enqueueContent = (record) => enqueue(STORE_PENDING_CONTENT, record);
export const listPendingContent = () => listQueue(STORE_PENDING_CONTENT);
export const updatePendingContent = (localId, patch) => updateQueueItem(STORE_PENDING_CONTENT, localId, patch);
export const claimPendingContent = (localId) => claimQueueItem(STORE_PENDING_CONTENT, localId);
export const updateClaimedPendingContent = (localId, syncToken, patch) => updateClaimedQueueItem(STORE_PENDING_CONTENT, localId, syncToken, patch);
export const removePendingContent = (localId) => removeQueueItem(STORE_PENDING_CONTENT, localId);

// Phase 3B: once a locally-created expedition has synced and been given a
// real server id, every pendingContent row that was queued against it (via
// localExpeditionId, since no real id existed yet) needs to switch over to
// the real expeditionId so it becomes eligible for the ordinary Phase 3A
// content sync. Done as a single cursor pass over the whole store (there's
// no index on localExpeditionId, and the queue is expected to stay small —
// a researcher's field session, not a bulk import) inside one readwrite
// transaction, so a crash mid-pass can't leave some items reassigned and
// others not.
//
// localExpeditionId is deleted outright (not just set to undefined) so a
// resolved item's shape matches one that was always attached to a real
// expedition — nothing downstream has to treat "key present but falsy"
// specially.
export async function reassignPendingContentExpedition(localExpeditionId, realExpeditionId) {
  const db = await getDb();
  const tx = db.transaction(STORE_PENDING_CONTENT, 'readwrite');
  const store = tx.objectStore(STORE_PENDING_CONTENT);
  let reassigned = 0;

  let cursor = await store.openCursor();
  while (cursor) {
    const item = cursor.value;
    if (item.localExpeditionId === localExpeditionId) {
      const { localExpeditionId: _drop, ...rest } = item;
      await cursor.update({
        ...rest,
        expeditionId: realExpeditionId,
        updatedAt: Date.now(),
      });
      reassigned += 1;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  if (reassigned > 0) notifyQueueChanged();
  return reassigned;
}

// ---------------------------------------------------------------------------
// Phase 7 helpers
// ---------------------------------------------------------------------------

// Full reset of an item's failure bookkeeping. Used by the Sync Center's
// retry buttons: a human has looked at the problem, so clear the backoff and
// the attempt count rather than making them wait out an exponential delay
// that was calculated for an unattended machine.
export function resetQueueItemForRetry(storeName, localId) {
  return updateQueueItem(storeName, localId, {
    status: QUEUE_STATUS.QUEUED,
    attempts: 0,
    lastError: null,
    lastErrorKind: null,
    nextAttemptAt: null,
    needsAttention: false,
    conflict: null,
    syncToken: undefined,
    syncStartedAt: undefined,
  });
}

// Once an item is safely on the server, its local Blob is a duplicate of
// something durable elsewhere — and on a field laptop a handful of synced
// videos is the difference between being able to queue tomorrow's work and
// not. The *record* is kept (title, size, remote id, timestamps) so nothing
// vanishes from the Sync Center; only the bytes are released.
export async function releaseSyncedFile(storeName, localId) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  const existing = await store.get(localId);

  if (!existing || existing.status !== QUEUE_STATUS.SYNCED || !existing.file) {
    await tx.done;
    return null;
  }

  const { file: _blob, ...rest } = existing;
  const updated = {
    ...rest,
    fileReleased: true,
    fileSize: existing.fileSize ?? _blob?.size ?? null,
    updatedAt: Date.now(),
  };
  await store.put(updated);
  await tx.done;
  notifyQueueChanged();
  return updated;
}

// Explicit user action only ("Clear synced records"). Never called
// automatically — a researcher should be able to open the Sync Center after a
// season and still see what was uploaded and when.
export async function clearSyncedRecords() {
  const db = await getDb();
  let removed = 0;

  for (const storeName of [STORE_PENDING_EXPEDITIONS, STORE_PENDING_CONTENT]) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let cursor = await store.openCursor();
    while (cursor) {
      if (cursor.value.status === QUEUE_STATUS.SYNCED) {
        await cursor.delete();
        removed += 1;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  if (removed > 0) notifyQueueChanged();
  return removed;
}

// Total bytes currently held by unsynced queue entries — shown next to the
// browser's storage estimate so the researcher can see how much of the
// device's space is this app's pending work.
export async function getQueuedBytes() {
  const [expeditions, content] = await Promise.all([
    listQueue(STORE_PENDING_EXPEDITIONS),
    listQueue(STORE_PENDING_CONTENT),
  ]);
  return [...expeditions, ...content]
    .filter((item) => item.status !== QUEUE_STATUS.SYNCED)
    .reduce((total, item) => total + (item.file?.size ?? item.fileSize ?? 0), 0);
}

export const resetPendingExpeditionForRetry = (localId) => resetQueueItemForRetry(STORE_PENDING_EXPEDITIONS, localId);
export const resetPendingContentForRetry = (localId) => resetQueueItemForRetry(STORE_PENDING_CONTENT, localId);
export const releaseSyncedContentFile = (localId) => releaseSyncedFile(STORE_PENDING_CONTENT, localId);


// Phase 8 — cache an expedition that has been opened online so its editor can
// be reopened offline. Cache writes are best-effort: the authoritative copy
// is still the server, while pending edits live in the queue below.
export async function cacheExpedition(expedition) {
  if (!expedition?.id) return null;
  const db = await getDb();
  const cached = { ...expedition, cachedAt: Date.now() };
  await db.put(STORE_EXPEDITION_CACHE, cached);
  return cached;
}

export async function getCachedExpedition(id) {
  if (!id) return null;
  const db = await getDb();
  return db.get(STORE_EXPEDITION_CACHE, id);
}

// Offline edits are ordinary queue records, but live in the expedition queue
// because they must be processed before dependent content. `operation` keeps
// create and update semantics explicit without introducing another database.
export async function enqueueExpeditionEdit({ expeditionId, expectedUpdatedAt, changes }) {
  return enqueue(STORE_PENDING_EXPEDITIONS, {
    localId: generateLocalId(),
    operation: 'update',
    expeditionId,
    expectedUpdatedAt,
    clientRequestId: generateLocalId(),
    changes,
    name: changes?.name || 'Expedition edit',
  });
}
