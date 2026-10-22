import { evaluateCapabilities } from './capabilities.js';
import { finiteSpatialValue } from './spatialEvidence.js';
import {
  curtainMeasurements,
  interpolateBoundedGrid,
  projectGeographicPoints,
  surfaceMeasurements,
} from './v4Spatial.js';
import { sampleValidVectors } from './vectorSampling.js';
import { depthUnitToKmScale } from './v6Units.js';

export const V6_GPU_LIMITS = Object.freeze({
  surfaceCells: 2600,
  surfaceSources: 1400,
  curtainPoints: 5000,
  volumeSourcePoints: 2600,
  volumeCells: 9000,
  volumeMaxAxis: 24,
  vectorArrows: 700,
  maxIsoTriangles: 12000,
  // Retained only for backwards-compatible diagnostics; the renderer now uses
  // a real bounded triangle mesh rather than voxel-shell points.
  isosurfacePoints: 7000,
});

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function finite(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function range(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const raw of values || []) {
    const value = finite(raw);
    if (value == null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function boundedOrdinals(validCount, maxPoints) {
  const target = Math.min(validCount, Math.max(1, Math.floor(maxPoints)));
  if (!target) return [];
  const ordinals = new Array(target);
  if (target === 1) ordinals[0] = Math.floor((validCount - 1) / 2);
  else {
    for (let index = 0; index < target; index += 1) {
      ordinals[index] = Math.round((index * (validCount - 1)) / (target - 1));
    }
  }
  return ordinals;
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

function convexHull(points) {
  const unique = [...new Map(points.map((p) => [`${p.x}|${p.y}`, { x: p.x, y: p.y }])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
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

export { depthUnitToKmScale } from './v6Units.js';

function capabilityGate(dataset, capabilityKey, label, suppliedCapability = null) {
  const capability = suppliedCapability || evaluateCapabilities(dataset)?.[capabilityKey];
  if (!capability?.enabled) {
    return {
      valid: false,
      reason: capability?.reason || `${label} is not scientifically supported by the authoritative capability engine.`,
      capability,
    };
  }
  return { valid: true, capability };
}

function boundedVolumeSource(dataset, variableKey, maxPoints) {
  const variable = fieldByKey(dataset, variableKey);
  const lat = dataset?.normalizedCoords?.lat;
  const lon = dataset?.normalizedCoords?.lon;
  const depth = dataset?.normalizedCoords?.depth;
  if (!variable?.values || !lat || !lon || !depth) return [];
  const length = Math.min(variable.values.length, lat.length, lon.length, depth.length);
  let validCount = 0;
  for (let index = 0; index < length; index += 1) {
    if (
      finiteSpatialValue(lat[index]) != null
      && finiteSpatialValue(lon[index]) != null
      && finite(depth[index]) != null
      && finite(variable.values[index]) != null
    ) validCount += 1;
  }
  if (!validCount) return [];
  const ordinals = boundedOrdinals(validCount, maxPoints);
  const points = [];
  let validOrdinal = 0;
  let target = 0;
  for (let index = 0; index < length && target < ordinals.length; index += 1) {
    const latValue = finiteSpatialValue(lat[index]);
    const lonValue = finiteSpatialValue(lon[index]);
    const depthValue = finite(depth[index]);
    const value = finite(variable.values[index]);
    if (latValue == null || lonValue == null || depthValue == null || value == null) continue;
    if (validOrdinal === ordinals[target]) {
      points.push({ lat: latValue, lon: lonValue, depth: depthValue, value, row: index });
      target += 1;
    }
    validOrdinal += 1;
  }
  return points;
}

export function chooseVolumeResolution(sourceCount, bounds, maxCells = V6_GPU_LIMITS.volumeCells) {
  const sx = Math.max(1e-9, bounds.maxX - bounds.minX);
  const sy = Math.max(1e-9, bounds.maxY - bounds.minY);
  const sz = Math.max(1e-9, bounds.maxZ - bounds.minZ);
  const longest = Math.max(sx, sy, sz);
  const normalizedVolume = Math.max(1e-12, (sx / longest) * (sy / longest) * (sz / longest));
  const geometric = Math.cbrt(Math.max(64, Math.min(maxCells, sourceCount * 5)) / normalizedVolume);
  const scale = Math.max(5, Math.min(V6_GPU_LIMITS.volumeMaxAxis, geometric));
  let nx = Math.max(5, Math.min(V6_GPU_LIMITS.volumeMaxAxis, Math.round(scale * sx / longest)));
  let ny = Math.max(5, Math.min(V6_GPU_LIMITS.volumeMaxAxis, Math.round(scale * sy / longest)));
  let nz = Math.max(5, Math.min(V6_GPU_LIMITS.volumeMaxAxis, Math.round(scale * sz / longest)));
  while (nx * ny * nz > maxCells) {
    if (nx >= ny && nx >= nz && nx > 5) nx -= 1;
    else if (ny >= nx && ny >= nz && ny > 5) ny -= 1;
    else if (nz > 5) nz -= 1;
    else break;
  }
  return { nx, ny, nz, cells: nx * ny * nz, units: 'km' };
}

export function prepareV6ProductInput(view, dataset, variableKey, pair = null, { capability = null } = {}) {
  if (!dataset) return { valid: false, kind: view, reason: 'Dataset is unavailable.' };

  if (view === 'surface3D') {
    const gate = capabilityGate(dataset, 'surfaceMap', '3D surface', capability);
    if (!gate.valid) return { kind: 'surface3d', ...gate };
    const variable = fieldByKey(dataset, variableKey);
    if (!variable?.values) return { kind: 'surface3d', valid: false, reason: 'Selected variable is unavailable.' };
    const measured = surfaceMeasurements(dataset, variableKey, { maxPoints: V6_GPU_LIMITS.surfaceSources });
    return {
      kind: 'surface3d', valid: true, variableKey, variableName: variable.originalName, unit: variable.unit || null,
      measured, baseCapability: gate.capability,
    };
  }

  if (view === 'curtain3D') {
    const gate = capabilityGate(dataset, 'curtain', '3D curtain', capability);
    if (!gate.valid) return { kind: 'curtain3d', ...gate };
    const variable = fieldByKey(dataset, variableKey);
    if (!variable?.values) return { kind: 'curtain3d', valid: false, reason: 'Selected variable is unavailable.' };
    const section = curtainMeasurements(dataset, variableKey, { maxPerCast: 260 });
    return {
      kind: 'curtain3d', valid: true, variableKey, variableName: variable.originalName, unit: variable.unit || null,
      section, baseCapability: gate.capability,
    };
  }

  if (view === 'volume3D' || view === 'isosurface') {
    const gate = capabilityGate(dataset, 'volume', view === 'isosurface' ? 'isosurface' : '3D volume field', capability);
    if (!gate.valid) return { kind: 'volume3d', ...gate };
    if (dataset?.vertical?.kind !== 'depth') {
      return { kind: 'volume3d', valid: false, reason: 'Interpolated volume requires true geometric depth; pressure is not silently converted to distance.' };
    }
    const depthScaleKm = depthUnitToKmScale(dataset?.vertical?.unit);
    if (depthScaleKm == null) {
      return { kind: 'volume3d', valid: false, reason: 'Interpolated volume requires a recognized geometric depth unit (m, km, cm, or mm).' };
    }
    const variable = fieldByKey(dataset, variableKey);
    const source = boundedVolumeSource(dataset, variableKey, V6_GPU_LIMITS.volumeSourcePoints);
    if (!variable || source.length < 16) {
      return { kind: 'volume3d', valid: false, reason: 'Not enough valid paired X/Y/depth/variable observations are available.' };
    }
    return {
      kind: 'volume3d', valid: true, variableKey, variableName: variable.originalName, unit: variable.unit || null,
      source, depthScaleKm, depthUnit: dataset.vertical.unit, baseCapability: gate.capability,
    };
  }

  if (view === 'vector3D') {
    const gate = capabilityGate(dataset, 'vectorField', '3D vector field', capability);
    if (!gate.valid) return { kind: 'vector3d', ...gate };
    const effectivePair = pair || gate.capability?.pair;
    if (!effectivePair) return { kind: 'vector3d', valid: false, reason: 'No known valid U/V vector pair is available.' };
    const sampled = sampleValidVectors(dataset, effectivePair, V6_GPU_LIMITS.vectorArrows);
    const verticalValues = dataset?.normalizedCoords?.depth || dataset?.normalizedCoords?.pressure || null;
    const sampledWithVertical = sampled.map((point) => ({
      ...point,
      vertical: verticalValues && Number.isFinite(Number(verticalValues[point.index])) ? Number(verticalValues[point.index]) : 0,
    }));
    return {
      kind: 'vector3d', valid: sampledWithVertical.length > 0, pair: effectivePair,
      sampled: sampledWithVertical, verticalMode: verticalValues ? (dataset?.vertical?.kind || 'vertical') : 'plane',
      baseCapability: gate.capability,
      reason: sampledWithVertical.length ? null : 'No valid paired vectors are available.',
    };
  }

  return { kind: view, valid: false, reason: 'This 3D view is not supported for this data.' };
}

function buildSurfaceFromPrepared(input) {
  const grid = interpolateBoundedGrid(input.measured || [], {
    maxCells: V6_GPU_LIMITS.surfaceCells,
    maxSourcePoints: V6_GPU_LIMITS.surfaceSources,
    coordinateMode: 'geographic',
  });
  if (!grid.cells.length) {
    return { kind: 'surface3d', valid: false, reason: 'A bounded two-dimensional interpolation surface could not be supported by the measured positions.', measured: grid.measured || [] };
  }
  return {
    kind: 'surface3d', valid: true,
    variableKey: input.variableKey, variableName: input.variableName, unit: input.unit,
    cells: grid.cells,
    measured: (grid.measured || []).slice(0, V6_GPU_LIMITS.surfaceSources),
    bounds: grid.bounds, resolution: grid.resolution, coverage: grid.coverage,
    valueRange: range(grid.cells.map((cell) => cell.value)), geographicBounds: grid.geographicBounds || null,
    provenance: ['Interpolated surface is coverage-masked and bounded; measurement locations remain distinct from interpolated cells.'],
  };
}

function buildCurtainFromPrepared(input) {
  const section = input.section || { points: [], track: [] };
  if (section.track.length < 2 || !section.points.length) {
    return { kind: 'curtain3d', valid: false, reason: 'At least two valid casts with vertical measurements are required.' };
  }
  const projectedTrack = projectGeographicPoints(section.track.map((entry) => ({
    lat: entry.lat, lon: entry.lon, value: 0, castId: entry.cast.id, distanceKm: entry.distanceKm,
  })));
  const byCast = new Map(projectedTrack.points.map((point) => [String(point.castId), point]));
  const points = [];
  for (const point of section.points) {
    const location = byCast.get(String(point.castId));
    if (!location) continue;
    points.push({ x: location.x, y: location.y, z: -Math.abs(Number(point.y)), value: Number(point.value), castId: point.castId, measured: true });
    if (points.length >= V6_GPU_LIMITS.curtainPoints) break;
  }
  return {
    kind: 'curtain3d', valid: points.length >= 2,
    reason: points.length >= 2 ? null : 'No bounded curtain points were available.',
    variableKey: input.variableKey, variableName: input.variableName, unit: input.unit,
    verticalKind: section.verticalKind, points,
    track: projectedTrack.points.map((point) => ({ x: point.x, y: point.y, z: 0, castId: point.castId, distanceKm: point.distanceKm })),
    valueRange: range(points.map((point) => point.value)), orderMode: section.orderMode, warning: section.warning,
    provenance: ['Curtain positions use a dateline-safe local geographic projection; vertical position uses measured depth/pressure.'],
  };
}

function buildVolumeFromPrepared(input, isCancelled = () => false) {
  const projected = projectGeographicPoints((input.source || []).map((point) => ({ ...point, value: point.value })));
  if (projected.points.length < 16) return { kind: 'volume3d', valid: false, reason: 'Spatial projection did not retain enough valid volume observations.' };
  const points = projected.points.map((point) => ({ ...point, z: Math.abs(Number(point.depth)) * input.depthScaleKm }));
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)),
    minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)),
    units: 'km',
  };
  const sx = Math.max(1e-9, bounds.maxX - bounds.minX);
  const sy = Math.max(1e-9, bounds.maxY - bounds.minY);
  const sz = Math.max(1e-9, bounds.maxZ - bounds.minZ);
  if (!(sx > 0) || !(sy > 0) || !(sz > 0)) return { kind: 'volume3d', valid: false, reason: 'Three-dimensional spatial extent was not demonstrated.' };
  const normalized = points.map((point) => ({ ...point, nx: (point.x - bounds.minX) / sx, ny: (point.y - bounds.minY) / sy, nz: (point.z - bounds.minZ) / sz }));
  const hull = convexHull(normalized.map((point) => ({ x: point.nx, y: point.ny })));
  if (hull.length < 3) return { kind: 'volume3d', valid: false, reason: 'Horizontal measurements are collinear; a volume must not be invented from a transect.' };
  const resolution = chooseVolumeResolution(points.length, bounds);
  const threshold = Math.min(0.45, Math.max(0.12, 2.3 / Math.cbrt(normalized.length)));
  const cells = [];
  for (let iz = 0; iz < resolution.nz; iz += 1) {
    if (isCancelled()) throw new DOMException('V6 product generation cancelled.', 'AbortError');
    const nz = resolution.nz === 1 ? 0.5 : iz / (resolution.nz - 1);
    for (let iy = 0; iy < resolution.ny; iy += 1) {
      const ny = resolution.ny === 1 ? 0.5 : iy / (resolution.ny - 1);
      for (let ix = 0; ix < resolution.nx; ix += 1) {
        const nx = resolution.nx === 1 ? 0.5 : ix / (resolution.nx - 1);
        if (!pointInPolygon({ x: nx, y: ny }, hull)) continue;
        const nearest = [];
        for (const point of normalized) {
          const dx = point.nx - nx; const dy = point.ny - ny; const dz = point.nz - nz;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (distance > threshold) continue;
          if (nearest.length < 4) { nearest.push({ point, distance }); nearest.sort((a, b) => a.distance - b.distance); }
          else if (distance < nearest[3].distance) { nearest[3] = { point, distance }; nearest.sort((a, b) => a.distance - b.distance); }
        }
        if (!nearest.length) continue;
        let value;
        if (nearest[0].distance < 1e-9) value = nearest[0].point.value;
        else {
          let weighted = 0; let total = 0;
          for (const item of nearest) {
            const weight = 1 / Math.max(1e-8, item.distance ** 2);
            weighted += item.point.value * weight; total += weight;
          }
          value = weighted / total;
        }
        const confidence = Math.max(0, 1 - nearest[0].distance / threshold);
        if (confidence <= 0) continue;
        cells.push({
          x: bounds.minX + nx * sx, y: bounds.minY + ny * sy, z: bounds.minZ + nz * sz,
          value, confidence, ix, iy, iz, interpolated: nearest[0].distance >= 1e-9,
        });
      }
    }
  }
  return {
    kind: 'volume3d', valid: cells.length > 0,
    reason: cells.length ? null : 'Coverage masking left no defensible interpolated volume cells.',
    variableKey: input.variableKey, variableName: input.variableName, unit: input.unit,
    cells, measured: points.slice(0, 900).map((point) => ({ x: point.x, y: point.y, z: point.z, value: point.value })),
    bounds, resolution, valueRange: range(cells.map((cell) => cell.value)),
    coverage: resolution.cells ? cells.length / resolution.cells : 0, threshold,
    coordinateUnits: { horizontal: 'km', vertical: 'km', sourceDepthUnit: input.depthUnit },
    provenance: [
      `Interpolated Volume Field uses local horizontal kilometres and converts depth from ${input.depthUnit} to kilometres for scientific interpolation coordinates.`,
      'Visual vertical exaggeration is applied only in the renderer and does not change scientific interpolation coordinates.',
      'Volume is a bounded, coverage-masked interpolation of measurements. It is not direct volumetric measurement between observation locations.',
    ],
  };
}

function buildVectorFromPrepared(input) {
  const projected = projectGeographicPoints((input.sampled || []).map((point) => ({ ...point, value: point.speed })));
  const arrows = projected.points.map((point) => ({
    x: point.x, y: point.y, z: -Math.abs(Number(point.vertical || 0)),
    u: point.u, v: point.v, speed: point.speed, index: point.index,
  }));
  return {
    kind: 'vector3d', valid: arrows.length > 0,
    reason: arrows.length ? null : 'No valid paired vectors are available.',
    pair: input.pair, arrows, speedRange: range(arrows.map((arrow) => arrow.speed)), verticalMode: input.verticalMode,
    provenance: ['Vector arrows are bounded samples of valid paired U/V observations and use a dateline-safe local geographic projection.'],
  };
}

export function buildV6ProductFromPrepared(input, { isCancelled = () => false } = {}) {
  if (!input?.valid) return input || { valid: false, reason: '3D product input is unavailable.' };
  if (input.kind === 'surface3d') return buildSurfaceFromPrepared(input);
  if (input.kind === 'curtain3d') return buildCurtainFromPrepared(input);
  if (input.kind === 'volume3d') return buildVolumeFromPrepared(input, isCancelled);
  if (input.kind === 'vector3d') return buildVectorFromPrepared(input);
  return { kind: input.kind, valid: false, reason: 'This 3D view is not supported for this data.' };
}

export function buildSurface3DProduct(dataset, variableKey, options = {}) {
  return buildV6ProductFromPrepared(prepareV6ProductInput('surface3D', dataset, variableKey, null, options));
}
export function buildCurtain3DProduct(dataset, variableKey, options = {}) {
  return buildV6ProductFromPrepared(prepareV6ProductInput('curtain3D', dataset, variableKey, null, options));
}
export function buildVolume3DProduct(dataset, variableKey, options = {}) {
  return buildV6ProductFromPrepared(prepareV6ProductInput('volume3D', dataset, variableKey, null, options));
}
export function buildVector3DProduct(dataset, pair, maxArrows = V6_GPU_LIMITS.vectorArrows, options = {}) {
  const prepared = prepareV6ProductInput('vector3D', dataset, null, pair, options);
  if (prepared.valid && maxArrows < V6_GPU_LIMITS.vectorArrows) prepared.sampled = prepared.sampled.slice(0, maxArrows);
  return buildV6ProductFromPrepared(prepared);
}

function interpolateEdge(a, b, iso) {
  const dv = b.value - a.value;
  const t = Math.abs(dv) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (iso - a.value) / dv));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function tetraTriangles(vertices, iso) {
  const inside = [];
  const outside = [];
  for (const vertex of vertices) (vertex.value >= iso ? inside : outside).push(vertex);
  if (!inside.length || !outside.length) return [];
  if (inside.length === 1 || inside.length === 3) {
    const loneInside = inside.length === 1;
    const lone = loneInside ? inside[0] : outside[0];
    const others = loneInside ? outside : inside;
    const p = others.map((other) => interpolateEdge(lone, other, iso));
    return loneInside ? [[p[0], p[1], p[2]]] : [[p[0], p[2], p[1]]];
  }
  const [a, b] = inside;
  const [c, d] = outside;
  const ac = interpolateEdge(a, c, iso);
  const ad = interpolateEdge(a, d, iso);
  const bc = interpolateEdge(b, c, iso);
  const bd = interpolateEdge(b, d, iso);
  return [[ac, ad, bc], [ad, bd, bc]];
}

export function buildIsosurfaceMesh(volumeProduct, isoValue, { maxTriangles = V6_GPU_LIMITS.maxIsoTriangles, isCancelled = () => false } = {}) {
  if (!volumeProduct?.valid || !volumeProduct.cells?.length) return { kind: 'isosurfaceMesh', valid: false, reason: 'A valid coverage-masked volume is required.', positions: new Float32Array(0), triangleCount: 0 };
  const iso = finite(isoValue);
  if (iso == null) return { kind: 'isosurfaceMesh', valid: false, reason: 'A finite isovalue is required.', positions: new Float32Array(0), triangleCount: 0 };
  const byCell = new Map(volumeProduct.cells.map((cell) => [`${cell.ix}:${cell.iy}:${cell.iz}`, cell]));
  const { nx, ny, nz } = volumeProduct.resolution || {};
  if (![nx, ny, nz].every((value) => Number.isInteger(value) && value >= 2)) return { kind: 'isosurfaceMesh', valid: false, reason: 'Volume grid resolution is insufficient for isosurface extraction.', positions: new Float32Array(0), triangleCount: 0 };
  const positions = [];
  const tetrahedra = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  let triangleCount = 0;
  let truncated = false;
  outer: for (let iz = 0; iz < nz - 1; iz += 1) {
    if (isCancelled()) throw new DOMException('Isosurface generation cancelled.', 'AbortError');
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const keys = [
          `${ix}:${iy}:${iz}`, `${ix + 1}:${iy}:${iz}`, `${ix + 1}:${iy + 1}:${iz}`, `${ix}:${iy + 1}:${iz}`,
          `${ix}:${iy}:${iz + 1}`, `${ix + 1}:${iy}:${iz + 1}`, `${ix + 1}:${iy + 1}:${iz + 1}`, `${ix}:${iy + 1}:${iz + 1}`,
        ];
        const corners = keys.map((key) => byCell.get(key));
        // Coverage safety: never bridge an unsupported/masked corner.
        if (corners.some((corner) => !corner || !Number.isFinite(corner.value))) continue;
        for (const tetra of tetrahedra) {
          const triangles = tetraTriangles(tetra.map((index) => corners[index]), iso);
          for (const triangle of triangles) {
            if (triangleCount >= maxTriangles) { truncated = true; break outer; }
            for (const vertex of triangle) positions.push(vertex.x, vertex.y, vertex.z);
            triangleCount += 1;
          }
        }
      }
    }
  }
  return {
    kind: 'isosurfaceMesh', valid: triangleCount > 0,
    reason: triangleCount ? null : 'No covered grid cells crossed the selected isovalue.',
    positions: new Float32Array(positions), triangleCount, isoValue: iso, truncated,
    maxTriangles, bounds: volumeProduct.bounds, unit: volumeProduct.unit || null,
    provenance: [
      'Isosurface is derived from an interpolated, coverage-masked volume. It is not a directly measured boundary.',
      ...(truncated ? [`Isosurface triangle extraction stopped at the GPU safety budget of ${maxTriangles.toLocaleString()} triangles.`] : []),
    ],
  };
}

// Backwards-compatible diagnostic helper. The Three.js renderer no longer uses
// voxel shell points; it renders buildIsosurfaceMesh() triangle geometry.
export function buildIsosurfacePoints(volumeProduct, isoValue, maxPoints = V6_GPU_LIMITS.isosurfacePoints) {
  const mesh = buildIsosurfaceMesh(volumeProduct, isoValue, { maxTriangles: Math.max(1, Math.floor(maxPoints / 2)) });
  if (!mesh.valid) return [];
  const points = [];
  for (let i = 0; i + 8 < mesh.positions.length && points.length < maxPoints; i += 9) {
    points.push({
      x: (mesh.positions[i] + mesh.positions[i + 3] + mesh.positions[i + 6]) / 3,
      y: (mesh.positions[i + 1] + mesh.positions[i + 4] + mesh.positions[i + 7]) / 3,
      z: (mesh.positions[i + 2] + mesh.positions[i + 5] + mesh.positions[i + 8]) / 3,
      value: isoValue,
    });
  }
  return points;
}
