import { finiteSpatialValue, validCastPositions } from './spatialEvidence.js';
import { orderedCasts, wrapLongitude } from './v4Spatial.js';
import { castLabel } from './profileSeries.js';
import { niceTicks } from './colorScale.js';

// Map view model. Positions are projected into a local kilometre frame fitted
// to the data extent (dateline-safe), instead of a fixed global grid in which
// a whole cruise collapses into one or two ~5° cells.

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEG_LAT = EARTH_RADIUS_KM * Math.PI / 180;

function numeric(value) {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

export function createLocalProjection(positions) {
  let sinSum = 0; let cosSum = 0; let latSum = 0; let count = 0;
  for (const { lat, lon } of positions) {
    const w = wrapLongitude(lon);
    if (w == null || lat == null) continue;
    const r = w * Math.PI / 180;
    sinSum += Math.sin(r); cosSum += Math.cos(r); latSum += lat; count += 1;
  }
  if (!count) return null;
  const centerLongitude = Math.hypot(sinSum, cosSum) < 1e-12
    ? wrapLongitude(positions[0].lon)
    : wrapLongitude(Math.atan2(sinSum, cosSum) * 180 / Math.PI);
  const meanLatitude = latSum / count;
  const kmPerDegreeLon = KM_PER_DEG_LAT * Math.max(1e-4, Math.abs(Math.cos(meanLatitude * Math.PI / 180)));
  const deltaLon = (lon) => ((wrapLongitude(lon) - centerLongitude + 540) % 360) - 180;
  return {
    centerLongitude,
    meanLatitude,
    kmPerDegreeLon,
    kmPerDegreeLat: KM_PER_DEG_LAT,
    project: (lat, lon) => ({ x: deltaLon(lon) * kmPerDegreeLon, y: (lat - meanLatitude) * KM_PER_DEG_LAT }),
    // Unwrapped longitude relative to the centre (continuous across the dateline).
    unwrapLongitude: (lon) => centerLongitude + deltaLon(lon),
  };
}

function verticalValues(dataset) {
  const coords = dataset?.normalizedCoords || {};
  if (dataset?.vertical?.kind === 'depth' && coords.depth) return coords.depth;
  if (dataset?.vertical?.kind === 'pressure' && coords.pressure) return coords.pressure;
  return coords.depth || coords.pressure || null;
}

function forEachCastRow(cast, rowCount, callback) {
  const segments = Array.isArray(cast?.segments) && cast.segments.length
    ? cast.segments
    : [{ rowStart: cast?.rowStart ?? 0, rowEnd: cast?.rowEnd ?? cast?.rowStart ?? 0 }];
  for (const segment of segments) {
    const start = Math.max(0, Number(segment.rowStart) || 0);
    const end = Math.min(rowCount - 1, Number(segment.rowEnd ?? segment.rowStart) || 0);
    for (let row = start; row <= end; row += 1) callback(row);
  }
}

function castPoints(dataset, values, vertical) {
  const rowCount = Number(dataset?.rowCount || 0);
  const ordered = orderedCasts(dataset).casts;
  const entries = ordered.length ? ordered : validCastPositions(dataset?.casts || []).map((position, index) => ({
    cast: (dataset?.casts || []).find((cast) => cast.id === position.castId) || { id: position.castId },
    lat: position.latitude,
    lon: position.longitude,
    index,
  }));
  return entries.map((entry, index) => {
    let best = null;
    let sum = 0;
    let n = 0;
    if (values) {
      forEachCastRow(entry.cast, rowCount, (row) => {
        const value = numeric(values[row]);
        if (value == null) return;
        sum += value; n += 1;
        if (vertical) {
          const z = numeric(vertical[row]);
          if (z != null && (!best || z < best.z)) best = { z, value };
        }
      });
    }
    const value = vertical ? (best ? best.value : null) : (n ? sum / n : null);
    return {
      kind: 'cast',
      lat: entry.lat,
      lon: entry.lon,
      value,
      vertical: best?.z ?? null,
      count: Number(entry.cast?.rowCount || 0) || n || 1,
      label: castLabel(entry.cast, entry.index ?? index),
    };
  });
}

function observationPoints(dataset, values, vertical, maxPoints, maxCells) {
  const coords = dataset?.normalizedCoords || {};
  const lat = coords.lat;
  const lon = coords.lon;
  if (!lat || !lon) return { points: [], aggregated: false, surfaceOnly: false };
  const length = Math.min(lat.length, lon.length, values ? values.length : Infinity);

  // With a vertical coordinate, map only near-surface rows so a colour never
  // mixes surface and deep water.
  let surfaceLimit = Infinity;
  if (vertical) {
    let min = Infinity;
    for (let i = 0; i < length; i += 1) {
      const z = numeric(vertical[i]);
      if (z != null && z < min) min = z;
    }
    if (Number.isFinite(min)) surfaceLimit = min + Math.max(2, Math.abs(min) * 0.05);
  }

  const keep = (i) => {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    if (a == null || b == null || a < -90 || a > 90) return null;
    if (vertical) {
      const z = numeric(vertical[i]);
      if (z == null || z > surfaceLimit) return null;
    }
    return { lat: a, lon: b, value: values ? numeric(values[i]) : null };
  };

  let valid = 0;
  for (let i = 0; i < length; i += 1) if (keep(i)) valid += 1;
  if (!valid) return { points: [], aggregated: false, surfaceOnly: Boolean(vertical) };

  if (valid <= maxPoints) {
    const points = [];
    for (let i = 0; i < length; i += 1) {
      const point = keep(i);
      if (point) points.push({ kind: 'observation', ...point, count: 1, row: i });
    }
    return { points, aggregated: false, surfaceOnly: Boolean(vertical) };
  }

  // Too many to draw individually: aggregate on a grid sized to the data
  // extent (not the globe), keeping cells roughly square in kilometres.
  const sample = [];
  const step = Math.max(1, Math.floor(valid / 4000));
  let seen = 0;
  for (let i = 0; i < length; i += 1) {
    const point = keep(i);
    if (!point) continue;
    if (seen % step === 0) sample.push(point);
    seen += 1;
  }
  const projection = createLocalProjection(sample);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const point of sample) {
    const { x, y } = projection.project(point.lat, point.lon);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const width = Math.max(1e-6, maxX - minX);
  const height = Math.max(1e-6, maxY - minY);
  const aspect = width / height;
  const nx = Math.max(1, Math.min(200, Math.round(Math.sqrt(maxCells * aspect))));
  const ny = Math.max(1, Math.min(200, Math.floor(maxCells / nx)));
  const cells = new Map();
  for (let i = 0; i < length; i += 1) {
    const point = keep(i);
    if (!point) continue;
    const { x, y } = projection.project(point.lat, point.lon);
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(((x - minX) / width) * nx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(((y - minY) / height) * ny)));
    const key = iy * nx + ix;
    const cell = cells.get(key) || { lat: 0, lon: 0, x: 0, y: 0, value: 0, valueCount: 0, count: 0 };
    cell.lat += point.lat; cell.x += x; cell.y += y; cell.count += 1;
    cell.lon += projection.unwrapLongitude(point.lon);
    if (point.value != null) { cell.value += point.value; cell.valueCount += 1; }
    cells.set(key, cell);
  }
  const points = [...cells.values()].map((cell) => ({
    kind: 'cell',
    lat: cell.lat / cell.count,
    lon: wrapLongitude(cell.lon / cell.count),
    value: cell.valueCount ? cell.value / cell.valueCount : null,
    count: cell.count,
  }));
  return { points, aggregated: true, surfaceOnly: Boolean(vertical), grid: { nx, ny } };
}

