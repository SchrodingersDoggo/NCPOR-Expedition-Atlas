// Detects an oceanographic depth profile (or multi-station transect) inside
// an already-parsed table (headers + rows, as returned by
// parseDataset.js's parseDatasetFull) and reshapes it into the flat point
// cloud that OceanSection3D triangulates.
//
// Deliberately dependency-free (no three.js, no d3-delaunay) so the column
// detection / geometry-agnostic parts of this can be reasoned about and
// changed without touching the renderer.

const DEPTH_ALIASES = ['depth', 'depthm', 'pressure', 'pressuredb', 'depthmeters', 'depthmeter'];
const TEMP_ALIASES = ['temperature', 'temp', 'tempc', 'watertemp', 'sst', 'ctdtemp', 'seatemp', 'tempdegc'];
const SAL_ALIASES = ['salinity', 'sal', 'psu', 'salinitypsu', 'salinityppt'];
const LAT_ALIASES = ['lat', 'latitude'];
const LON_ALIASES = ['lon', 'lng', 'long', 'longitude'];
const STATION_ALIASES = ['station', 'stationid', 'stationno', 'stationnumber', 'cast', 'castid', 'site', 'profile', 'profileid'];
const DISTANCE_ALIASES = ['distance', 'distancekm', 'distkm', 'transectdistance', 'distancem'];

