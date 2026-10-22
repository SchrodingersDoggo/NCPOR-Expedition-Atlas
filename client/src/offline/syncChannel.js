import { SYNC_CHANNEL_NAME } from './constants.js';

// Thin wrapper around BroadcastChannel so the rest of the app doesn't touch
// the raw API directly. Purely a "something changed, go re-read the queue"
// signal — it never carries the actual data, to avoid two tabs disagreeing
// about what's in IndexedDB (the DB itself is always the source of truth).
//
// Not supported in every environment (older Safari) — falls back to a
// no-op so a missing BroadcastChannel never breaks the app; cross-tab
// updates just won't be instant in that case (a manual refresh/reopen
// still picks up the true state, since it reads straight from IndexedDB).
const supported = typeof BroadcastChannel !== 'undefined';
const channel = supported ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
const localListeners = new Set();

// Events: 'queue:changed' after any enqueue/update/remove.
export function notifyQueueChanged() {
  channel?.postMessage({ type: 'queue:changed' });
  for (const callback of localListeners) callback();
}

// Phase 7 — live run state (upload progress, why a run is stalled). Kept
// deliberately separate from 'queue:changed': progress fires many times per
// second for a large video, and persisting that to IndexedDB just to move a
// progress bar would write thousands of records for one upload. This state
// is in-memory and tab-local by design — the only source of truth that
// survives a reload is still the queue itself.
const stateListeners = new Set();

export function notifySyncState(state) {
  for (const callback of stateListeners) callback(state);
}

export function onSyncState(callback) {
  stateListeners.add(callback);
  return () => stateListeners.delete(callback);
}

// Returns an unsubscribe function.
export function onQueueChanged(callback) {
  localListeners.add(callback);
  const handler = (event) => {
    if (event.data?.type === 'queue:changed') callback();
  };
  if (channel) channel.addEventListener('message', handler);
  return () => {
    localListeners.delete(callback);
    channel?.removeEventListener('message', handler);
  };
}
