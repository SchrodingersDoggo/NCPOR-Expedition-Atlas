import { canReadDataset } from './registry.js';

export function datasetFileName(item = {}) {
  return item.originalFileName || item.fileName || item.title || '';
}

export function isV3SupportedDataset(item) {
  return canReadDataset(datasetFileName(item));
}

// A valid explicit query always wins, even when that exact dataset is not
// supported by the V3 readers; the page can then explain the limitation and
// still offer the original download. Without a valid explicit query, prefer
// the first dataset the current visualizer can actually read.
export function resolveDatasetSelection(datasets = [], requestedId = '') {
  const items = Array.isArray(datasets) ? datasets : [];
  const requested = String(requestedId || '');
  if (requested) {
    const exact = items.find((item) => String(item?.id) === requested);
    if (exact) {
      return {
        selected: exact,
        selectedId: String(exact.id),
        reason: 'requested',
        supported: isV3SupportedDataset(exact),
      };
    }
  }

  const supported = items.find(isV3SupportedDataset);
  const fallback = supported || items[0] || null;
  return {
    selected: fallback,
    selectedId: fallback ? String(fallback.id) : '',
    reason: supported ? 'first-supported' : fallback ? 'first-available' : 'none',
    supported: Boolean(fallback && isV3SupportedDataset(fallback)),
  };
}
