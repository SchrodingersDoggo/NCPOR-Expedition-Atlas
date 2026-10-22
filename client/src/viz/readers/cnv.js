import { readerContext, sourceToText } from './shared.js';
import { canonicalFromColumns } from '../model.js';

function parseCoordinateValue(raw, axis) {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/,/g, ' ');
  const hemisphere = (text.match(/([NSEW])\s*$/i) || text.match(/(?:^|[\s,])([NSEW])(?=$|[\s,])/i))?.[1]?.toUpperCase() || null;
  const numbers = text.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!numbers.length) return null;

  let value;
  if (numbers.length >= 3 && Math.abs(numbers[0]) <= (axis === 'lat' ? 90 : 180)) {
    value = Math.abs(numbers[0]) + numbers[1] / 60 + numbers[2] / 3600;
    if (numbers[0] < 0) value *= -1;
  } else if (numbers.length >= 2 && Math.abs(numbers[0]) <= (axis === 'lat' ? 90 : 180)) {
    value = Math.abs(numbers[0]) + numbers[1] / 60;
    if (numbers[0] < 0) value *= -1;
  } else {
    value = numbers[0];
  }

  if (hemisphere === 'S' || hemisphere === 'W') value = -Math.abs(value);
  if (hemisphere === 'N' || hemisphere === 'E') value = Math.abs(value);
  const max = axis === 'lat' ? 90 : 180;
  return Number.isFinite(value) && Math.abs(value) <= max ? value : null;
}

// Sea-Bird writes qualifiers before the unit inside the brackets, e.g.
// "Temperature [ITS-90, deg C]" or "Depth [salt water, m]". Keep only the
// physical unit (the qualifier stays in the field description) and map the
// common Sea-Bird spellings onto the units the rest of the pipeline knows,
// so depth is recognised as metres and casts can be merged with CSV data.
const CNV_UNIT_ALIASES = new Map([
  ['deg c', '°C'], ['degc', '°C'], ['deg_c', '°C'], ['°c', '°C'], ['c', '°C'],
  ['deg f', '°F'], ['degf', '°F'],
  ['db', 'dbar'], ['dbar', 'dbar'], ['decibar', 'dbar'],
  ['m', 'm'], ['meters', 'm'], ['metres', 'm'],
  ['psu', 'PSU'], ['pss-78', 'PSU'],
]);

function unitFromDescription(description = '') {
  const matches = [...String(description).matchAll(/\[([^\]]+)\]/g)];
  if (!matches.length) return null;
  const raw = matches.at(-1)[1].trim();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const candidate = parts.length > 1 ? parts.at(-1) : raw;
  return CNV_UNIT_ALIASES.get(candidate.toLowerCase()) || candidate;
}

