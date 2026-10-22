// Phase 7 — device storage safety for the offline queue.
//
// Two distinct failures are handled here, and neither may be silent:
//
//   1. Eviction. A browser may clear IndexedDB for a site "under storage
//      pressure" without asking. For a researcher whose only copy of three
//      days of Antarctic fieldwork is in that database, that is data loss.
//      requestPersistentStorage() asks the browser to exempt this origin.
//
//   2. Running out of room. Queuing a 90MB video into a nearly-full origin
//      throws QuotaExceededError deep inside idb, which previously surfaced
//      as a generic "Submission failed" alert — the researcher had no idea
//      the file had not been saved. ensureSpaceFor() checks first, and
//      OfflineStorageError carries a message worth showing a human.

import { isQuotaExceededError } from './errors.js';

// Headroom kept free so the queue can never fill the origin completely —
// IndexedDB needs room for its own transaction/journal overhead, and an
// origin with literally zero bytes left cannot even record a status change.
const RESERVE_BYTES = 50 * 1024 * 1024; // 50MB

// Above this fraction of the quota the Sync Center shows a warning, so the
// researcher finds out on the ship rather than at the moment a file is lost.
export const STORAGE_WARN_RATIO = 0.8;

export class OfflineStorageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OfflineStorageError';
    // Lets classifySyncError() recognise this as a storage problem even
    // after it has crossed a module boundary as a generic Error.
    this.__ncporStorage = true;
    this.details = details;
  }
}

export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// Ask the browser to make this origin's storage persistent (exempt from
// automatic eviction). Chrome grants it silently for installed/engaged
// sites; Firefox prompts; Safari ignores it. Failure is not fatal — it just
// means the ordinary best-effort guarantees apply, which is what we had
// before Phase 7 anyway.
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) {
    return { supported: false, usage: null, quota: null, available: null, ratio: null, persisted: false };
  }

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return {
      supported: true,
      usage,
      quota,
      available: Math.max(0, quota - usage),
      ratio: quota > 0 ? usage / quota : null,
      persisted,
    };
  } catch {
    return { supported: false, usage: null, quota: null, available: null, ratio: null, persisted: false };
  }
}

// Throws OfflineStorageError when `bytes` plausibly will not fit. Browsers
// only report an approximate (and deliberately padded) quota, so this is a
// guard against the obvious case, not a guarantee — enqueue() still has to
// catch a real QuotaExceededError from the write itself.
export async function ensureSpaceFor(bytes) {
  if (!bytes) return;

  const estimate = await getStorageEstimate();
  if (!estimate.supported || estimate.available == null) return;

  if (estimate.available - bytes < RESERVE_BYTES) {
    throw new OfflineStorageError(
      `Not enough space on this device to save ${formatBytes(bytes)} offline. ` +
        `About ${formatBytes(estimate.available)} is free. Sync or remove some queued items first.`,
      { requested: bytes, available: estimate.available }
    );
  }
}

// Wraps any IndexedDB write so a quota failure becomes an explicit, catchable
// error with a readable message instead of an opaque DOMException.
export async function withStorageErrors(operation, context = '') {
  try {
    return await operation();
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new OfflineStorageError(
        `This device is out of space${context ? ` while saving ${context}` : ''}. ` +
          'Nothing was saved — free up space or sync pending items, then try again.',
        { cause: err }
      );
    }
    throw err;
  }
}
