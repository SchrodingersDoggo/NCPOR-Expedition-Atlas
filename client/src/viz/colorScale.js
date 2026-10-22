// Shared colour scales for every colour-mapped scientific view (map, curtain,
// depth slice, surface layer, vector speed and the 3D products).
//
// - Sequential (magnitude): one hue, dark -> light. On the dark visualization
//   stage the low end recedes toward the surface and high values are brightest.
// - Diverging (values on both sides of zero, e.g. current components or
//   anomalies): blue and red arms around a neutral gray at zero.
// A rainbow (hue sweep) is deliberately not used: equal data steps would not
// look like equal colour steps, and it misleads colour-blind readers.
//
// Oceanographic convention (cmocean, used by NOAA/Copernicus products):
// temperature -> "thermal" (dark blue -> purple -> red -> yellow), salinity ->
// "haline" (blue -> teal -> green-yellow), chlorophyll -> "algae" (greens).
// These are close hand-tuned equivalents with lightness rising steadily from
// low to high, so equal steps still read as equal and greyscale still works.
// Absolute temperature/salinity always use their own ramp, even when values
// cross zero (e.g. -1.8 °C Antarctic water); anomalies/differences still use
// the blue/red diverging scale.

export const SEQUENTIAL_STOPS = Object.freeze([
  '#123f6e', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6', '#e3effc',
]);

export const THERMAL_STOPS = Object.freeze([
  '#26307e', '#34318f', '#63368f', '#94407f', '#c4516a', '#e76d4c', '#f79a3c', '#fbc855', '#f7f3a0',
]);
export const HALINE_STOPS = Object.freeze([
  '#26357e', '#1f4f9c', '#16699c', '#1a8290', '#2f9a7d', '#5bb068', '#98c65c', '#d6dc82',
]);
export const ALGAE_STOPS = Object.freeze([
  '#174a2b', '#1b5a31', '#1f6e38', '#2d8841', '#4ba14b', '#76b85a', '#a8ce73', '#d8e7a4',
]);

export const PALETTES = Object.freeze({
  default: SEQUENTIAL_STOPS,
  thermal: THERMAL_STOPS,
  haline: HALINE_STOPS,
  algae: ALGAE_STOPS,
});

const TEMPERATURE_UNIT = /^(°\s?c|℃|deg\.?\s?c|degc|degrees?[\s_]?c(elsius)?|degree_celsius|°\s?f|deg\s?f|k|kelvin|its-?90)$/i;
const SALINITY_UNIT = /^(psu|pss-?78|psu\s?\(pss-?78\)|g\/kg|‰|ppt|1e-3)$/i;
const NOT_A_MEASUREMENT = /\b(qc|flag|flags|quality|error|err|std|stdev|sigma)\b/i;
const DIFFERENCE = /anomal|\bdiff|difference|delta|\bbias\b|residual|change/i;

// Picks the conventional ramp for a variable, or null for the default blue.
// Accepts a dataset field ({ originalName, name, unit, description,
// standardName }) or a 3D product ({ variableName, unit }).
export function paletteForVariable(variable) {
  if (!variable) return null;
  const name = [variable.originalName, variable.variableName, variable.name, variable.standardName, variable.longName, variable.description]
    .filter(Boolean).join(' ');
  const unit = String(variable.unit || '').trim();
  if (NOT_A_MEASUREMENT.test(name) || DIFFERENCE.test(name)) return null;
  if (/temp(?!t)|\bsst\b|\btv?[0-9]{2,3}[cf]\b/i.test(name) || TEMPERATURE_UNIT.test(unit)) return 'thermal';
  if (/salin|\bpsal\b|^sal\d{0,2}\b|\bsss\b/i.test(name) || SALINITY_UNIT.test(unit)) return 'haline';
  if (/chl|chloro|fluor|\bfl(eco|sp|cp|uor)/i.test(name)) return 'algae';
  return null;
}

export const DIVERGING_NEGATIVE_STOPS = Object.freeze(['#46505a', '#2a5f9e', '#3987e5', '#9cc4f2']);
export const DIVERGING_POSITIVE_STOPS = Object.freeze(['#46505a', '#9e3f3f', '#e05a5a', '#f4a9a0']);
export const NO_DATA_COLOR = '#5f7480';

function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const n = Number.parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function interpolateStops(stops, t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = hexToRgb(stops[index]);
  const b = hexToRgb(stops[index + 1]);
  return rgbToHex(a.map((value, channel) => value + (b[channel] - value) * local));
}

