import { depthUnitToKmScale } from './v6Units.js';

function enabled(reason = null, extra = {}) { return { enabled: true, reason, ...extra }; }
function disabled(reason, extra = {}) { return { enabled: false, reason, ...extra }; }

function volumeMetricCapability(dataset, base) {
  if (!base?.enabled) return base;
  if (dataset?.vertical?.kind !== 'depth') {
    return disabled('Advanced volume/isosurface rendering requires true geometric depth; pressure is not silently converted to distance.', { baseCapability: base });
  }
  if (depthUnitToKmScale(dataset?.vertical?.unit) == null) {
    return disabled('Advanced volume/isosurface rendering requires a recognized geometric depth unit (m, km, cm, or mm).', { baseCapability: base });
  }
  return base;
}

export function evaluateAdvanced3DCapabilities(dataset, baseCapabilities = {}, { completeSource = true, cachedProducts = {}, productKeys = {} } = {}) {
  const hasCached = (view) => Boolean(productKeys[view] && cachedProducts?.[productKeys[view]]);
  const effectiveVolume = volumeMetricCapability(dataset, baseCapabilities.volume);
  const sourceRequired = (view, base, label, basedOn) => {
    // A matching bounded derived product may be rendered from vizCache even if
    // the bounded row sample itself cannot re-demonstrate full-source evidence.
    if (hasCached(view)) return enabled(null, { cachedProduct: true, basedOn });
    if (!base?.enabled) return disabled(base?.reason || `${label} is not scientifically supported by this exact dataset/slice.`);
    if (completeSource) return enabled(null, { basedOn });
    return disabled(`Load the full source dataset once to generate ${label}; the bounded visualization cache does not contain this derived 3D product yet.`);
  };
  return {
    surface3D: sourceRequired('surface3D', baseCapabilities.surfaceMap, '3D surface', 'surfaceMap'),
    curtain3D: sourceRequired('curtain3D', baseCapabilities.curtain, '3D curtain', 'curtain'),
    volume3D: sourceRequired('volume3D', effectiveVolume, '3D volume field', 'volume'),
    isosurface: sourceRequired('volume3D', effectiveVolume, 'isosurface', 'volume'),
    vector3D: sourceRequired('vector3D', baseCapabilities.vectorField, '3D vector field', 'vectorField'),
  };
}

export function fallbackForAdvancedView(view, baseCapabilities = {}) {
  const ordered = view === 'surface3D'
    ? ['surfaceMap', 'map', 'table']
    : view === 'curtain3D'
      ? ['curtain', 'profile', 'map', 'table']
      : view === 'vector3D'
        ? ['vectorField', 'map', 'table']
        : ['surfaceMap', 'map', 'table'];
  return ordered.find((key) => baseCapabilities?.[key]?.enabled) || 'table';
}
