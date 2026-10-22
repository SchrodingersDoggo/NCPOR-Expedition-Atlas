import { normalizedFieldToken } from './detection.js';
import {
  collectPairedXY,
  finiteSpatialValue,
  pairedLatLonCount,
  pairedXYZCount,
  pairedXYCoverage,
  validCastPositions,
} from './spatialEvidence.js';

function enabled(reason = null, extra = {}) { return { enabled: true, reason, ...extra }; }
function disabled(reason, extra = {}) { return { enabled: false, reason, ...extra }; }

function finiteCount(values) {
  if (!values) return 0;
  let count = 0;
  for (const value of values) if (Number.isFinite(Number(value))) count += 1;
  return count;
}

function boundedUnique(values, cap = 10000) {
  const set = new Set();
  if (!values) return set;
  for (const raw of values) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    set.add(Number(value.toPrecision(10)));
    if (set.size >= cap) break;
  }
  return set;
}

function numericVariables(dataset) {
  const hasVisualVariableList = Array.isArray(dataset?.visualVariables);
  const visualKeys = new Set((dataset?.visualVariables || []).map((variable) => variable.fieldKey));
  if (hasVisualVariableList) {
    return (dataset?.fields || []).filter((field) => (
      visualKeys.has(field.key)
      && field.type === 'number'
      && finiteCount(field.values) > 0
    ));
  }

  const coordinateKeys = new Set(Object.values(dataset?.coords || {}).filter(Boolean));
  return (dataset?.fields || []).filter((field) => (
    field.type === 'number'
    && !coordinateKeys.has(field.key)
    && dataset?.mapping?.fields?.[field.key] === 'variable'
    && finiteCount(field.values) > 0
  ));
}

const VECTOR_PAIRS = [
  ['u', 'v'],
  ['u_east', 'v_north'],
  ['current_u', 'current_v'],
  ['eastward_velocity', 'northward_velocity'],
];

export function normalizeVectorUnit(unit) {
  let value = String(unit || '').trim().toLowerCase();
  if (!value) return '';
  value = value
    .replace(/−/g, '-')
    .replace(/⁻/g, '-')
    .replace(/¹/g, '1')
    .replace(/\^/g, '')
    .replace(/[·*]/g, ' ')
    .replace(/\bmetres?\b|\bmeters?\b/g, 'm')
    .replace(/\bseconds?\b|\bsecs?\b/g, 's')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^m\s*\/\s*s$/.test(value) || /^m\s+s\s*-1$/.test(value) || /^ms-1$/.test(value)) return 'm/s';
  if (/^cm\s*\/\s*s$/.test(value) || /^cm\s+s\s*-1$/.test(value) || /^cms-1$/.test(value)) return 'cm/s';
  return value.replace(/\s+/g, '');
}

function vectorPair(fields) {
  const byToken = new Map(fields.map((field) => [normalizedFieldToken(field), field]));
  for (const [u, v] of VECTOR_PAIRS) {
    const uField = byToken.get(u);
    const vField = byToken.get(v);
    if (!uField || !vField) continue;
    const uUnit = normalizeVectorUnit(uField.unit);
    const vUnit = normalizeVectorUnit(vField.unit);
    if (uUnit && vUnit && uUnit !== vUnit) continue;
    return { u: uField.key, v: vField.key };
  }
  return null;
}

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function pairedVectorCount(dataset, pair) {
  if (!pair) return 0;
  const lat = dataset?.normalizedCoords?.lat;
  const lon = dataset?.normalizedCoords?.lon;
  const u = fieldByKey(dataset, pair.u)?.values;
  const v = fieldByKey(dataset, pair.v)?.values;
  if (!lat || !lon || !u || !v) return 0;
  const length = Math.min(lat.length, lon.length, u.length, v.length);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (
      finiteSpatialValue(lat[i]) != null
      && finiteSpatialValue(lon[i]) != null
      && Number.isFinite(Number(u[i]))
      && Number.isFinite(Number(v[i]))
    ) count += 1;
  }
  return count;
}

function distinctCastPositions(casts = []) {
  return validCastPositions(casts).length;
}

function pairedNearSurfaceCount(dataset) {
  const coords = dataset?.normalizedCoords || {};
  const lat = coords.lat;
  const lon = coords.lon;
  if (!lat || !lon) return 0;
  const depth = coords.depth || coords.pressure;
  if (!depth?.length) return pairedLatLonCount(lat, lon);

  let min = Infinity;
  let max = -Infinity;
  for (const value of depth) {
    const numeric = finiteSpatialValue(value);
    if (numeric == null) continue;
    min = Math.min(min, numeric);
    max = Math.max(max, numeric);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  const tolerance = Math.max(2, (max - min) * 0.05);
  const length = Math.min(lat.length, lon.length, depth.length);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (
      finiteSpatialValue(lat[i]) != null
      && finiteSpatialValue(lon[i]) != null
      && finiteSpatialValue(depth[i]) != null
      && finiteSpatialValue(depth[i]) <= min + tolerance
    ) count += 1;
  }
  return count;
}

function uniqueDepthForPairedXYZ(lat, lon, depth) {
  const values = new Set();
  if (!lat || !lon || !depth) return values;
  const length = Math.min(lat.length, lon.length, depth.length);
  for (let i = 0; i < length; i += 1) {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    const z = finiteSpatialValue(depth[i]);
    if (a == null || b == null || z == null) continue;
    values.add(Number(z.toPrecision(10)));
    if (values.size >= 10000) break;
  }
  return values;
}

