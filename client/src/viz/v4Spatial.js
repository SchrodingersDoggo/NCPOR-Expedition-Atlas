import { finiteSpatialValue } from './spatialEvidence.js';
import { parseTimestamp } from './timeParse.js';

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const EARTH_RADIUS_KM = 6371.0088;

export function wrapLongitude(longitude) {
  const value = numeric(longitude);
  if (value == null) return null;
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function wrappedLongitudeDelta(longitude, centerLongitude) {
  const lon = wrapLongitude(longitude);
  const center = wrapLongitude(centerLongitude);
  if (lon == null || center == null) return null;
  return ((lon - center + 180) % 360 + 360) % 360 - 180;
}

function circularLongitudeCenter(longitudes) {
  let sinSum = 0;
  let cosSum = 0;
  let count = 0;
  for (const raw of longitudes) {
    const lon = wrapLongitude(raw);
    if (lon == null) continue;
    const radians = lon * Math.PI / 180;
    sinSum += Math.sin(radians);
    cosSum += Math.cos(radians);
    count += 1;
  }
  if (!count) return null;
  // Degenerate circular means are rare for a local oceanographic view. Fall
  // back to the first valid longitude rather than inventing a global span.
  if (Math.hypot(sinSum, cosSum) < 1e-12) {
    return wrapLongitude(longitudes.find((value) => wrapLongitude(value) != null));
  }
  return wrapLongitude(Math.atan2(sinSum, cosSum) * 180 / Math.PI);
}

export function projectGeographicPoints(rawPoints = []) {
  const valid = rawPoints
    .map((point) => ({
      ...point,
      lon: finiteSpatialValue(point.lon ?? point.x),
      lat: finiteSpatialValue(point.lat ?? point.y),
      value: numeric(point.value),
    }))
    .filter((point) => point.lon != null && point.lat != null && point.lat >= -90 && point.lat <= 90 && point.value != null);
  if (!valid.length) return { points: [], projection: null };

  const centerLongitude = circularLongitudeCenter(valid.map((point) => point.lon));
  const meanLatitude = valid.reduce((sum, point) => sum + point.lat, 0) / valid.length;
  const latitudeRadians = meanLatitude * Math.PI / 180;
  // Keep the transform numerically stable extremely close to a pole. V4 does
  // not claim a global projection; this is only a local interpolation frame.
  const cosLatitude = Math.max(1e-4, Math.abs(Math.cos(latitudeRadians)));
  const kmPerDegreeLat = EARTH_RADIUS_KM * Math.PI / 180;
  const kmPerDegreeLon = kmPerDegreeLat * cosLatitude;

  const points = valid.map((point) => {
    const deltaLon = wrappedLongitudeDelta(point.lon, centerLongitude);
    const unwrappedLon = centerLongitude + deltaLon;
    return {
      ...point,
      lon: wrapLongitude(point.lon),
      lat: point.lat,
      unwrappedLon,
      x: deltaLon * kmPerDegreeLon,
      y: (point.lat - meanLatitude) * kmPerDegreeLat,
    };
  });

  return {
    points,
    projection: {
      centerLongitude,
      meanLatitude,
      kmPerDegreeLon,
      kmPerDegreeLat,
    },
  };
}

function inverseLocalProjection(x, y, projection) {
  if (!projection) return { lon: null, lat: null };
  const lon = wrapLongitude(projection.centerLongitude + x / projection.kmPerDegreeLon);
  const lat = projection.meanLatitude + y / projection.kmPerDegreeLat;
  return { lon, lat };
}

function castSegments(cast) {
  return Array.isArray(cast?.segments) && cast.segments.length
    ? cast.segments
    : [{ rowStart: cast?.rowStart ?? 0, rowEnd: cast?.rowEnd ?? cast?.rowStart ?? 0 }];
}

function forEachCastRow(cast, rowCount, callback) {
  for (const segment of castSegments(cast)) {
    const start = Math.max(0, Number(segment.rowStart) || 0);
    const end = Math.min(rowCount - 1, Number(segment.rowEnd ?? segment.rowStart) || 0);
    for (let row = start; row <= end; row += 1) callback(row);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const r = EARTH_RADIUS_KM;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function castTime(cast) {
  const raw = cast?.startTime ?? cast?.time ?? cast?.timestamp ?? null;
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return null;

  const number = Number(raw);
  if (Number.isFinite(number)) {
    const absolute = Math.abs(number);
    // Plausible Unix seconds or milliseconds (roughly 1900-2100). Small
    // sequence/index values are deliberately not treated as chronology.
    if (absolute >= 1e8 && absolute <= 4.2e9) return number * 1000;
    if (absolute >= 1e11 && absolute <= 4.2e12) return number;
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    const cnvMatch = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/i);
    if (cnvMatch) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const milliseconds = cnvMatch[7] ? Number(`0.${cnvMatch[7]}`) * 1000 : 0;
      return Date.UTC(
        Number(cnvMatch[3]),
        months[cnvMatch[1].toLowerCase()],
        Number(cnvMatch[2]),
        Number(cnvMatch[4]),
        Number(cnvMatch[5]),
        Number(cnvMatch[6]),
        Math.round(milliseconds),
      );
    }
    // Timezone-safe: offset-less CNV/ISO times are UTC, never viewer-local,
    // and trailing Sea-Bird annotations such as
    // "[Instrument's time stamp, header]" are ignored.
    const parsed = parseTimestamp(text);
    if (parsed && Number.isFinite(parsed.ms)) return parsed.ms;
  }
  return null;
}

export function orderedCasts(dataset) {
  const entries = (dataset?.casts || [])
    .map((cast, index) => ({
      cast,
      index,
      lat: finiteSpatialValue(cast.latitude),
      lon: finiteSpatialValue(cast.longitude),
      time: castTime(cast),
      sourceIndex: Number.isInteger(cast.sourceDatasetIndex) ? cast.sourceDatasetIndex : 0,
      sourceCastIndex: Number.isInteger(cast.sourceCastIndex) ? cast.sourceCastIndex : index,
    }))
    .filter((entry) => entry.lat != null && entry.lon != null);

  const chronological = entries.length > 1 && entries.every((entry) => entry.time != null);
  entries.sort((a, b) => {
    if (chronological && a.time !== b.time) return a.time - b.time;
    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
    if (a.sourceCastIndex !== b.sourceCastIndex) return a.sourceCastIndex - b.sourceCastIndex;
    return a.index - b.index;
  });

  return {
    casts: entries,
    orderMode: chronological ? 'chronological' : 'source-order',
    warning: chronological || entries.length < 2
      ? null
      : 'Curtain cast order uses source order because reliable station times were unavailable.',
  };
}

function boundedIndicesForCast(cast, dataset, verticalValues, variableValues, maxPoints) {
  let validCount = 0;
  forEachCastRow(cast, dataset.rowCount, (row) => {
    if (numeric(verticalValues?.[row]) != null && numeric(variableValues?.[row]) != null) validCount += 1;
  });
  if (!validCount) return [];
  const step = Math.max(1, Math.ceil(validCount / maxPoints));
  const selected = [];
  let seen = 0;
  let minValue = null;
  let maxValue = null;
  forEachCastRow(cast, dataset.rowCount, (row) => {
    const vertical = numeric(verticalValues?.[row]);
    const value = numeric(variableValues?.[row]);
    if (vertical == null || value == null) return;
    if (seen % step === 0) selected.push(row);
    if (!minValue || value < minValue.value) minValue = { row, value };
    if (!maxValue || value > maxValue.value) maxValue = { row, value };
    seen += 1;
  });
  if (minValue && !selected.includes(minValue.row)) selected.push(minValue.row);
  if (maxValue && !selected.includes(maxValue.row)) selected.push(maxValue.row);
  selected.sort((a, b) => a - b);
  return selected.slice(0, maxPoints + 2);
}

export function curtainMeasurements(dataset, variableKey, { maxPerCast = 350 } = {}) {
  const variable = fieldByKey(dataset, variableKey);
  const vertical = dataset?.vertical?.kind === 'depth' ? dataset?.normalizedCoords?.depth : dataset?.normalizedCoords?.pressure;
  if (!variable?.values || !vertical) return { points: [], track: [], verticalKind: dataset?.vertical?.kind || null };
  const ordering = orderedCasts(dataset);
  const casts = ordering.casts;
  const track = [];
  let distance = 0;
  let previous = null;
  for (const entry of casts) {
    if (previous) distance += haversineKm(previous.lat, previous.lon, entry.lat, entry.lon);
    track.push({ cast: entry.cast, lat: entry.lat, lon: entry.lon, distanceKm: distance });
    previous = entry;
  }
  const points = [];
  for (const entry of track) {
    const rows = boundedIndicesForCast(entry.cast, dataset, vertical, variable.values, maxPerCast);
    for (const row of rows) {
      const depth = numeric(vertical[row]);
      const value = numeric(variable.values[row]);
      if (depth == null || value == null) continue;
      points.push({ x: entry.distanceKm, y: depth, value, row, castId: entry.cast.id, measured: true });
    }
  }
  return { points, track, verticalKind: dataset?.vertical?.kind || null, orderMode: ordering.orderMode, warning: ordering.warning };
}

export function depthRange(dataset) {
  const values = dataset?.normalizedCoords?.depth;
  if (!values) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const raw of values) {
    const value = numeric(raw);
    if (value == null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

export function depthSliceMeasurements(dataset, variableKey, targetDepth, { tolerance = null } = {}) {
  const variable = fieldByKey(dataset, variableKey);
  const depth = dataset?.normalizedCoords?.depth;
  if (!variable?.values || !depth) return [];
  const range = depthRange(dataset);
  const allowed = tolerance ?? Math.max(2, ((range?.max || 0) - (range?.min || 0)) * 0.03);
  const points = [];
  for (const entry of orderedCasts(dataset).casts) {
    let best = null;
    forEachCastRow(entry.cast, dataset.rowCount, (row) => {
      const z = numeric(depth[row]);
      const value = numeric(variable.values[row]);
      if (z == null || value == null) return;
      const difference = Math.abs(z - targetDepth);
      if (!best || difference < best.difference) best = { row, z, value, difference };
    });
    if (best && best.difference <= allowed) {
      points.push({ x: entry.lon, y: entry.lat, lon: entry.lon, lat: entry.lat, value: best.value, depth: best.z, row: best.row, castId: entry.cast.id, measured: true });
    }
  }
  return points;
}

export function surfaceMeasurements(dataset, variableKey, { maxPoints = 2500 } = {}) {
  const variable = fieldByKey(dataset, variableKey);
  if (!variable?.values) return [];
  const depth = dataset?.normalizedCoords?.depth || dataset?.normalizedCoords?.pressure;
  const casts = orderedCasts(dataset).casts;
  if (casts.length && depth) {
    const points = [];
    for (const entry of casts) {
      let best = null;
      forEachCastRow(entry.cast, dataset.rowCount, (row) => {
        const z = numeric(depth[row]);
        const value = numeric(variable.values[row]);
        if (z == null || value == null) return;
        if (!best || z < best.z) best = { row, z, value };
      });
      if (best) points.push({ x: entry.lon, y: entry.lat, lon: entry.lon, lat: entry.lat, value: best.value, vertical: best.z, row: best.row, castId: entry.cast.id, measured: true });
    }
    return points;
  }

  const lat = dataset?.normalizedCoords?.lat;
  const lon = dataset?.normalizedCoords?.lon;
  if (!lat || !lon) return [];
  let minVertical = Infinity;
  if (depth) {
    for (const raw of depth) {
      const z = numeric(raw);
      if (z != null) minVertical = Math.min(minVertical, z);
    }
  }
  const tolerance = Number.isFinite(minVertical) ? Math.max(2, Math.abs(minVertical) * 0.05) : Infinity;
  let validCount = 0;
  const length = Math.min(lat.length, lon.length, variable.values.length);
  for (let i = 0; i < length; i += 1) {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    const value = numeric(variable.values[i]);
    const z = depth ? numeric(depth[i]) : null;
    if (a == null || b == null || value == null) continue;
    if (depth && (z == null || z > minVertical + tolerance)) continue;
    validCount += 1;
  }
  const step = Math.max(1, Math.ceil(validCount / maxPoints));
  const points = [];
  let seen = 0;
  for (let i = 0; i < length; i += 1) {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    const value = numeric(variable.values[i]);
    const z = depth ? numeric(depth[i]) : null;
    if (a == null || b == null || value == null) continue;
    if (depth && (z == null || z > minVertical + tolerance)) continue;
    if (seen % step === 0) points.push({ x: b, y: a, lon: b, lat: a, value, vertical: z, row: i, measured: true });
    seen += 1;
  }
  return points.slice(0, maxPoints);
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points) {
  const unique = [...new Map(points.map((p) => [`${p.x}|${p.y}`, { x: p.x, y: p.y }])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x; const yi = polygon[i].y;
    const xj = polygon[j].x; const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function boundedSource(points, max = 1800) {
  if (points.length <= max) return points.slice();
  const step = points.length / max;
  const result = [];
  for (let i = 0; i < max; i += 1) result.push(points[Math.floor(i * step)]);
  let min = points[0]; let maxPoint = points[0];
  for (const p of points) {
    if (p.value < min.value) min = p;
    if (p.value > maxPoint.value) maxPoint = p;
  }
  if (!result.includes(min)) result[0] = min;
  if (!result.includes(maxPoint)) result[result.length - 1] = maxPoint;
  return result;
}

export function chooseGridResolution(pointCount, { maxCells = 6000, aspect = 1.6 } = {}) {
  const target = Math.min(maxCells, Math.max(300, Math.round(pointCount * 12)));
  const nx = Math.max(12, Math.floor(Math.sqrt(target * aspect)));
  const ny = Math.max(10, Math.floor(target / nx));
  return { nx, ny, cells: nx * ny };
}

export function interpolateBoundedGrid(rawPoints, { maxCells = 6000, maxSourcePoints = 1800, coordinateMode = 'cartesian' } = {}) {
  let projection = null;
  let valid;
  if (coordinateMode === 'geographic') {
    // Use the shared spatial validator before any numeric coercion so null/blank
    // coordinates can never become a real 0°,0° measurement.
    const projected = projectGeographicPoints(rawPoints);
    valid = projected.points;
    projection = projected.projection;
  } else {
    valid = rawPoints.filter((p) => numeric(p.x) != null && numeric(p.y) != null && numeric(p.value) != null)
      .map((p) => ({ ...p, x: Number(p.x), y: Number(p.y), value: Number(p.value) }));
  }

  if (valid.length < 3) return { cells: [], measured: valid, hull: [], bounds: null, resolution: { nx: 0, ny: 0, cells: 0 }, coverage: 0, geographic: coordinateMode === 'geographic', projection };
  const points = boundedSource(valid, maxSourcePoints);
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const geographicBounds = projection ? {
    centerLongitude: projection.centerLongitude,
    minUnwrappedLongitude: Math.min(...points.map((p) => p.unwrappedLon)),
    maxUnwrappedLongitude: Math.max(...points.map((p) => p.unwrappedLon)),
    longitudeSpan: Math.max(...points.map((p) => p.unwrappedLon)) - Math.min(...points.map((p) => p.unwrappedLon)),
    minLatitude: Math.min(...points.map((p) => p.lat)),
    maxLatitude: Math.max(...points.map((p) => p.lat)),
  } : null;
  if (!(width > 0) || !(height > 0)) return { cells: [], measured: points, hull: [], bounds: { minX, maxX, minY, maxY }, resolution: { nx: 0, ny: 0, cells: 0 }, coverage: 0, geographic: Boolean(projection), projection, geographicBounds };
  const aspect = Math.max(0.5, Math.min(3, width / height));
  const resolution = chooseGridResolution(points.length, { maxCells, aspect });
  const normalize = (p) => ({ ...p, nx: (p.x - minX) / width, ny: (p.y - minY) / height });
  const normalized = points.map(normalize);
  const hull = convexHull(normalized.map((p) => ({ x: p.nx, y: p.ny })));
  if (hull.length < 3) return { cells: [], measured: points, hull, bounds: { minX, maxX, minY, maxY }, resolution, coverage: 0, geographic: Boolean(projection), projection, geographicBounds };
  const threshold = Math.min(0.75, Math.max(0.08, 2.75 / Math.sqrt(normalized.length)));
  const cells = [];
  for (let iy = 0; iy < resolution.ny; iy += 1) {
    const ny = resolution.ny === 1 ? 0.5 : iy / (resolution.ny - 1);
    for (let ix = 0; ix < resolution.nx; ix += 1) {
      const nx = resolution.nx === 1 ? 0.5 : ix / (resolution.nx - 1);
      if (!pointInPolygon({ x: nx, y: ny }, hull)) continue;
      const nearest = [];
      for (const p of normalized) {
        const dx = p.nx - nx;
        const dy = p.ny - ny;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > threshold) continue;
        if (nearest.length < 4) {
          nearest.push({ p, distance });
          nearest.sort((a, b) => a.distance - b.distance);
        } else if (distance < nearest[3].distance) {
          nearest[3] = { p, distance };
          nearest.sort((a, b) => a.distance - b.distance);
        }
      }
      if (!nearest.length) continue;
      let value;
      if (nearest[0].distance < 1e-9) value = nearest[0].p.value;
      else {
        let weighted = 0;
        let totalWeight = 0;
        for (const item of nearest) {
          const weight = 1 / Math.max(1e-8, item.distance ** 2);
          weighted += item.p.value * weight;
          totalWeight += weight;
        }
        value = weighted / totalWeight;
      }
      const confidence = Math.max(0, 1 - nearest[0].distance / threshold);
      if (confidence <= 0) continue;
      const x = minX + nx * width;
      const y = minY + ny * height;
      const geographic = projection ? inverseLocalProjection(x, y, projection) : null;
      cells.push({
        x,
        y,
        ...(geographic ? { lon: geographic.lon, lat: geographic.lat } : {}),
        value,
        confidence,
        ix,
        iy,
        interpolated: nearest[0].distance >= 1e-9,
      });
    }
  }
  return {
    cells,
    measured: points,
    hull,
    bounds: { minX, maxX, minY, maxY },
    resolution,
    coverage: resolution.cells ? cells.length / resolution.cells : 0,
    threshold,
    geographic: Boolean(projection),
    projection,
    geographicBounds,
  };
}