function niceNumber(value, round) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const fraction = Math.abs(value) / 10 ** exponent;
  let nice;
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.sign(value) * nice * 10 ** exponent;
}

// "Nice" axis/legend ticks (1, 2, 5 × 10^n spacing) covering [min, max].
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = niceNumber((hi - lo) / Math.max(1, count - 1), true);
  if (!step) return [lo, hi];
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let value = start; value <= hi + step * 1e-9 && ticks.length < 50; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

function finiteValues(values) {
  const out = [];
  for (const raw of values || []) {
    const value = Number(raw);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

// Robust range: the 2nd–98th percentile keeps a single spike from washing out
// the whole field. Falls back to min/max for small samples.
export function valueDomain(values, { robust = true } = {}) {
  const finite = finiteValues(values);
  if (!finite.length) return null;
  finite.sort((a, b) => a - b);
  let min = finite[0];
  let max = finite[finite.length - 1];
  if (robust && finite.length >= 50) {
    const lo = finite[Math.floor(finite.length * 0.02)];
    const hi = finite[Math.ceil(finite.length * 0.98) - 1];
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) { min = lo; max = hi; }
  }
  return { min, max, dataMin: finite[0], dataMax: finite[finite.length - 1], clipped: min > finite[0] || max < finite[finite.length - 1] };
}

// Build a colour scale for a set of values. Diverging is chosen only when the
// data genuinely straddles zero (both sides hold a meaningful share of the
// range); otherwise the sequential ramp is used.
export function createColorScale(values, { mode = 'auto', robust = true, palette = null } = {}) {
  const domain = valueDomain(values, { robust });
  if (!domain) {
    return { kind: 'empty', palette: null, min: null, max: null, color: () => NO_DATA_COLOR, gradient: [NO_DATA_COLOR, NO_DATA_COLOR], ticks: [] };
  }
  const { min, max } = domain;
  const named = palette && palette !== 'default' && PALETTES[palette] ? palette : null;
  const straddles = min < 0 && max > 0 && Math.min(-min, max) / Math.max(-min, max) >= 0.15;
  const kind = mode === 'auto' ? (named ? 'sequential' : straddles ? 'diverging' : 'sequential') : mode;

  if (kind === 'diverging') {
    const bound = Math.max(Math.abs(min), Math.abs(max)) || 1;
    const color = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return NO_DATA_COLOR;
      const t = Math.max(-1, Math.min(1, n / bound));
      return t < 0 ? interpolateStops(DIVERGING_NEGATIVE_STOPS, -t) : interpolateStops(DIVERGING_POSITIVE_STOPS, t);
    };
    const gradient = [...[...DIVERGING_NEGATIVE_STOPS].reverse(), ...DIVERGING_POSITIVE_STOPS.slice(1)];
    return { kind, palette: 'diverging', min: -bound, max: bound, dataMin: domain.dataMin, dataMax: domain.dataMax, clipped: domain.clipped, color, gradient, ticks: niceTicks(-bound, bound, 7) };
  }

  const stops = PALETTES[named || 'default'];
  const span = max - min;
  const color = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return NO_DATA_COLOR;
    return interpolateStops(stops, span > 0 ? (n - min) / span : 0.5);
  };
  return { kind: 'sequential', palette: named || 'default', min, max, dataMin: domain.dataMin, dataMax: domain.dataMax, clipped: domain.clipped, color, gradient: [...stops], ticks: niceTicks(min, max, 7) };
}

// Scale from a known [min, max] range (e.g. a cached 3D product).
export function createColorScaleFromRange(min, max, options = {}) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return createColorScale([], options);
  return createColorScale(lo === hi ? [lo] : [lo, hi], { ...options, robust: false });
}

// A representative mid-scale colour for legend key swatches.
export function scaleSwatchColor(scale) {
  const stops = scale?.gradient || SEQUENTIAL_STOPS;
  return stops[Math.floor((stops.length - 1) / 2)] || SEQUENTIAL_STOPS[3];
}

// For three.js: returns [r, g, b] in 0..1.
export function colorToUnitRgb(hex) {
  return hexToRgb(hex).map((value) => value / 255);
}

export function formatScaleValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) >= 1e5 || Math.abs(n) < 1e-3) return n.toExponential(2);
  return Number(n.toPrecision(4)).toString();
}