function denseVolumeEvidence(dataset) {
  const lat = dataset?.normalizedCoords?.lat;
  const lon = dataset?.normalizedCoords?.lon;
  const depth = dataset?.normalizedCoords?.depth;
  if (!lat || !lon || !depth) return { valid: false, reason: 'Requires latitude, longitude and true depth coordinates.' };

  const validRows = pairedXYZCount(lat, lon, depth);
  const coverage = pairedXYCoverage(lat, lon, depth);
  const uniqueDepth = uniqueDepthForPairedXYZ(lat, lon, depth).size;
  const gridCells = coverage.uniqueXY * uniqueDepth;
  const occupancy = gridCells ? Math.min(1, validRows / gridCells) : 0;

  // Volume needs actual 2-D horizontal coverage. Independent unique latitude
  // and longitude counts are deliberately not multiplied because a transect
  // can contain many of each while still lying on one line.
  const hasAreaCoverage = (
    coverage.uniqueXY >= 9
    && coverage.latSpread > 1e-7
    && coverage.lonSpread > 1e-7
    && coverage.normalizedArea >= 0.08
  );
  const valid = hasAreaCoverage && uniqueDepth >= 4 && validRows >= 32 && occupancy >= 0.2;

  return {
    valid,
    reason: valid ? null : 'Dense paired X/Y/Z coverage over a real 2-D area was not demonstrated; a transect or sparse casts must not be treated as a volume.',
    evidence: {
      uniqueXY: coverage.uniqueXY,
      uniqueDepth,
      validRows,
      latSpread: coverage.latSpread,
      lonSpread: coverage.lonSpread,
      normalizedArea: coverage.normalizedArea,
      gridCells,
      occupancy,
    },
  };
}

export function evaluateCapabilities(dataset) {
  const variables = numericVariables(dataset);
  const coords = dataset?.normalizedCoords || {};
  const pairedObservationPositions = pairedLatLonCount(coords.lat, coords.lon);
  const castPositions = validCastPositions(dataset?.casts || []);
  const mapPositionSource = pairedObservationPositions > 0
    ? 'observation-coordinates'
    : castPositions.length > 0
      ? 'cast-coordinates'
      : null;
  const mapPositionCount = mapPositionSource === 'observation-coordinates' ? pairedObservationPositions : castPositions.length;
  const vertical = dataset?.vertical;
  const verticalValues = vertical?.kind === 'depth' ? coords.depth : vertical?.kind === 'pressure' ? coords.pressure : null;
  const hasVertical = finiteCount(verticalValues) >= 2;
  const hasTime = coords.timeNormalized && finiteCount(coords.time) >= 2;
  const casts = dataset?.casts || [];
  const vectors = vectorPair(variables);
  const pairedVectors = pairedVectorCount(dataset, vectors);
  const distinctCastLocations = distinctCastPositions(casts);
  const volume = denseVolumeEvidence(dataset);
  const surfacePairs = pairedNearSurfaceCount(dataset);

  return {
    table: dataset?.rowCount > 0 && dataset?.fields?.length ? enabled(null) : disabled('No structured rows are available.'),
    histogram: variables.length >= 1 ? enabled(null, { variables: variables.map((f) => f.key) }) : disabled('Requires at least one numeric visualization variable.'),
    scatter: variables.length >= 2 ? enabled(null, { variables: variables.map((f) => f.key) }) : disabled('Requires at least two numeric visualization variables.'),
    timeSeries: hasTime && variables.length ? enabled(null) : disabled(!hasTime ? 'Requires a recognized time coordinate.' : 'Requires a numeric visualization variable.'),
    profile: hasVertical && variables.length ? enabled(null, { verticalKind: vertical.kind }) : disabled(!hasVertical ? 'Requires depth or pressure as a vertical coordinate.' : 'Requires a numeric visualization variable.'),
    map: mapPositionCount > 0
      ? enabled(null, {
        positionSource: mapPositionSource,
        pairedObservationPositions,
        castPositionCount: castPositions.length,
      })
      : disabled('Requires at least one valid paired latitude/longitude observation or cast position.'),
    curtain: hasVertical && casts.length >= 2 && distinctCastLocations >= 2 && variables.length
      ? enabled(null, { castCount: casts.length, distinctCastLocations, verticalKind: vertical.kind, positionSource: 'cast-coordinates' })
      : disabled('Requires multiple casts at distinct valid locations, a vertical coordinate and a numeric visualization variable.'),
    depthSlice: vertical?.kind === 'depth' && hasVertical && casts.length >= 4 && distinctCastLocations >= 4 && variables.length
      ? enabled(null, { castCount: casts.length, distinctCastLocations, verticalKind: 'depth', positionSource: 'cast-coordinates' })
      : disabled('Requires several spatially distributed casts at distinct valid locations and a true depth coordinate.'),
    surfaceMap: pairedObservationPositions >= 3 && variables.length && surfacePairs >= 3
      ? enabled(null, { positionSource: 'observation-coordinates', pairedObservationPositions: surfacePairs })
      : disabled('Requires at least three paired latitude/longitude near-surface observations and a numeric visualization variable.'),
    vectorField: pairedVectors >= 1 && vectors
      ? enabled(null, { pair: vectors, positionSource: 'observation-coordinates', pairedObservationPositions: pairedVectors })
      : disabled(!vectors ? 'No known U/V vector pair was detected.' : 'Requires U/V values on rows with paired latitude and longitude coordinates.'),
    volume: volume.valid && variables.length
      ? enabled(null, { evidence: volume.evidence, positionSource: 'observation-coordinates' })
      : disabled(volume.reason || 'Requires a numeric visualization variable.', { evidence: volume.evidence }),
  };
}

export { pairedLatLonCount, pairedXYZCount, collectPairedXY } from './spatialEvidence.js';