function normalize(header) {
  return String(header ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Exact match first, substring fallback (so "Depth (m)" still matches
// "depth", "Water Temp (deg C)" still matches "watertemp"/"temp", etc.)
function findColumn(headers, aliases) {
  const normed = headers.map(normalize);
  for (const alias of aliases) {
    const idx = normed.indexOf(alias);
    if (idx !== -1) return idx;
  }
  for (let i = 0; i < normed.length; i++) {
    if (normed[i] && aliases.some((a) => normed[i].includes(a))) return i;
  }
  return -1;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * headers: string[]
 * rows: any[][]  (raw table, same column order as headers)
 *
 * Returns null when this doesn't look like a depth profile (no depth column,
 * or neither temperature nor salinity present, or too little usable data) —
 * callers should just fall back to the plain table preview in that case.
 *
 * Otherwise returns:
 *   {
 *     points: [{ x, depth, temperature: number|null, salinity: number|null }],
 *     availableProperties: ['temperature'?, 'salinity'?],
 *     hasPosition: boolean,   // false when x was synthesized (single profile)
 *     xLabel: string,
 *     depthLabel: string,
 *   }
 */
export function buildOceanSection(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows) || !rows.length) return null;

  const depthIdx = findColumn(headers, DEPTH_ALIASES);
  if (depthIdx === -1) return null;

  const tempIdx = findColumn(headers, TEMP_ALIASES);
  const salIdx = findColumn(headers, SAL_ALIASES);
  if (tempIdx === -1 && salIdx === -1) return null;

  const latIdx = findColumn(headers, LAT_ALIASES);
  const lonIdx = findColumn(headers, LON_ALIASES);
  const stationIdx = findColumn(headers, STATION_ALIASES);
  const distIdx = findColumn(headers, DISTANCE_ALIASES);

  const availableProperties = [];
  if (tempIdx !== -1) availableProperties.push('temperature');
  if (salIdx !== -1) availableProperties.push('salinity');

  const raw = rows
    .map((r) => ({
      depth: toNumber(r[depthIdx]),
      temperature: tempIdx !== -1 ? toNumber(r[tempIdx]) : null,
      salinity: salIdx !== -1 ? toNumber(r[salIdx]) : null,
      lat: latIdx !== -1 ? toNumber(r[latIdx]) : null,
      lon: lonIdx !== -1 ? toNumber(r[lonIdx]) : null,
      station: stationIdx !== -1 ? r[stationIdx] : null,
      distance: distIdx !== -1 ? toNumber(r[distIdx]) : null,
    }))
    .filter((p) => p.depth !== null && (p.temperature !== null || p.salinity !== null));

  if (raw.length < 2) return null;

  let hasPosition = false;
  let xLabel = '';
  let points = [];

  const geoUsable = latIdx !== -1 && lonIdx !== -1 && raw.filter((p) => p.lat !== null && p.lon !== null).length >= 2;
  const distUsable = distIdx !== -1 && new Set(raw.filter((p) => p.distance !== null).map((p) => p.distance)).size >= 2;
  const stationUsable = stationIdx !== -1 && new Set(raw.map((p) => p.station)).size >= 2;

  if (geoUsable) {
    hasPosition = true;
    xLabel = 'Distance along transect (km)';
    // Group by rounded lat/lon (~11m precision) into stations, preserving
    // first-seen order, then walk cumulative great-circle distance between
    // consecutive station centroids.
    const groups = new Map();
    for (const p of raw) {
      if (p.lat === null || p.lon === null) continue;
      const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, { lat: p.lat, lon: p.lon, items: [] });
      groups.get(key).items.push(p);
    }
    let cumulative = 0;
    let prev = null;
    const xByKey = new Map();
    for (const [key, g] of groups) {
      if (prev) cumulative += haversineKm(prev.lat, prev.lon, g.lat, g.lon);
      xByKey.set(key, cumulative);
      prev = g;
    }
    points = raw
      .filter((p) => p.lat !== null && p.lon !== null)
      .map((p) => ({
        x: xByKey.get(`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`),
        depth: p.depth,
        temperature: p.temperature,
        salinity: p.salinity,
      }));
  } else if (distUsable) {
    hasPosition = true;
    xLabel = headers[distIdx] ? String(headers[distIdx]).trim() : 'Distance';
    points = raw
      .filter((p) => p.distance !== null)
      .map((p) => ({ x: p.distance, depth: p.depth, temperature: p.temperature, salinity: p.salinity }));
  } else if (stationUsable) {
    hasPosition = true;
    xLabel = headers[stationIdx] ? String(headers[stationIdx]).trim() : 'Station';
    const order = [];
    for (const p of raw) {
      const key = String(p.station);
      if (!order.includes(key)) order.push(key);
    }
    points = raw.map((p) => ({
      x: order.indexOf(String(p.station)),
      depth: p.depth,
      temperature: p.temperature,
      salinity: p.salinity,
    }));
  } else {
    // No usable position column — this is a single vertical profile.
    // Synthesize a left/right pair per sample so the same triangulated-slab
    // renderer still applies (a Delaunay triangulation of two parallel
    // columns naturally produces a clean zig-zag strip).
    hasPosition = false;
    xLabel = '';
    const uniqueDepths = new Set(raw.map((p) => p.depth)).size;
    if (uniqueDepths < 2) return null;
    for (const p of raw) {
      points.push({ x: -0.5, depth: p.depth, temperature: p.temperature, salinity: p.salinity });
      points.push({ x: 0.5, depth: p.depth, temperature: p.temperature, salinity: p.salinity });
    }
  }

  if (points.length < 3) return null;
  // Need at least two distinct x values for a non-degenerate triangulation.
  if (new Set(points.map((p) => p.x)).size < 2) return null;

  return {
    points,
    availableProperties,
    hasPosition,
    xLabel,
    depthLabel: headers[depthIdx] ? String(headers[depthIdx]).trim() : 'Depth',
  };
}

// Convenience wrapper for already-submitted datasets: takes a
// ContentItem.datasetMeta shape ({ columns: [{name,type}], preview_rows })
// — the small, server-stored subset of the table — and runs it through
// buildOceanSection(). Since only the first PREVIEW_ROWS rows ever reach
// the server (see parseDataset.js), the resulting section is necessarily
// sparse compared to the full-table version built live during upload; it
// still renders, just from fewer points.
export function buildOceanSectionFromMeta(meta) {
  if (!meta || !Array.isArray(meta.columns) || !Array.isArray(meta.preview_rows)) return null;
  const headers = meta.columns.map((c) => c?.name);
  return buildOceanSection(headers, meta.preview_rows);
}
