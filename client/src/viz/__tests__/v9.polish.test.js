import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DB_VERSION } from '../../offline/constants.js';
import { canonicalFromColumns, canonicalFromRows } from '../model.js';
import { detectDatasetMapping } from '../detection.js';
import { normalizeScientificDataset } from '../scientificNormalize.js';
import { groupDatasetCasts } from '../casts.js';
import { evaluateCapabilities } from '../capabilities.js';
import { parseTimestamp, slashDateOrder } from '../timeParse.js';
import { castTime } from '../v4Spatial.js';
import { parseCfTimeUnits } from '../readers/netcdf.js';
import { readCnv } from '../readers/cnv.js';
import { profileSeries } from '../profileSeries.js';
import { buildMapModel } from '../mapModel.js';
import { createColorScale, niceTicks, SEQUENTIAL_STOPS } from '../colorScale.js';
import { variableName } from '../ui/labels.js';
import { datasetStatusModel } from '../ui/workbenchModel.js';

function prepare(headers, rows) {
  const dataset = canonicalFromRows(headers, rows, { contentId: 'c1', fileName: 'test.csv', datasetFingerprint: 'sha256:test' });
  const detection = detectDatasetMapping(dataset);
  const normalized = normalizeScientificDataset(dataset, detection.mapping, detection);
  normalized.casts = groupDatasetCasts(normalized);
  normalized.capabilities = evaluateCapabilities(normalized);
  return normalized;
}

function ctdRows(stations = 5) {
  const rows = [];
  for (let s = 0; s < stations; s += 1) {
    for (let d = 0; d <= 200; d += 10) rows.push([`CTD-0${s + 1}`, 15 + s * 0.8, 87 + s * 0.6, d, 29 - d * 0.03 - s * 0.5, `2026-03-0${s + 1}T06:00:00`]);
  }
  return rows;
}
const CTD_HEADERS = ['Station', 'Latitude', 'Longitude', 'Depth (m)', 'Temperature (°C)', 'Date'];

// ---------------------------------------------------------------- time
test('V9 offset-less timestamps are UTC regardless of the viewer time zone', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Kolkata';
    assert.equal(new Date(parseTimestamp('2026-03-01T06:00:00').ms).toISOString(), '2026-03-01T06:00:00.000Z');
    assert.equal(parseTimestamp('2026-03-01 06:00:00').assumedUtc, true);
    assert.equal(new Date(parseTimestamp('2026-03-01T06:00:00+05:30').ms).toISOString(), '2026-03-01T00:30:00.000Z');
    assert.equal(parseTimestamp('2026-03-01T06:00:00Z').assumedUtc, false);
    assert.equal(new Date(parseTimestamp('2026-03-01').ms).toISOString(), '2026-03-01T00:00:00.000Z');
  } finally {
    process.env.TZ = original;
  }
});

test('V9 slash dates are never silently read in US order', () => {
  assert.equal(parseTimestamp('03/04/2024').ambiguousOrder, true);
  assert.equal(new Date(parseTimestamp('25/03/2024').ms).toISOString().slice(0, 10), '2024-03-25');
  assert.equal(new Date(parseTimestamp('03/04/2024', { order: 'dmy' }).ms).toISOString().slice(0, 10), '2024-04-03');
  assert.equal(slashDateOrder(['03/04/2024', '25/03/2024']).order, 'dmy');
  assert.equal(slashDateOrder(['03/04/2024', '04/05/2024']).state, 'ambiguous');
  assert.equal(slashDateOrder(['13/01/2024', '01/13/2024']).state, 'conflict');
  assert.equal(parseTimestamp('2026-02-30'), null);
});

test('V9 time normalization resolves slash order per column and warns about UTC', () => {
  const rows = [['03/04/2024 10:00', 1], ['25/03/2024 11:00', 2], ['26/03/2024 12:00', 3]];
  const dataset = prepare(['Date', 'Temperature (°C)'], rows);
  assert.equal(dataset.normalizedCoords.timeNormalized, true);
  assert.equal(new Date(dataset.normalizedCoords.time[0]).toISOString(), '2024-04-03T10:00:00.000Z');
  assert.ok(dataset.warnings.some((warning) => /day\/month\/year/.test(warning)));
  assert.ok(dataset.warnings.some((warning) => /interpreted as UTC/.test(warning)));
});

