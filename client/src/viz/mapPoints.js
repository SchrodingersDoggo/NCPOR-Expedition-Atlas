import { validCastPositions } from './spatialEvidence.js';

export function castMapPoints(casts = []) {
  return validCastPositions(casts).map((position) => ({
    lat: position.latitude,
    lon: position.longitude,
    value: null,
    count: 1,
    castId: position.castId,
  }));
}
