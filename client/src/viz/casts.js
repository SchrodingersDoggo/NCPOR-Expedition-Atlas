function finiteAt(values, index) {
  const raw = values?.[index];
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function representative(values, start, end) {
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    const value = finiteAt(values, i);
    if (value == null) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : null;
}


function representativeSegments(values, segments) {
  let sum = 0;
  let count = 0;
  for (const segment of segments) {
    for (let i = segment.rowStart; i <= segment.rowEnd; i += 1) {
      const value = finiteAt(values, i);
      if (value == null) continue;
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : null;
}
function castFromRange(id, start, end, coords, extra = {}) {
  const times = coords.time;
  return {
    id,
    rowStart: start,
    rowEnd: end,
    rowCount: end - start + 1,
    latitude: representative(coords.lat, start, end),
    longitude: representative(coords.lon, start, end),
    startTime: finiteAt(times, start),
    endTime: finiteAt(times, end),
    ...extra,
  };
}

function groupByStation(dataset) {
  const stations = dataset?.normalizedCoords?.station;
  if (!stations?.length) return [];
  const groups = new Map();
  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i];
    if (!station) continue;
    if (!groups.has(station)) groups.set(station, []);
    const segments = groups.get(station);
    const last = segments.at(-1);
    if (last && last.rowEnd === i - 1) last.rowEnd = i;
    else segments.push({ rowStart: i, rowEnd: i });
  }

  return [...groups.entries()].map(([station, segments], index) => {
    const first = segments[0].rowStart;
    const last = segments.at(-1).rowEnd;
    const rowCount = segments.reduce((sum, segment) => sum + segment.rowEnd - segment.rowStart + 1, 0);
    return {
      id: `station-${index + 1}`,
      rowStart: first,
      rowEnd: last,
      rowCount,
      latitude: representativeSegments(dataset.normalizedCoords.lat, segments),
      longitude: representativeSegments(dataset.normalizedCoords.lon, segments),
      startTime: finiteAt(dataset.normalizedCoords.time, first),
      endTime: finiteAt(dataset.normalizedCoords.time, last),
      station,
      source: 'station-field',
      segments,
    };
  });
}

function inferSequentialCasts(dataset, { locationToleranceDeg = 0.02, maxGapMs = 6 * 60 * 60 * 1000 } = {}) {
  const coords = dataset?.normalizedCoords || {};
  if (!coords.lat?.length || !coords.lon?.length || !coords.time?.length || !coords.timeNormalized) return [];
  const ranges = [];
  let start = null;
  let previous = null;

  const closeEnough = (a, b) => (
    Math.abs(a.lat - b.lat) <= locationToleranceDeg
    && Math.abs(a.lon - b.lon) <= locationToleranceDeg
    && b.time >= a.time
    && b.time - a.time <= maxGapMs
  );

  for (let i = 0; i < dataset.rowCount; i += 1) {
    const point = { lat: finiteAt(coords.lat, i), lon: finiteAt(coords.lon, i), time: finiteAt(coords.time, i) };
    const valid = point.lat != null && point.lon != null && point.time != null;
    if (!valid) {
      if (start != null && previous != null && previous.index >= start) ranges.push([start, previous.index]);
      start = null;
      previous = null;
      continue;
    }
    if (start == null) start = i;
    else if (!closeEnough(previous, point)) {
      ranges.push([start, previous.index]);
      start = i;
    }
    previous = { ...point, index: i };
  }
  if (start != null && previous) ranges.push([start, previous.index]);

  const meaningful = ranges.filter(([a, b]) => b - a + 1 >= 2);
  if (meaningful.length < 2) return [];
  return meaningful.map(([startRow, endRow], index) => castFromRange(`inferred-${index + 1}`, startRow, endRow, coords, {
    source: 'near-location+time-continuity',
    inferred: true,
  }));
}

export function groupDatasetCasts(dataset, options = {}) {
  if (Array.isArray(dataset?.casts) && dataset.casts.length) {
    return dataset.casts.map((cast, index) => ({ id: cast.id || `cast-${index + 1}`, source: cast.source || 'reader', ...cast }));
  }
  const explicit = groupByStation(dataset);
  if (explicit.length) return explicit;
  return inferSequentialCasts(dataset, options);
}
