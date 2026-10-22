export function finiteSpatialValue(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function pairedLatLonCount(latitudes, longitudes) {
  if (!latitudes || !longitudes) return 0;
  const length = Math.min(latitudes.length, longitudes.length);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (finiteSpatialValue(latitudes[i]) != null && finiteSpatialValue(longitudes[i]) != null) count += 1;
  }
  return count;
}

export function pairedXYZCount(latitudes, longitudes, depths) {
  if (!latitudes || !longitudes || !depths) return 0;
  const length = Math.min(latitudes.length, longitudes.length, depths.length);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (finiteSpatialValue(latitudes[i]) != null && finiteSpatialValue(longitudes[i]) != null && finiteSpatialValue(depths[i]) != null) count += 1;
  }
  return count;
}

export function collectPairedXY(latitudes, longitudes, third = null, { precision = 7, cap = 20000 } = {}) {
  if (!latitudes || !longitudes) return [];
  const length = Math.min(latitudes.length, longitudes.length, third?.length ?? Infinity);
  const byKey = new Map();
  for (let i = 0; i < length && byKey.size < cap; i += 1) {
    const lat = finiteSpatialValue(latitudes[i]);
    const lon = finiteSpatialValue(longitudes[i]);
    const z = third ? finiteSpatialValue(third[i]) : 0;
    if (lat == null || lon == null || (third && z == null)) continue;
    const key = `${lat.toFixed(precision)}:${lon.toFixed(precision)}`;
    if (!byKey.has(key)) byKey.set(key, { lat, lon });
  }
  return [...byKey.values()];
}

function cross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points) {
  if (points.length <= 2) return points.slice();
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function pairedXYCoverage(latitudes, longitudes, third = null) {
  const positions = collectPairedXY(latitudes, longitudes, third);
  if (!positions.length) {
    return {
      uniqueXY: 0,
      latSpread: 0,
      lonSpread: 0,
      normalizedArea: 0,
      positions,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const point of positions) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  const latSpread = maxLat - minLat;
  const lonSpread = maxLon - minLon;
  if (!(latSpread > 0) || !(lonSpread > 0)) {
    return { uniqueXY: positions.length, latSpread, lonSpread, normalizedArea: 0, positions };
  }

  const normalized = positions.map(({ lat, lon }) => ({
    x: (lon - minLon) / lonSpread,
    y: (lat - minLat) / latSpread,
  }));
  const rawArea = polygonArea(convexHull(normalized));
  const normalizedArea = rawArea < 1e-12 ? 0 : rawArea;
  return { uniqueXY: positions.length, latSpread, lonSpread, normalizedArea, positions };
}

export function validCastPositions(casts = []) {
  const byKey = new Map();
  for (const cast of casts) {
    const lat = finiteSpatialValue(cast?.latitude);
    const lon = finiteSpatialValue(cast?.longitude);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const key = `${lat.toFixed(7)}:${lon.toFixed(7)}`;
    if (!byKey.has(key)) byKey.set(key, { latitude: lat, longitude: lon, castId: cast?.id || null });
  }
  return [...byKey.values()];
}
