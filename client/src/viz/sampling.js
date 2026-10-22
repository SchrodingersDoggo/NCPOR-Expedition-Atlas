function finite(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pairedFiniteCount(xValues, yValues) {
  const length = Math.min(xValues?.length || 0, yValues?.length || 0);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (finite(xValues[i]) != null && finite(yValues[i]) != null) count += 1;
  }
  return { count, length };
}

// Deterministic two-pass selection. The first pass counts valid observations;
// the second pass selects evenly distributed valid ordinals. Memory remains
// O(maxPoints) rather than allocating one point object per source row.
export function boundedScatterSample(xValues, yValues, maxPoints = 5000) {
  const limit = Math.max(0, Math.floor(Number(maxPoints) || 0));
  if (!limit) return [];
  const { count: validCount, length } = pairedFiniteCount(xValues, yValues);
  if (!validCount) return [];

  const target = Math.min(validCount, limit);
  const out = [];
  let validOrdinal = 0;
  let targetIndex = 0;
  let targetOrdinal = target === 1 ? 0 : Math.round((targetIndex * (validCount - 1)) / (target - 1));

  for (let i = 0; i < length && targetIndex < target; i += 1) {
    const x = finite(xValues[i]);
    const y = finite(yValues[i]);
    if (x == null || y == null) continue;

    if (validOrdinal === targetOrdinal) {
      out.push({ x, y, index: i });
      targetIndex += 1;
      if (targetIndex < target) {
        targetOrdinal = target === 1 ? 0 : Math.round((targetIndex * (validCount - 1)) / (target - 1));
      }
    }
    validOrdinal += 1;
  }

  return out;
}

function xRangeAndCount(xValues, yValues) {
  const length = Math.min(xValues?.length || 0, yValues?.length || 0);
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < length; i += 1) {
    const x = finite(xValues[i]);
    const y = finite(yValues[i]);
    if (x == null || y == null) continue;
    count += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return { count, length, minX: count ? minX : null, maxX: count ? maxX : null };
}

function orderedBoundedPoints(xValues, yValues, length, maxPoints) {
  const points = [];
  for (let i = 0; i < length && points.length < maxPoints; i += 1) {
    const x = finite(xValues[i]);
    const y = finite(yValues[i]);
    if (x != null && y != null) points.push({ x, y, index: i });
  }
  points.sort((a, b) => a.x - b.x || a.index - b.index);
  return points;
}

// Fixed X-domain binning keeps memory O(maxPoints). Each bin retains only its
// local min/max Y points. Bins are emitted in increasing X order, so an
// unsorted source file cannot make a time-series/profile line run backward.
export function minMaxDownsample(xValues, yValues, maxPoints = 4000) {
  const limit = Math.max(0, Math.floor(Number(maxPoints) || 0));
  if (!limit) return [];
  const scan = xRangeAndCount(xValues, yValues);
  if (!scan.count) return [];
  if (scan.count <= limit) return orderedBoundedPoints(xValues, yValues, scan.length, limit);

  const targetBins = Math.max(1, Math.floor(limit / 2));
  const bins = Array.from({ length: targetBins }, () => null);
  const span = scan.maxX - scan.minX;

  for (let i = 0; i < scan.length; i += 1) {
    const x = finite(xValues[i]);
    const y = finite(yValues[i]);
    if (x == null || y == null) continue;

    const binIndex = span > 0
      ? Math.min(targetBins - 1, Math.max(0, Math.floor(((x - scan.minX) / span) * targetBins)))
      : 0;
    const point = { x, y, index: i };
    const bin = bins[binIndex];
    if (!bin) {
      bins[binIndex] = { min: point, max: point };
      continue;
    }
    if (y < bin.min.y || (y === bin.min.y && x < bin.min.x)) bin.min = point;
    if (y > bin.max.y || (y === bin.max.y && x > bin.max.x)) bin.max = point;
  }

  const sampled = [];
  for (const bin of bins) {
    if (!bin) continue;
    if (bin.min.index === bin.max.index) {
      sampled.push(bin.min);
    } else if (bin.min.x < bin.max.x || (bin.min.x === bin.max.x && bin.min.index <= bin.max.index)) {
      sampled.push(bin.min, bin.max);
    } else {
      sampled.push(bin.max, bin.min);
    }
  }
  return sampled.slice(0, limit);
}

export function spatialAggregate(latValues, lonValues, valueValues = null, { maxCells = 2500 } = {}) {
  const length = Math.min(latValues?.length || 0, lonValues?.length || 0, valueValues ? valueValues.length : Infinity);
  if (!Number.isFinite(length) || length <= 0) return [];
  const gridWidth = Math.max(1, Math.floor(Math.sqrt(maxCells * 2)));
  const gridHeight = Math.max(1, Math.floor(maxCells / gridWidth));
  const cells = new Map();

  for (let i = 0; i < length; i += 1) {
    const lat = finite(latValues[i]);
    const lon = finite(lonValues[i]);
    if (lat == null || lon == null) continue;
    const value = valueValues ? finite(valueValues[i]) : null;
    const x = Math.min(gridWidth - 1, Math.max(0, Math.floor(((lon + 180) / 360) * gridWidth)));
    const y = Math.min(gridHeight - 1, Math.max(0, Math.floor(((lat + 90) / 180) * gridHeight)));
    const key = `${x}:${y}`;
    const current = cells.get(key) || { lat: 0, lon: 0, value: 0, valueCount: 0, count: 0 };
    current.lat += lat;
    current.lon += lon;
    current.count += 1;
    if (value != null) { current.value += value; current.valueCount += 1; }
    cells.set(key, current);
  }

  return Array.from(cells.values(), (cell) => ({
    lat: cell.lat / cell.count,
    lon: cell.lon / cell.count,
    value: cell.valueCount ? cell.value / cell.valueCount : null,
    count: cell.count,
  })).slice(0, maxCells);
}

export function tablePage(dataset, page = 0, pageSize = 100) {
  const fields = dataset?.fields || [];
  const totalRows = Number(dataset?.rowCount || 0);
  const safePageSize = Math.max(10, Math.min(250, Number(pageSize) || 100));
  const pageCount = Math.max(1, Math.ceil(totalRows / safePageSize));
  const safePage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const start = safePage * safePageSize;
  const end = Math.min(totalRows, start + safePageSize);
  const rows = [];
  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    rows.push(fields.map((field) => {
      const value = field.values?.[rowIndex];
      return field.type === 'number' && Number.isNaN(value) ? null : value ?? null;
    }));
  }
  return { rows, page: safePage, pageSize: safePageSize, pageCount, totalRows, start, end };
}