test('V9 ambiguous slash-date columns are not normalized into a time axis', () => {
  const rows = [['03/04/2024', 1], ['04/05/2024', 2], ['05/06/2024', 3]];
  const dataset = prepare(['Date', 'Temperature (°C)'], rows);
  assert.equal(dataset.capabilities.timeSeries.enabled, false);
  assert.ok(dataset.warnings.some((warning) => /ambiguous/.test(warning)));
});

test('V9 CNV start times with Sea-Bird annotations and CF origins are UTC', () => {
  assert.equal(new Date(castTime({ startTime: "Mar 01 2026 06:00:00 [Instrument's time stamp, header]" })).toISOString(), '2026-03-01T06:00:00.000Z');
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(parseCfTimeUnits('seconds since 1970-01-01 00:00:00').origin, 0);
    assert.equal(parseCfTimeUnits('days since 1970-1-1 0:0:0').origin, 0);
    assert.equal(new Date(parseCfTimeUnits('days since 1-1-1').origin).getUTCFullYear(), 1);
  } finally {
    process.env.TZ = original;
  }
});

// ---------------------------------------------------------------- profiles
test('V9 vertical profiles keep one line per cast', () => {
  const dataset = prepare(CTD_HEADERS, ctdRows(5));
  const temperature = dataset.fields.find((field) => /Temperature/.test(field.originalName));
  const result = profileSeries(dataset, dataset.normalizedCoords.depth, temperature.values);
  assert.equal(result.series.length, 5);
  for (const series of result.series) {
    const depths = series.points.map((point) => point.x);
    assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'each cast is ordered by depth');
    assert.equal(new Set(depths).size, depths.length, 'a cast never repeats a depth from another station');
  }
  assert.deepEqual(result.series.map((series) => series.label), ['CTD-01', 'CTD-02', 'CTD-03', 'CTD-04', 'CTD-05']);
});

// ---------------------------------------------------------------- map
test('V9 map is fitted to the data extent and uses near-surface values', () => {
  const dataset = prepare(CTD_HEADERS, ctdRows(5));
  const temperature = dataset.fields.find((field) => /Temperature/.test(field.originalName));
  const model = buildMapModel(dataset, temperature.key);
  assert.equal(model.mode, 'casts');
  assert.equal(model.points.length, 5, 'five stations stay five points (no global 5° cells)');
  assert.deepEqual(model.points.map((point) => point.value), [29, 28.5, 28, 27.5, 27], 'colour uses the shallowest value of each cast');
  assert.ok(model.latTicks.length >= 2 && model.lonTicks.length >= 2);
});

test('V9 map aggregation stays local and dateline-safe', () => {
  const rows = [];
  for (let i = 0; i < 6000; i += 1) {
    const lon = 179.5 + i * 0.0002;
    rows.push([-45 + i * 0.00005, lon > 180 ? lon - 360 : lon, 10 + Math.sin(i / 500)]);
  }
  const dataset = prepare(['lat', 'lon', 'SST (°C)'], rows);
  const model = buildMapModel(dataset, dataset.fields[2].key);
  assert.equal(model.aggregated, true);
  assert.ok(model.points.length > 20, 'a track spanning ~1° is not collapsed into one cell');
  const labels = model.lonTicks.map((tick) => tick.label);
  assert.ok(labels.includes('180°'), `ticks cross the antimeridian: ${labels.join(', ')}`);
});

