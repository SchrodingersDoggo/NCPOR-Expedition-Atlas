export function stableSavedDatasetFingerprint(item, downloadMetadata) {
  const authoritative = String(downloadMetadata?.datasetFingerprint || item?.datasetFingerprint || '').trim();
  return authoritative || null;
}

export function legacyOfflineDatasetFingerprint(savedDataset, selectedDataset = null) {
  const id = savedDataset?.id ?? selectedDataset?.id ?? '';
  const updatedAt = selectedDataset?.updatedAt || savedDataset?.updatedAt || '';
  const size = savedDataset?.offlineFile?.blob?.size || 0;
  return `offline:${id}:${updatedAt}:${size}`;
}

export function resolveOfflineDatasetFingerprint(savedDataset, selectedDataset = null) {
  const stable = String(savedDataset?.datasetFingerprint || '').trim();
  return stable || legacyOfflineDatasetFingerprint(savedDataset, selectedDataset);
}
