function encodePart(value) {
  return encodeURIComponent(String(value));
}

export function buildVizMappingKey({ ownerId = 'shared', contentId, datasetFingerprint }) {
  if (!contentId) throw new Error('contentId is required for a persistent visualization mapping.');
  if (!datasetFingerprint) throw new Error('datasetFingerprint is required for a persistent visualization mapping.');
  return `${encodePart(ownerId || 'shared')}::${encodePart(contentId)}::${encodePart(datasetFingerprint)}`;
}

export function buildVizCacheKey({ ownerId = 'shared', contentId, datasetFingerprint, mappingVersion, visualizerSchemaVersion }) {
  if (!contentId) throw new Error('contentId is required for a visualization cache key.');
  if (!datasetFingerprint) throw new Error('datasetFingerprint is required for a visualization cache key.');
  if (mappingVersion == null) throw new Error('mappingVersion is required for a visualization cache key.');
  if (visualizerSchemaVersion == null) throw new Error('visualizerSchemaVersion is required for a visualization cache key.');
  return `${encodePart(ownerId || 'shared')}::${encodePart(contentId)}::${encodePart(datasetFingerprint)}::m${encodePart(mappingVersion)}::v${encodePart(visualizerSchemaVersion)}`;
}