// ---------------------------------------------------------------- CNV
test('V9 CNV reader normalizes Sea-Bird units and keeps the station name', async () => {
  const text = `* NMEA Latitude = 15 17.82 N\n* NMEA Longitude = 087 51.60 E\n** Station: CTD-07\n# name 0 = prDM: Pressure, Digiquartz [db]\n# name 1 = depSM: Depth [salt water, m]\n# name 2 = t090C: Temperature [ITS-90, deg C]\n# name 3 = sal00: Salinity, Practical [PSU]\n# start_time = Mar 01 2026 06:00:00 [Instrument's time stamp, header]\n# bad_flag = -9.990e-29\n*END*\n0 0 28.1 33.1\n1 0.99 -9.990e-29 33.2\n2 1.98 27.9 33.3\n`;
  const dataset = await readCnv(text, { fileName: 'stn07.cnv' });
  assert.deepEqual(dataset.fields.map((field) => field.unit), ['dbar', 'm', '°C', 'PSU']);
  assert.equal(dataset.fields[2].description, 'Temperature [ITS-90, deg C]');
  assert.equal(dataset.casts[0].station, 'CTD-07');
  assert.equal(dataset.casts[0].startTime, 'Mar 01 2026 06:00:00');
  assert.ok(Number.isNaN(dataset.fields[2].values[1]), 'bad_flag still becomes missing');
  assert.equal(dataset.rowCount, 3);
});

test('V9 column-oriented canonical model matches the row-oriented one', () => {
  const headers = ['a', 'b'];
  const rows = [['1', '-999'], ['2.5', '3'], ['', '4']];
  const fromRows = canonicalFromRows(headers, rows, { fileName: 'x.csv' });
  const fromColumns = canonicalFromColumns(headers, [Float64Array.from([1, 2.5, Number.NaN]), Float64Array.from([-999, 3, 4])], { fileName: 'x.csv', rowCount: 3 });
  const simplify = (dataset) => dataset.fields.map((field) => ({ type: field.type, values: Array.from(field.values).map((v) => (Number.isNaN(v) ? 'NaN' : v)), count: field.statistics.count, mean: field.statistics.mean }));
  assert.deepEqual(simplify(fromColumns), simplify(fromRows));
});

// ---------------------------------------------------------------- colour & labels
test('V9 colour scales are single-hue sequential or blue/red diverging, never a rainbow', () => {
  const sequential = createColorScale([1, 2, 3, 4, 5]);
  assert.equal(sequential.kind, 'sequential');
  assert.equal(sequential.color(1), SEQUENTIAL_STOPS[0]);
  assert.equal(sequential.color(5), SEQUENTIAL_STOPS.at(-1));
  assert.equal(createColorScale([-0.8, -0.2, 0.3, 0.9]).kind, 'diverging');
  assert.equal(createColorScale([-0.01, 5, 9]).kind, 'sequential', 'a tiny negative excursion does not flip to diverging');
  assert.deepEqual(niceTicks(15.78, 27.48, 6), [16, 18, 20, 22, 24, 26]);
});

test('V9 variable labels do not repeat the unit', () => {
  assert.equal(variableName({ originalName: 'Temperature (°C)', unit: '°C' }), 'Temperature');
  assert.equal(variableName({ originalName: 'Depth [m]', unit: 'm' }), 'Depth');
  assert.equal(variableName({ originalName: 't090C', unit: '°C' }), 't090C');
  assert.equal(variableName({ originalName: 'Oxygen', unit: null }), 'Oxygen');
});

test('V9 dataset status labels cover the new states', () => {
  assert.equal(datasetStatusModel({ selected: true, status: 'local-too-large' }).label, 'Large file · confirm');
  assert.equal(datasetStatusModel({ selected: true, status: 'mapping' }).label, 'Needs mapping');
});

