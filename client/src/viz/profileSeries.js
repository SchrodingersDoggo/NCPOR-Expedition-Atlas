import { minMaxDownsample } from './sampling.js';

// Vertical profiles must be drawn one line per cast. Joining every row of a
// multi-station file into a single line zig-zags between stations at the same
// depth, which looks like real structure but is an artefact.

function castSegments(cast, rowCount) {
  const segments = Array.isArray(cast?.segments) && cast.segments.length
    ? cast.segments
    : [{ rowStart: cast?.rowStart ?? 0, rowEnd: cast?.rowEnd ?? cast?.rowStart ?? 0 }];
  return segments
    .map((segment) => ({
      start: Math.max(0, Number(segment.rowStart) || 0),
      end: Math.min(rowCount - 1, Number(segment.rowEnd ?? segment.rowStart) || 0),
    }))
    .filter((segment) => segment.end >= segment.start);
}

function prettyCastId(id) {
  return String(id).replace(/^station-/, 'Station ').replace(/^cast-/, 'Cast ').replace(/^inferred-/, 'Cast ');
}

export function castLabel(cast, index = 0) {
  const label = cast?.station ?? cast?.label ?? cast?.name ?? null;
  if (label != null && String(label).trim()) return String(label).trim();
  if (cast?.sourceFileName) {
    // One cast per file (e.g. Sea-Bird CNV): the file name is the best label.
    return !cast?.id || cast.id === 'cast-1' ? cast.sourceFileName : `${cast.sourceFileName} · ${prettyCastId(cast.id)}`;
  }
  if (cast?.id) return prettyCastId(cast.id);
  return `Cast ${index + 1}`;
}

function gather(values, segments, length) {
  const out = new Float64Array(length);
  let offset = 0;
  for (const segment of segments) {
    for (let row = segment.start; row <= segment.end; row += 1) {
      const n = Number(values?.[row]);
      out[offset] = Number.isFinite(n) ? n : Number.NaN;
      offset += 1;
    }
  }
  return out;
}

// Returns bounded per-cast profile series: each series holds points sorted by
// the vertical coordinate ({ x: vertical, y: value, index: sourceRow }).
export function profileSeries(dataset, verticalValues, variableValues, { maxPoints = 4000, maxCasts = 60 } = {}) {
  const rowCount = Number(dataset?.rowCount || Math.min(verticalValues?.length || 0, variableValues?.length || 0));
  if (!verticalValues || !variableValues || !rowCount) return { series: [], castCount: 0, truncated: false };

  const casts = Array.isArray(dataset?.casts) ? dataset.casts : [];
  if (casts.length < 2) {
    const points = minMaxDownsample(verticalValues, variableValues, maxPoints);
    return {
      series: points.length ? [{ id: casts[0]?.id || 'all', label: casts[0] ? castLabel(casts[0], 0) : 'All observations', points }] : [],
      castCount: casts.length,
      truncated: false,
    };
  }

  const shown = casts.slice(0, maxCasts);
  const perCast = Math.max(60, Math.floor(maxPoints / shown.length));
  const series = [];
  shown.forEach((cast, index) => {
    const segments = castSegments(cast, rowCount);
    const length = segments.reduce((sum, segment) => sum + segment.end - segment.start + 1, 0);
    if (!length) return;
    const vertical = gather(verticalValues, segments, length);
    const values = gather(variableValues, segments, length);
    const points = minMaxDownsample(vertical, values, perCast);
    if (!points.length) return;
    // Map local indices back to source rows so tooltips can reference them.
    const rowForOffset = (offset) => {
      let remaining = offset;
      for (const segment of segments) {
        const size = segment.end - segment.start + 1;
        if (remaining < size) return segment.start + remaining;
        remaining -= size;
      }
      return null;
    };
    series.push({
      id: String(cast.id ?? `cast-${index + 1}`),
      label: castLabel(cast, index),
      points: points.map((point) => ({ ...point, index: rowForOffset(point.index) })),
    });
  });

  return { series, castCount: casts.length, truncated: casts.length > shown.length };
}
