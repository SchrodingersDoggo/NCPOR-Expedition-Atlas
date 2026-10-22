import { finiteSpatialValue } from './spatialEvidence.js';

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function finiteVectorValue(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function sampleValidVectors(dataset, pair, maxArrows = 700) {
  if (!pair || maxArrows <= 0) return [];
  const lat = dataset?.normalizedCoords?.lat;
  const lon = dataset?.normalizedCoords?.lon;
  const u = fieldByKey(dataset, pair.u)?.values;
  const v = fieldByKey(dataset, pair.v)?.values;
  if (!lat || !lon || !u || !v) return [];
  const length = Math.min(lat.length, lon.length, u.length, v.length);

  let validCount = 0;
  for (let i = 0; i < length; i += 1) {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    const uu = finiteVectorValue(u[i]);
    const vv = finiteVectorValue(v[i]);
    if (a != null && b != null && uu != null && vv != null) validCount += 1;
  }
  if (!validCount) return [];

  const targetCount = Math.min(validCount, Math.max(1, Math.floor(maxArrows)));
  const targetOrdinals = new Array(targetCount);
  if (targetCount === 1) targetOrdinals[0] = Math.floor((validCount - 1) / 2);
  else {
    for (let k = 0; k < targetCount; k += 1) {
      targetOrdinals[k] = Math.round((k * (validCount - 1)) / (targetCount - 1));
    }
  }

  const out = [];
  let validOrdinal = 0;
  let targetIndex = 0;
  for (let i = 0; i < length && targetIndex < targetOrdinals.length; i += 1) {
    const a = finiteSpatialValue(lat[i]);
    const b = finiteSpatialValue(lon[i]);
    const uu = finiteVectorValue(u[i]);
    const vv = finiteVectorValue(v[i]);
    if (a == null || b == null || uu == null || vv == null) continue;
    if (validOrdinal === targetOrdinals[targetIndex]) {
      out.push({ lat: a, lon: b, u: uu, v: vv, speed: Math.hypot(uu, vv), index: i });
      targetIndex += 1;
    }
    validOrdinal += 1;
  }
  return out;
}