function parseNameLine(line) {
  const match = line.match(/^#\s*name\s+(\d+)\s*=\s*([^:]+?)(?:\s*:\s*(.*))?$/i);
  if (!match) return null;
  const index = Number(match[1]);
  const name = match[2].trim();
  const description = (match[3] || '').trim();
  return { index, name, description, unit: unitFromDescription(description) };
}

function assignCoordinate(meta, line) {
  const latMatch = line.match(/(?:NMEA\s+)?Latitude\s*=\s*(.+)$/i) || line.match(/^#\s*latitude\s*=\s*(.+)$/i);
  if (latMatch) {
    const value = parseCoordinateValue(latMatch[1], 'lat');
    if (value != null) meta.latitude = value;
    return;
  }
  const lonMatch = line.match(/(?:NMEA\s+)?Longitude\s*=\s*(.+)$/i) || line.match(/^#\s*longitude\s*=\s*(.+)$/i);
  if (lonMatch) {
    const value = parseCoordinateValue(lonMatch[1], 'lon');
    if (value != null) meta.longitude = value;
  }
}

// Iterate the lines of a large string without materialising an array of
// every line (a 100 MiB CNV holds millions of lines).
function* iterateLines(text, from = 0) {
  let position = from;
  let lineNumber = 0;
  while (position <= text.length) {
    let next = text.indexOf('\n', position);
    if (next < 0) next = text.length;
    let line = text.slice(position, next);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    lineNumber += 1;
    yield { line, lineNumber, nextPosition: next + 1 };
    if (next >= text.length) return;
    position = next + 1;
  }
}

const MAX_ROW_WARNINGS = 20;

export async function readCnv(source, options = {}) {
  const context = readerContext(options);
  const text = (await sourceToText(source)).replace(/^﻿/, '');

  // Header: everything before the *END* line.
  const headerLines = [];
  let dataStart = -1;
  let headerLineCount = 0;
  for (const { line, lineNumber, nextPosition } of iterateLines(text)) {
    if (/^\s*\*END\*\s*$/i.test(line)) {
      dataStart = nextPosition;
      headerLineCount = lineNumber;
      break;
    }
    headerLines.push(line);
  }
  if (dataStart < 0) throw new Error('Malformed CNV dataset: *END* header terminator was not found.');
  const endIndex = headerLineCount - 1;

  const columnMap = new Map();
  const meta = { latitude: null, longitude: null, startTime: null, badFlag: null, station: null };
  const warnings = [];

  for (const rawLine of headerLines) {
    const line = rawLine.trim();
    const definition = parseNameLine(line);
    if (definition) columnMap.set(definition.index, definition);
    const bad = line.match(/^#\s*bad_flag\s*=\s*([^\s]+)/i);
    if (bad && Number.isFinite(Number(bad[1]))) meta.badFlag = Number(bad[1]);
    const start = line.match(/^#\s*start_time\s*=\s*(.+)$/i);
    // Sea-Bird appends notes such as "[Instrument's time stamp, header]".
    if (start) meta.startTime = start[1].replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    // User header lines ("** Station: CTD-07") name the cast.
    const station = line.match(/^\*\*\s*(?:station(?:\s*(?:name|id|no\.?|number))?|stn|cast)\s*[:=]\s*(.+)$/i);
    if (station && !meta.station && station[1].trim()) meta.station = station[1].trim();
    assignCoordinate(meta, line);
  }

  if (!columnMap.size) throw new Error('CNV dataset does not contain any "# name N = ..." variable definitions.');
  const definitions = [...columnMap.values()].sort((a, b) => a.index - b.index);
  const maxIndex = definitions.at(-1).index;
  const headers = Array.from({ length: maxIndex + 1 }, (_, index) => columnMap.get(index)?.name || `column_${index + 1}`);
  const fieldMeta = headers.map((header, index) => {
    const definition = columnMap.get(index);
    return definition ? { originalName: definition.name, normalizedName: definition.name, unit: definition.unit, description: definition.description } : { originalName: header };
  });
  const width = headers.length;

  const isDataLine = (line) => {
    const trimmed = line.trim();
    return Boolean(trimmed) && !/^[*#]/.test(trimmed);
  };
  const tokenCount = (line) => {
    const trimmed = line.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  };

  // Pass 1: count complete measurement rows so each column can be one
  // pre-sized Float64Array (instead of an array of string arrays).
  let rowCount = 0;
  for (const { line } of iterateLines(text, dataStart)) {

    if (isDataLine(line) && tokenCount(line) >= width) rowCount += 1;
  }
  if (!rowCount) throw new Error('CNV dataset contains no measurements after *END*.');

  // Pass 2: decode numbers directly into the columns.
  const columns = Array.from({ length: width }, () => new Float64Array(rowCount));
  let row = 0;
  let shortRows = 0;
  for (const { line, lineNumber } of iterateLines(text, dataStart)) {
    if (!isDataLine(line)) continue;
    if (row % 5000 === 0 && context.isCancelled()) throw new DOMException('Visualization parsing cancelled.', 'AbortError');
    const values = line.trim().split(/\s+/);
    if (values.length < width) {
      shortRows += 1;
      if (shortRows <= MAX_ROW_WARNINGS) warnings.push(`Skipped short measurement row at line ${headerLineCount + lineNumber}.`);
      continue;
    }
    for (let col = 0; col < width; col += 1) {
      const n = Number(values[col]);
      columns[col][row] = Number.isFinite(n) ? n : Number.NaN;
    }
    row += 1;
    if (context.onProgress && row % 5000 === 0) {
      context.onProgress({ stage: 'parse', loaded: row, total: rowCount, percent: Math.round((row / rowCount) * 90) });
    }
  }
  if (shortRows > MAX_ROW_WARNINGS) {
    warnings.push(`Skipped ${shortRows.toLocaleString()} short measurement rows in total (first ${MAX_ROW_WARNINGS} listed).`);
  }

  const cast = {
    id: 'cast-1',
    rowStart: 0,
    rowEnd: rowCount - 1,
    latitude: meta.latitude,
    longitude: meta.longitude,
    startTime: meta.startTime,
    ...(meta.station ? { station: meta.station } : {}),
  };
  if (meta.latitude == null || meta.longitude == null) warnings.push('CNV cast coordinates were not fully available in the header.');

  const canonical = canonicalFromColumns(headers, columns, {
    ...context,
    fieldMeta,
    badFlag: meta.badFlag,
    warnings,
    casts: [cast],
    provenance: [{ step: 'reader', format: 'cnv', convention: 'Sea-Bird', headerEndLine: endIndex + 1 }],
    sourceMeta: { cnv: { ...meta, variableDefinitions: definitions } },
    rowCount,
  });
  context.onProgress?.({ stage: 'complete', loaded: rowCount, total: rowCount, percent: 100 });
  return canonical;
}

export { parseCoordinateValue };