// ---------------------------------------------------------------- offline / low-bandwidth safeguards (source level)
test('V9 service worker caches worker scripts and hashed build assets for offline use', async () => {
  const sw = await readFile(new URL('../../../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.match(sw, /request\.destination === 'worker'/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/, 'API requests are still never cached');
});

test('V9 IndexedDB open handles blocked and blocking upgrades', async () => {
  const db = await readFile(new URL('../../offline/db.js', import.meta.url), 'utf8');
  assert.match(db, /blocked\(\)/);
  assert.match(db, /blocking\(\)/);
  assert.match(db, /upgradeOfflineDatabase\(db\)/);
});

test('V9 whole-file fingerprints are skipped for files too large to visualize', async () => {
  const upload = await readFile(new URL('../../api/datasetUpload.js', import.meta.url), 'utf8');
  assert.match(upload, /MAX_WHOLE_FILE_FINGERPRINT_BYTES = 100 \* 1024 \* 1024/);
  assert.match(upload, /Number\(file\.size\) > MAX_WHOLE_FILE_FINGERPRINT_BYTES\) return null/);
});

test('V9 saved offline copies respect browser limits before parsing, with an explicit override', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  const gate = page.indexOf("setStatus('local-too-large')");
  const parse = page.indexOf('parseSource(offlineDataset.offlineFile.blob');
  assert.ok(gate > 0 && gate < parse, 'the size gate runs before the offline parse');
  assert.match(page, /allowOversizeLocal: true/);
  const viewport = await readFile(new URL('../ui/VisualizationViewport.jsx', import.meta.url), 'utf8');
  assert.match(viewport, /Try anyway/);
});

test('V9 offline warm-up never runs in low-bandwidth mode and is non-blocking', async () => {
  const warmup = await readFile(new URL('../offlineWarmup.js', import.meta.url), 'utf8');
  assert.match(warmup, /NETWORK_MODES\.LOW_BANDWIDTH/);
  assert.match(warmup, /saveData/);
  const saved = await readFile(new URL('../../offline/savedExpeditions.js', import.meta.url), 'utf8');
  assert.match(saved, /void import\('\.\.\/viz\/offlineWarmup\.js'\)/);
  const { warmVisualizerForOffline } = await import('../offlineWarmup.js');
  const result = await warmVisualizerForOffline({ data: [] });
  assert.ok(result.skipped, 'outside a browser it skips instead of throwing');
});

test('V9 low-bandwidth preview policy is unchanged', async () => {
  const page = await readFile(new URL('../../pages/VizPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /if\s*\(!forceFull\s*&&\s*\(network\.isSlow\s*\|\|\s*!fullAllowed\)\)/);
  assert.match(page, /readBlobWithProgress\(response/);
});

test('V9 DB_VERSION remains 6', () => assert.equal(DB_VERSION, 6));

test('V9 conventional oceanographic colour scales per variable', async () => {
  const { paletteForVariable, THERMAL_STOPS, HALINE_STOPS } = await import('../colorScale.js');
  assert.equal(paletteForVariable({ originalName: 'Temperature (°C)', unit: '°C' }), 'thermal');
  assert.equal(paletteForVariable({ originalName: 't090C', unit: '°C' }), 'thermal');
  assert.equal(paletteForVariable({ variableName: 'sea_water_temperature', unit: 'K' }), 'thermal');
  assert.equal(paletteForVariable({ originalName: 'sal00', unit: 'PSU' }), 'haline');
  assert.equal(paletteForVariable({ originalName: 'flECO-AFL', unit: 'mg/m^3' }), 'algae');
  assert.equal(paletteForVariable({ originalName: 'Temperature anomaly', unit: '°C' }), null, 'anomalies keep the diverging scale');
  assert.equal(paletteForVariable({ originalName: 'Temperature QC flag' }), null);
  assert.equal(paletteForVariable({ originalName: 'Attempt' }), null);
  assert.equal(paletteForVariable({ originalName: 'Oxygen', unit: 'ml/l' }), null);
  const antarctic = createColorScale([-1.8, -1, 0, 1, 2], { palette: 'thermal' });
  assert.equal(antarctic.kind, 'sequential', 'absolute temperature below 0 °C still uses the thermal ramp');
  assert.equal(antarctic.color(-1.8), THERMAL_STOPS[0]);
  assert.equal(antarctic.color(2), THERMAL_STOPS.at(-1));
  assert.equal(createColorScale([30, 34, 36], { palette: 'haline' }).color(36), HALINE_STOPS.at(-1));
  assert.equal(createColorScale([-0.8, 0.9]).kind, 'diverging');
});
