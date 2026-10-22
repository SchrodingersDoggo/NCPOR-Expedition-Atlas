const MIB = 1024 * 1024;

// Browser-only safety limit for the complete multi-source dataset held for V4
// analysis. This does not affect MinIO storage/upload limits.
export const V4_AGGREGATE_MERGE_LIMIT = 200 * MIB;

export function assessV4AggregateMerge(sources = [], limit = V4_AGGREGATE_MERGE_LIMIT) {
  const normalized = sources.map((source) => ({
    ...source,
    fileSize: Number(source?.fileSize || 0),
  }));
  const unknown = normalized.filter((source) => !Number.isFinite(source.fileSize) || source.fileSize <= 0);
  const totalBytes = normalized.reduce((sum, source) => sum + (Number.isFinite(source.fileSize) && source.fileSize > 0 ? source.fileSize : 0), 0);
  const networkBytes = normalized.reduce((sum, source) => sum + (!source?.local && Number.isFinite(source.fileSize) && source.fileSize > 0 ? source.fileSize : 0), 0);
  const allowed = unknown.length === 0 && totalBytes <= limit;
  return {
    sourceCount: normalized.length,
    totalBytes,
    networkBytes,
    limit,
    allowed,
    unknownCount: unknown.length,
    reason: unknown.length
      ? 'One or more selected dataset sizes are unknown, so the browser merge cannot be safely preflighted.'
      : totalBytes > limit
        ? 'The selected datasets exceed the browser multi-dataset visualization limit.'
        : null,
  };
}
