// Timezone-safe timestamp parsing for scientific datasets.
//
// Why not Date.parse? For offset-less date-times such as
// "2026-03-01T06:00:00" or "2026-03-01 06:00:00", Date.parse uses the
// *viewer's* local time zone, so the same file shows different times on
// different machines. It also reads "03/04/2024" as 4 March (US order)
// without any warning.
//
// Rules applied here:
// - An explicit zone (Z, UTC, GMT, +05:30, -0300) is always honoured.
// - A date-time without a zone is interpreted as UTC, and the caller is told
//   (`assumedUtc`) so a scientific warning can be shown. Oceanographic
//   instruments and CF/NetCDF conventions use UTC by default.
// - Slash/dot dates (03/04/2024) are day/month ambiguous. They are only
//   parsed when the order is known: either passed in by the caller (decided
//   from the whole column) or forced by a day value above 12.

const MONTHS = Object.freeze({
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
});

const ZONE = String.raw`(Z|UTC|GMT|[+-]\d{1,2}(?::?\d{2})?|(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?)`;
const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?`;
const CF_TIME = String.raw`(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,9}))?)?`;

const ISO_RE = new RegExp(String.raw`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:(?:[T\s]+)${TIME})?\s*${ZONE}?$`, 'i');
// CF/NetCDF "units since <origin>" may use unpadded or short years ("1-1-1").
const CF_ISO_RE = new RegExp(String.raw`^([+-]?\d{1,6})-(\d{1,2})-(\d{1,2})(?:(?:[T\s]+)${CF_TIME})?\s*${ZONE}?$`, 'i');
const BASIC_ISO_RE = new RegExp(String.raw`^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:(\d{2})(?:[.,](\d{1,9}))?)?)?\s*${ZONE}?$`, 'i');
const SLASH_RE = new RegExp(String.raw`^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:(?:[T\s,]+)${TIME})?\s*${ZONE}?$`, 'i');
const MONTH_FIRST_RE = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:(?:[T\s,]+)${TIME})?\s*${ZONE}?$`, 'i');
const DAY_FIRST_RE = new RegExp(String.raw`^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s-]+(\d{4})(?:(?:[T\s,]+)${TIME})?\s*${ZONE}?$`, 'i');
const EXPLICIT_ZONE_RE = /(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})\s*$/i;

function monthIndex(name) {
  const key = String(name || '').slice(0, 4).toLowerCase();
  if (key in MONTHS) return MONTHS[key];
  const short = key.slice(0, 3);
  return short in MONTHS ? MONTHS[short] : null;
}

function daysInMonth(year, month) {
  const d = new Date(0);
  d.setUTCFullYear(year, month + 1, 0);
  return d.getUTCDate();
}

// Date.UTC maps years 0–99 onto 1900–1999, which would corrupt CF origins such
// as "days since 1-1-1". setUTCFullYear keeps the literal year.
function utcMilliseconds(year, month, day, hour = 0, minute = 0, second = 0, fraction = '') {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  d.setUTCHours(hour, minute, second, 0);
  const ms = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
  return d.getTime() + ms;
}

function zoneOffsetMinutes(zone) {
  if (!zone) return null;
  const text = String(zone).trim().toUpperCase();
  if (text === 'Z' || text === 'UTC' || text === 'GMT') return 0;
  const match = text.replace(/^(?:UTC|GMT)\s*/, '').match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  if (minutes > 18 * 60) return null;
  return (match[1] === '-' ? -1 : 1) * minutes;
}

function build({ year, month, day, hour, minute, second, fraction, zone, format }) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour || 0);
  const mi = Number(minute || 0);
  const s = Number(second || 0);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo)) return null;
  if (h > 24 || mi > 59 || s > 60 || (h === 24 && (mi || s))) return null;
  const hasTime = hour != null && hour !== '';
  const offset = zoneOffsetMinutes(zone);
  if (zone && offset == null) return null;
  const base = utcMilliseconds(y, mo, d, h, mi, s, fraction || '');
  const ms = offset == null ? base : base - offset * 60000;
  return {
    ms,
    format,
    // Date-only values are calendar dates; treating them as 00:00 UTC is the
    // ISO-8601 convention and needs no warning.
    assumedUtc: offset == null && hasTime,
  };
}

