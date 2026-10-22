import {
  STORE_PENDING_EXPEDITIONS,
  STORE_PENDING_CONTENT,
  STORE_EXPEDITION_CACHE,
  STORE_GLOBE_CACHE,
  STORE_SAVED_EXPEDITIONS,
  STORE_DATASET_UPLOADS,
  STORE_VIZ_MAPPINGS,
  STORE_VIZ_CACHE,
} from './constants.js';

// Keep the upgrade logic isolated and additive so it can be regression-tested
// without changing the semantics of existing offline stores.
export function upgradeOfflineDatabase(db) {
  // pendingExpeditions — keyed by the client-generated localId (a
  // real expedition doesn't exist yet, so there's no server id to
  // key on). Indexed by status so the sync manager (Phase C) can
  // cheaply ask "what's still queued?" without scanning everything.
  if (!db.objectStoreNames.contains(STORE_PENDING_EXPEDITIONS)) {
    const store = db.createObjectStore(STORE_PENDING_EXPEDITIONS, { keyPath: 'localId' });
    store.createIndex('status', 'status');
    store.createIndex('createdAt', 'createdAt');
  }

  // expeditionCache — server expeditions the researcher has opened.
  // These records let the expedition editor reopen offline; they are a
  // cache, not the source of truth for unsynced queue work.
  if (!db.objectStoreNames.contains(STORE_EXPEDITION_CACHE)) {
    const store = db.createObjectStore(STORE_EXPEDITION_CACHE, { keyPath: 'id' });
    store.createIndex('updatedAt', 'updatedAt');
  }

  // pendingContent — same shape of indexing. Each entry may carry a
  // localExpeditionId (points at a pendingExpeditions row) instead of
  // a real expeditionId, until that expedition itself has synced —
  // that dependency resolution is Phase B/C, not stored here.
  if (!db.objectStoreNames.contains(STORE_PENDING_CONTENT)) {
    const store = db.createObjectStore(STORE_PENDING_CONTENT, { keyPath: 'localId' });
    store.createIndex('status', 'status');
    store.createIndex('createdAt', 'createdAt');
  }

  // globeCache — Phase 4. A single row holding the last successful
  // fetchExpeditionsForGlobe() result, so the landing page's
  // lightweight/offline view has real data to show without a network
  // call. Not the source of truth for anything — purely a read cache.
  if (!db.objectStoreNames.contains(STORE_GLOBE_CACHE)) {
    db.createObjectStore(STORE_GLOBE_CACHE, { keyPath: 'id' });
  }

  // savedExpeditions — DB_VERSION 4. Researcher-selected expedition
  // records (with their content blobs) explicitly saved for offline
  // reading via the Archive/"Save for offline" flow. Separate from
  // expeditionCache: that store is an incidental cache of whatever was
  // last opened, this one is a deliberate, durable "keep this" choice
  // that survives until the researcher removes it.
  if (!db.objectStoreNames.contains(STORE_SAVED_EXPEDITIONS)) {
    const store = db.createObjectStore(STORE_SAVED_EXPEDITIONS, { keyPath: 'storageKey' });
    store.createIndex('ownerId', 'ownerId');
    store.createIndex('savedAt', 'savedAt');
  }

  // datasetMultipartUploads — DB_VERSION 5. Resumable MinIO control
  // state only. Deliberately no File/Blob field: after a page restart
  // the researcher reselects the same local file and we verify its
  // identity before continuing only the missing multipart parts.
  if (!db.objectStoreNames.contains(STORE_DATASET_UPLOADS)) {
    const store = db.createObjectStore(STORE_DATASET_UPLOADS, { keyPath: 'sessionId' });
    store.createIndex('ownerId', 'ownerId');
    store.createIndex('status', 'status');
    store.createIndex('updatedAt', 'updatedAt');
  }

  // Visualization mappings — DB_VERSION 6. Mapping keys include the
  // immutable dataset fingerprint so a replaced file cannot silently reuse
  // an old coordinate/variable mapping. The owner index prevents callers
  // from accidentally treating mappings as cross-account state.
  if (!db.objectStoreNames.contains(STORE_VIZ_MAPPINGS)) {
    const store = db.createObjectStore(STORE_VIZ_MAPPINGS, { keyPath: 'mappingKey' });
    store.createIndex('ownerId', 'ownerId');
    store.createIndex('contentId', 'contentId');
    store.createIndex('updatedAt', 'updatedAt');
  }

  // Visualization cache — created now to avoid another IndexedDB version
  // bump later. V2 does not store source datasets here; V6 will make fuller
  // use of this store for derived/bounded visualization products.
  if (!db.objectStoreNames.contains(STORE_VIZ_CACHE)) {
    const store = db.createObjectStore(STORE_VIZ_CACHE, { keyPath: 'cacheKey' });
    store.createIndex('ownerId', 'ownerId');
    store.createIndex('contentId', 'contentId');
    store.createIndex('updatedAt', 'updatedAt');
  }
}