function degreeLabel(value, axis) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (axis === 'lon' && Math.abs(abs - 180) < 1e-9) return '180°';
  const hemisphere = axis === 'lat' ? (n > 0 ? 'N' : n < 0 ? 'S' : '') : (n > 0 ? 'E' : n < 0 ? 'W' : '');
  const digits = abs >= 10 ? (Number.isInteger(abs) ? 0 : 2) : 3;
  return `${Number(abs.toFixed(digits))}°${hemisphere}`;
}

export function buildMapModel(dataset, variableKey, { maxPoints = 2500, maxCells = 2500 } = {}) {
  const variable = fieldByKey(dataset, variableKey);
  const values = variable?.values || null;
  const vertical = verticalValues(dataset);
  const positionSource = dataset?.capabilities?.map?.positionSource;

  const hasObservationPositions = Boolean(dataset?.normalizedCoords?.lat && dataset?.normalizedCoords?.lon);
  const casts = dataset?.casts || [];
  const useCasts = positionSource === 'cast-coordinates'
    || (!hasObservationPositions && casts.length > 0)
    || (vertical && validCastPositions(casts).length >= 1);

  let points = [];
  let mode = 'observations';
  let aggregated = false;
  let surfaceOnly = false;
  if (useCasts) {
    points = castPoints(dataset, values, vertical).filter((point) => point.lat != null && point.lon != null);
    mode = 'casts';
    surfaceOnly = Boolean(vertical);
  }
  if (!points.length && hasObservationPositions) {
    const result = observationPoints(dataset, values, vertical, maxPoints, maxCells);
    points = result.points;
    aggregated = result.aggregated;
    surfaceOnly = result.surfaceOnly;
    mode = aggregated ? 'aggregated' : 'observations';
  }
  if (!points.length) return { points: [], mode, aggregated, surfaceOnly, projection: null, bounds: null, latTicks: [], lonTicks: [] };

  const projection = createLocalProjection(points);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  const projected = points.map((point) => {
    const { x, y } = projection.project(point.lat, point.lon);
    const unwrapped = projection.unwrapLongitude(point.lon);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minLat = Math.min(minLat, point.lat); maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, unwrapped); maxLon = Math.max(maxLon, unwrapped);
    return { ...point, x, y };
  });

  // Pad the extent (at least ~2 km, so a single station still gets a frame).
  const padX = Math.max(2, (maxX - minX) * 0.08);
  const padY = Math.max(2, (maxY - minY) * 0.08);
  const bounds = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  const latFrom = projection.meanLatitude + bounds.minY / projection.kmPerDegreeLat;
  const latTo = projection.meanLatitude + bounds.maxY / projection.kmPerDegreeLat;
  const lonFrom = projection.centerLongitude + bounds.minX / projection.kmPerDegreeLon;
  const lonTo = projection.centerLongitude + bounds.maxX / projection.kmPerDegreeLon;

  const latTicks = niceTicks(latFrom, latTo, 5)
    .filter((lat) => lat >= latFrom && lat <= latTo && lat >= -90 && lat <= 90)
    .map((lat) => ({ value: lat, y: (lat - projection.meanLatitude) * projection.kmPerDegreeLat, label: degreeLabel(lat, 'lat') }));
  const lonTicks = niceTicks(lonFrom, lonTo, 5)
    .filter((lon) => lon >= lonFrom && lon <= lonTo)
    .map((lon) => ({ value: lon, x: (lon - projection.centerLongitude) * projection.kmPerDegreeLon, label: degreeLabel(wrapLongitude(lon), 'lon') }));

  return {
    points: projected,
    mode,
    aggregated,
    surfaceOnly,
    projection,
    bounds,
    extent: { minLat, maxLat, minLon: wrapLongitude(minLon), maxLon: wrapLongitude(maxLon) },
    latTicks,
    lonTicks,
    variable,
  };
}