// Returns null when the text is not a recognised timestamp. For a day/month
// ambiguous slash date without a known order, returns
// { ms: null, ambiguousOrder: true }.
export function parseTimestamp(raw, { order = null, cf = false } = {}) {
  if (raw == null) return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? { ms, format: 'date-object', assumedUtc: false } : null;
  }
  const text = String(raw).trim().replace(/\s*\[[^\]]*\]\s*$/, '');
  if (!text) return null;

  let m = text.match(cf ? CF_ISO_RE : ISO_RE) || (cf ? text.match(ISO_RE) : null);
  if (m) {
    return build({ year: m[1], month: Number(m[2]) - 1, day: m[3], hour: m[4], minute: m[5], second: m[6], fraction: m[7], zone: m[8], format: 'iso' });
  }

  m = text.match(BASIC_ISO_RE);
  if (m) {
    return build({ year: m[1], month: Number(m[2]) - 1, day: m[3], hour: m[4], minute: m[5], second: m[6], fraction: m[7], zone: m[8], format: 'iso-basic' });
  }

  m = text.match(SLASH_RE);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let resolved = order;
    if (a > 12 && b <= 12) resolved = 'dmy';
    else if (b > 12 && a <= 12) resolved = 'mdy';
    else if (a > 12 && b > 12) return null;
    if (resolved !== 'dmy' && resolved !== 'mdy') {
      return { ms: null, ambiguousOrder: true, format: 'slash' };
    }
    const day = resolved === 'dmy' ? a : b;
    const month = resolved === 'dmy' ? b : a;
    const result = build({ year: m[3], month: month - 1, day, hour: m[4], minute: m[5], second: m[6], fraction: m[7], zone: m[8], format: `slash-${resolved}` });
    return result ? { ...result, order: resolved } : null;
  }

  m = text.match(MONTH_FIRST_RE);
  if (m && monthIndex(m[1]) != null) {
    return build({ year: m[3], month: monthIndex(m[1]), day: m[2], hour: m[4], minute: m[5], second: m[6], fraction: m[7], zone: m[8], format: 'month-name' });
  }

  m = text.match(DAY_FIRST_RE);
  if (m && monthIndex(m[2]) != null) {
    return build({ year: m[3], month: monthIndex(m[2]), day: m[1], hour: m[4], minute: m[5], second: m[6], fraction: m[7], zone: m[8], format: 'month-name' });
  }

  // Anything else is only accepted when it carries an explicit zone, so the
  // viewer's local time zone can never leak into the result.
  if (EXPLICIT_ZONE_RE.test(text)) {
    const ms = Date.parse(text);
    if (Number.isFinite(ms)) return { ms, format: 'explicit-zone', assumedUtc: false };
  }
  return null;
}

// True when the value is recognisably a timestamp, including day/month
// ambiguous slash dates whose order is decided later for the whole column.
export function looksLikeTimestamp(raw) {
  const result = parseTimestamp(raw);
  return Boolean(result && (Number.isFinite(result.ms) || result.ambiguousOrder));
}

// Decide the day/month order for a whole column of slash dates.
export function slashDateOrder(values, { sampleLimit = 50000 } = {}) {
  let dmy = 0;
  let mdy = 0;
  let ambiguous = 0;
  let seen = 0;
  for (let i = 0; i < values.length && seen < sampleLimit; i += 1) {
    const raw = values[i];
    if (raw == null || raw instanceof Date) continue;
    const text = String(raw).trim();
    const m = text.match(SLASH_RE);
    if (!m) continue;
    seen += 1;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy += 1;
    else if (b > 12 && a <= 12) mdy += 1;
    else if (a <= 12 && b <= 12) ambiguous += 1;
  }
  if (!seen) return { order: null, state: 'none', dmy, mdy, ambiguous };
  if (dmy && mdy) return { order: null, state: 'conflict', dmy, mdy, ambiguous };
  if (dmy) return { order: 'dmy', state: 'resolved', dmy, mdy, ambiguous };
  if (mdy) return { order: 'mdy', state: 'resolved', dmy, mdy, ambiguous };
  return { order: null, state: 'ambiguous', dmy, mdy, ambiguous };
}
