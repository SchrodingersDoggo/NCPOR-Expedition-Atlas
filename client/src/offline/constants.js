// Shared constants for the offline queue (Phase A). No behavior lives here —
// just names/enums that db.js, queue.js, and later the sync manager (Phase C)
// all need to agree on.

export const DB_NAME = 'ncpor-offline';
export const DB_VERSION = 6;

// Two stores: expeditions logged in the field before they exist on the
// server, and the content items (reports/photos/datasets/etc.) queued
// against either a real or not-yet-synced expedition.
export const STORE_PENDING_EXPEDITIONS = 'pendingExpeditions';
export const STORE_PENDING_CONTENT = 'pendingContent';
export const STORE_EXPEDITION_CACHE = 'expeditionCache';

// Phase 4 — a single cached snapshot of the globe's expedition list, so the
// landing page's offline/lightweight view has something to render without a
// network call. Keyed by a fixed id since there's only ever one snapshot.
export const STORE_GLOBE_CACHE = 'globeCache';
export const GLOBE_CACHE_KEY = 'expeditions-for-globe';

// Researcher-selected expedition records (Archive/"Save for offline")
// that must remain readable without a network connection. Blobs are
// stored alongside the metadata so opening a saved report/photo/dataset
// never depends on Cloudinary being reachable.
export const STORE_SAVED_EXPEDITIONS = 'savedExpeditions';

// Phase 6 multipart dataset resume state. This store contains metadata only —
// never the dataset File/Blob itself — so multi-GB uploads do not consume
// IndexedDB quota merely to be resumable.
export const STORE_DATASET_UPLOADS = 'datasetMultipartUploads';

// Visualization schema added in DB_VERSION 6. These stores are additive only:
// they must never replace or clear the existing offline/save-upload stores.
export const STORE_VIZ_MAPPINGS = 'vizMappings';
export const STORE_VIZ_CACHE = 'vizCache';

// Lifecycle of a queue entry. 'uploading' is a transient state a live sync
// run sets — anything found still 'uploading' on app start (Phase C) means
// the tab closed mid-upload and it should be treated as retryable, not lost.
export const QUEUE_STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  SYNCED: 'synced',
  FAILED: 'failed',
};

// BroadcastChannel name so multiple tabs (nav bar badge, upload page, a
// future "My Uploads" list) all see the same queue state without polling.
export const SYNC_CHANNEL_NAME = 'ncpor-sync';

// Phase 7 — retry policy. MAX_ATTEMPTS is unchanged from Phase 3C, but only
// failures the server actually produced count toward it now (see errors.js).
export const MAX_ATTEMPTS = 5;

// Exponential backoff between attempts, so a struggling server or a flaky
// uplink isn't hammered every poll interval. Jitter keeps several tabs (or
// several researchers reconnecting off the same satellite window) from
// retrying in lockstep.
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 5 * 60 * 1000;
export const RETRY_JITTER_RATIO = 0.25;

// How often the sync manager re-checks the queue when nothing else wakes it.
export const SYNC_POLL_MS = 30_000;

// Why the whole sync run is stalled — distinct from any single item's error.
// Shown in the navbar and the Sync Center so a researcher knows whether the
// portal is waiting on them (sign in) or on the world (connection).
export const SYNC_BLOCK = {
  AUTH: 'auth',
  OFFLINE: 'offline',
  STORAGE: 'storage',
};
