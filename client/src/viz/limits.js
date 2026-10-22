const MIB = 1024 * 1024;

export const VIZ_LIMITS = Object.freeze({
  '.csv': 100 * MIB,
  '.tsv': 100 * MIB,
  '.cnv': 100 * MIB,
  '.json': 25 * MIB,
  '.xls': 25 * MIB,
  '.xlsx': 25 * MIB,
  '.nc': 25 * MIB,
  '.nc4': 25 * MIB,
  '.h5': 25 * MIB,
  '.hdf5': 25 * MIB,
});

export function vizExtension(fileName = '') {
  const clean = String(fileName).toLowerCase().split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot) : '';
}

export function fullVisualizationLimit(fileName = '') {
  return VIZ_LIMITS[vizExtension(fileName)] ?? 0;
}

export function canFullyVisualizeInBrowser(fileName, fileSize) {
  const limit = fullVisualizationLimit(fileName);
  const size = Number(fileSize || 0);
  return Boolean(limit && Number.isFinite(size) && size > 0 && size <= limit);
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  if (value < MIB) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / MIB).toFixed(value >= 10 * MIB ? 1 : 2)} MiB`;
}
