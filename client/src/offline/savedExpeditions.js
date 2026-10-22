import { getDb } from './db.js';
import { STORE_SAVED_EXPEDITIONS } from './constants.js';
import { ensureSpaceFor, withStorageErrors } from './storage.js';
import { fetchContentDownload } from '../api/content.js';
import { stableSavedDatasetFingerprint } from './datasetFingerprint.js';

export const MAX_AUTOMATIC_OFFLINE_DATASET_BYTES = 100 * 1024 * 1024;

export function isLargeMinioDatasetForAutomaticOfflineCache(item) {
  if (!item || item.type !== 'dataset') return false;
  if (String(item.storageProvider || '').toLowerCase() !== 'minio') return false;
  const size = Number(item.fileSizeBytes ?? item.file_size_bytes);
  return Number.isFinite(size) && size > MAX_AUTOMATIC_OFFLINE_DATASET_BYTES;
}

function knownByteSize(...values) {
  for (const value of values) {
    const size = Number(value);
    if (Number.isFinite(size) && size > 0) return size;
  }
  return 0;
}

function expectedOfflineBytesForItem(item) {
  if (!item) return 0;

  let bytes = 0;
  const shouldCacheFile = item.type === 'dataset'
    ? !isLargeMinioDatasetForAutomaticOfflineCache(item)
    : Boolean(item.fileUrl);

  if (shouldCacheFile) {
    bytes += knownByteSize(item.fileSizeBytes, item.file_size_bytes, item.size);
  }

  if (item.thumbnailUrl && item.thumbnailUrl !== item.fileUrl) {
    bytes += knownByteSize(
      item.thumbnailSizeBytes,
      item.thumbnail_size_bytes,
      item.thumbnailFileSizeBytes,
      item.thumbnail_file_size_bytes
    );
  }

  return bytes;
}

function storageKey(ownerId, expeditionId) {
  return `${ownerId}:${expeditionId}`;
}

function filenameFromUrl(url, fallback) {
  if (!url) return fallback;
  try {
    const last = new URL(url, window.location.origin).pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(last || fallback);
  } catch {
    return fallback;
  }
}

async function downloadBlob(url, fallbackName) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return {
      blob,
      name: filenameFromUrl(url, fallbackName),
      type: blob.type || 'application/octet-stream',
    };
  } catch (error) {
    console.warn('Could not cache offline file:', url, error);
    return null;
  }
}

async function cacheContentItem(item) {
  let offlineFile = null;
  let datasetFingerprint = item?.datasetFingerprint || null;

  if (item.type === 'dataset') {
    // Multi-GB MinIO datasets must never be pulled into IndexedDB just
    // because the researcher saves the surrounding expedition offline.
    // Keep the dataset metadata in the saved expedition, but only fetch the
    // file automatically when it is within the existing safe offline size
    // boundary. Historical Cloudinary-backed datasets keep their previous
    // behavior for backward compatibility.
    if (!isLargeMinioDatasetForAutomaticOfflineCache(item)) {
      try {
        const download = await fetchContentDownload(item.id);
        datasetFingerprint = stableSavedDatasetFingerprint(item, download);
        offlineFile = await downloadBlob(
          download?.url,
          download?.fileName || `${item.title || item.id}-file`
        );
      } catch (error) {
        // The secure download endpoint is the source of truth for dataset
        // access. If access is denied (or the file is otherwise unavailable),
        // leave this dataset uncached rather than falling back to a hidden
        // storage locator.
        console.warn('Could not cache offline dataset:', item.id, error);
      }
    }
  } else {
    offlineFile = await downloadBlob(item.fileUrl, `${item.title || item.id}-file`);
  }

  let offlineThumbnail = null;
  if (item.thumbnailUrl && item.thumbnailUrl !== item.fileUrl) {
    offlineThumbnail = await downloadBlob(item.thumbnailUrl, `${item.title || item.id}-thumbnail`);
  }

  return {
    ...item,
    ...(item.type === 'dataset' && datasetFingerprint ? { datasetFingerprint } : {}),
    offlineFile,
    offlineThumbnail,
  };
}

export async function saveExpeditionOffline({ ownerId, expedition, content }) {
  if (!ownerId || !expedition?.id) throw new Error('A signed-in researcher and expedition are required.');

  const groups = ['reports', 'photos', 'data'];
  const savedContent = {};
  let totalFiles = 0;
  let savedFiles = 0;

  // Best-effort preflight using the sizes the API already knows. This avoids
  // spending scarce bandwidth downloading large Blobs only to discover later
  // that IndexedDB cannot fit them. Unknown sizes are deliberately ignored;
  // the actual Blob-size check below remains the final safety net.
  const expectedBytes = groups.reduce((sum, group) => {
    const items = Array.isArray(content?.[group]) ? content[group] : [];
    return sum + items.reduce((groupSum, item) => groupSum + expectedOfflineBytesForItem(item), 0);
  }, 0);
  if (expectedBytes) await ensureSpaceFor(expectedBytes);

  for (const group of groups) {
    const items = Array.isArray(content?.[group]) ? content[group] : [];
    savedContent[group] = [];
    for (const item of items) {
      if (item.type === 'dataset' || item.fileUrl) totalFiles += 1;
      const saved = await cacheContentItem(item);
      if (saved.offlineFile) savedFiles += 1;
      savedContent[group].push(saved);
    }
  }

  // Same Phase 7 safety net the sync queue uses: a researcher saving a
  // handful of expeditions' worth of photos/videos for offline reading can
  // fill a device just as easily as the upload queue can, and a silent
  // QuotaExceededError here would look like "Save offline" simply did
  // nothing.
  const totalBytes = [
    ...Object.values(savedContent).flat(),
  ].reduce((sum, item) => sum + (item.offlineFile?.blob?.size || 0) + (item.offlineThumbnail?.blob?.size || 0), 0);
  if (totalBytes) await ensureSpaceFor(totalBytes);

  const db = await getDb();
  const record = {
    storageKey: storageKey(ownerId, expedition.id),
    ownerId,
    expeditionId: expedition.id,
    expedition,
    content: savedContent,
    savedAt: new Date().toISOString(),
    totalFiles,
    savedFiles,
  };
  await withStorageErrors(() => db.put(STORE_SAVED_EXPEDITIONS, record), expedition.name || 'this expedition');

  // Best effort, non-blocking: cache the visualizer code these datasets need so
  // they can also be visualized offline. Skipped in Low Bandwidth mode.
  void import('../viz/offlineWarmup.js')
    .then((module) => module.warmVisualizerForOffline(savedContent))
    .catch(() => {});
  return record;
}

export async function getSavedExpeditions(ownerId) {
  if (!ownerId) return [];
  const db = await getDb();
  const all = await db.getAll(STORE_SAVED_EXPEDITIONS);
  return all
    .filter((item) => item.ownerId === ownerId)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

export async function getSavedExpedition(ownerId, expeditionId) {
  if (!ownerId || !expeditionId) return null;
  const db = await getDb();
  return (await db.get(STORE_SAVED_EXPEDITIONS, storageKey(ownerId, expeditionId))) || null;
}

export async function isExpeditionSaved(ownerId, expeditionId) {
  return Boolean(await getSavedExpedition(ownerId, expeditionId));
}

export async function removeSavedExpedition(ownerId, expeditionId) {
  const db = await getDb();
  await db.delete(STORE_SAVED_EXPEDITIONS, storageKey(ownerId, expeditionId));
}
