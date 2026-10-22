import { fieldMissingRatio } from './model.js';
import { looksLikeTimestamp } from './timeParse.js';

const ROLE_ALIASES = Object.freeze({
  lat: ['lat', 'latitude', 'lat_n'],
  lon: ['lon', 'long', 'longitude', 'lon_e'],
  depth: ['depth', 'depth_m', 'z', 'depsm'],
  pressure: ['pressure', 'pres', 'prdm', 'dbar'],
  time: ['time', 'date', 'datetime', 'timestamp'],
  station: ['station', 'station_id', 'site', 'cast', 'stn'],
});

const WEAK_ALIASES = Object.freeze({ lat: ['y'], lon: ['x'] });

export const MAPPING_VERSION = 1;
export const COORDINATE_ROLES = Object.freeze(['lat', 'lon', 'depth', 'pressure', 'time', 'station']);

function canonicalToken(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[°º]/g, 'deg')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function boundedValues(field, limit = 1000) {
  const values = field?.values || [];
  const out = [];
  if (!values.length) return out;
  const step = Math.max(1, Math.floor(values.length / limit));
  for (let index = 0; index < values.length && out.length < limit; index += step) out.push(values[index]);
  return out;
}

function finiteStats(field, predicate = null) {
  const sample = boundedValues(field);
  let valid = 0;
  let finite = 0;
  for (const raw of sample) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    finite += 1;
    if (!predicate || predicate(value)) valid += 1;
  }
  return { finite, valid, ratio: finite ? valid / finite : 0 };
}

function parseableTimeRatio(field) {
  const sample = boundedValues(field);
  let populated = 0;
  let parsed = 0;
  for (const raw of sample) {
    if (raw == null || raw === '' || Number.isNaN(raw)) continue;
    populated += 1;
    if (raw instanceof Date && Number.isFinite(raw.getTime())) {
      parsed += 1;
      continue;
    }
    if (typeof raw === 'string' && looksLikeTimestamp(raw)) parsed += 1;
  }
  return populated ? parsed / populated : 0;
}

function numericTimeEvidence(field) {
  const sample = boundedValues(field);
  let finite = 0;
  let unixSeconds = 0;
  let unixMilliseconds = 0;
  for (const raw of sample) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    finite += 1;
    if (value >= 1e8 && value <= 5e9) unixSeconds += 1;
    if (value >= 1e11 && value <= 5e13) unixMilliseconds += 1;
  }
  const secondsRatio = finite ? unixSeconds / finite : 0;
  const millisecondsRatio = finite ? unixMilliseconds / finite : 0;
  const ratio = Math.max(secondsRatio, millisecondsRatio);
  const mode = ratio === 0 ? null : secondsRatio >= millisecondsRatio ? 'unix-seconds' : 'unix-milliseconds';
  return { finite, ratio, mode };
}

function uniqueness(field, limit = 1000) {
  const sample = boundedValues(field, limit).filter((value) => value != null && value !== '' && !Number.isNaN(value));
  const unique = new Set(sample.map((value) => String(value))).size;
  return { populated: sample.length, unique, ratio: sample.length ? unique / sample.length : 0 };
}

export function parseUnitFromField(field) {
  const explicit = String(field?.unit || '').trim();
  if (explicit) return { unit: explicit, source: 'metadata' };

  const header = String(field?.originalName || field?.normalizedName || '').trim();
  const bracket = header.match(/\[([^\]]+)\]\s*$/);
  if (bracket) return { unit: bracket[1].trim(), source: 'header-brackets' };
  const paren = header.match(/\(([^()]+)\)\s*$/);
  if (paren && paren[1].length <= 24) return { unit: paren[1].trim(), source: 'header-parentheses' };

  const token = canonicalToken(header);
  const suffixes = [
    [/(?:^|_)deg_c$/, '°C'], [/(?:^|_)degc$/, '°C'], [/(?:^|_)celsius$/, '°C'],
    [/(?:^|_)deg_f$/, '°F'], [/(?:^|_)degf$/, '°F'], [/(?:^|_)fahrenheit$/, '°F'],
    [/(?:^|_)dbar$/, 'dbar'], [/(?:^|_)psu$/, 'PSU'],
    [/(?:^|_)meters$/, 'm'], [/(?:^|_)metres$/, 'm'], [/(?:^|_)m$/, 'm'],
    [/(?:^|_)degrees_east$/, 'degrees_east'], [/(?:^|_)degrees_north$/, 'degrees_north'],
  ];
  const match = suffixes.find(([pattern]) => pattern.test(token));
  return match ? { unit: match[1], source: 'header-suffix' } : { unit: null, source: null };
}

function nameEvidence(field, role) {
  const names = [field?.normalizedName, field?.originalName].map(canonicalToken).filter(Boolean);
  const aliases = ROLE_ALIASES[role] || [];
  const weak = WEAK_ALIASES[role] || [];
  let score = 0;
  let matched = null;
  let kind = null;
  for (const name of names) {
    if (aliases.includes(name)) return { score: 0.55, matched: name, kind: 'exact' };
    const alias = aliases.find((item) => name.split('_').includes(item));
    if (alias && score < 0.42) { score = 0.42; matched = alias; kind = 'token'; }
    if (weak.includes(name) && score < 0.25) { score = 0.25; matched = name; kind = 'weak'; }
  }
  return { score, matched, kind };
}

function unitEvidence(field, role) {
  const unit = String(parseUnitFromField(field).unit || '').toLowerCase();
  if (!unit) return 0;
  if (role === 'lat' && /(degrees?_?north|deg.*n|latitude)/.test(unit)) return 0.3;
  if (role === 'lon' && /(degrees?_?east|deg.*e|longitude)/.test(unit)) return 0.3;
  if (role === 'depth' && /^(m|meter|metre|meters|metres)$/.test(unit)) return 0.08;
  if (role === 'pressure' && /(dbar|decibar|bar|pa|kpa)/.test(unit)) return 0.18;
  if (role === 'time' && /(since|utc|iso|date|time)/.test(unit)) return 0.12;
  return 0;
}

function candidateScore(field, role, rowCount) {
  const name = nameEvidence(field, role);
  const unit = unitEvidence(field, role);
  const reasons = [];
  if (name.score) reasons.push(`name:${name.matched}`);
  if (unit) reasons.push('unit');
  let validation = 0;
  let dataEvidence = 0;
  let usableOverride = false;
  let requiresConfirmation = false;

  if (role === 'lat') {
    const stats = finiteStats(field, (value) => value >= -90 && value <= 90);
    validation = stats.ratio;
    if (stats.finite >= 2 && validation >= 0.98) dataEvidence = 0.35;
    else if (stats.finite >= 2 && validation >= 0.9) dataEvidence = 0.18;
  } else if (role === 'lon') {
    const stats = finiteStats(field, (value) => value >= -180 && value <= 360);
    validation = stats.ratio;
    if (stats.finite >= 2 && validation >= 0.98) dataEvidence = 0.35;
    else if (stats.finite >= 2 && validation >= 0.9) dataEvidence = 0.18;
  } else if (role === 'depth') {
    const stats = finiteStats(field, (value) => Math.abs(value) <= 12000);
    validation = stats.ratio;
    if (stats.finite >= 2 && validation >= 0.98) dataEvidence = 0.25;
  } else if (role === 'pressure') {
    const stats = finiteStats(field, (value) => value >= -50 && value <= 15000);
    validation = stats.ratio;
    if (stats.finite >= 2 && validation >= 0.98) dataEvidence = 0.25;
  } else if (role === 'time') {
    validation = parseableTimeRatio(field);
    if (validation >= 0.9) {
      dataEvidence = 0.35;
    } else if (field?.type === 'number') {
      const numericTime = numericTimeEvidence(field);
      validation = numericTime.ratio;
      if (numericTime.finite >= 2 && validation >= 0.9) {
        dataEvidence = 0.35;
        reasons.push(`numeric-time:${numericTime.mode}`);
      } else if (numericTime.finite >= 2 && name.score >= 0.5) {
        // A strongly named numeric field may be a relative/mission time axis,
        // but without a recognized epoch magnitude it must be confirmed.
        dataEvidence = 0.12;
        usableOverride = true;
        requiresConfirmation = true;
        reasons.push('numeric-time:ambiguous');
      }
    }
  } else if (role === 'station') {
    const unique = uniqueness(field);
    validation = unique.populated ? 1 : 0;
    if (unique.populated >= 2 && unique.unique >= 1 && unique.unique <= Math.max(200, rowCount * 0.8)) dataEvidence = 0.25;
  }

  if (field?.type === 'number' && role !== 'station' && role !== 'time') dataEvidence += 0.05;
  const score = Math.min(1, name.score + unit + dataEvidence);
  const usable = usableOverride || (role === 'station' ? validation > 0 : validation >= 0.9);
  if (dataEvidence && !requiresConfirmation) reasons.push(`data:${Math.round(validation * 100)}%`);
  return { fieldKey: field.key, score, usable, semanticScore: name.score + unit, reasons, nameKind: name.kind, validation, requiresConfirmation };
}

function chooseRoleCandidate(dataset, role, usedKeys) {
  const candidates = (dataset?.fields || [])
    .filter((field) => !usedKeys.has(field.key))
    .map((field) => candidateScore(field, role, dataset?.rowCount || 0))
    .filter((candidate) => candidate.usable && candidate.semanticScore >= 0.2 && candidate.score >= 0.3)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return { fieldKey: null, confidence: 'none', score: 0, candidates: [] };
  const best = candidates[0];
  const margin = best.score - (candidates[1]?.score || 0);
  const confidence = !best.requiresConfirmation && best.score >= 0.78 && margin >= 0.12 ? 'high' : best.score >= 0.5 ? 'medium' : 'low';
  return { ...best, confidence, margin, candidates: candidates.slice(0, 4) };
}

export function classifyFields(dataset, roles = {}) {
  const coordinateKeys = new Set(Object.values(roles).filter(Boolean));
  return Object.fromEntries((dataset?.fields || []).map((field) => {
    if (coordinateKeys.has(field.key)) return [field.key, 'coordinate'];
    if (fieldMissingRatio(field, dataset?.rowCount || 0) >= 0.98) return [field.key, 'ignored'];
    const token = canonicalToken(field.normalizedName || field.originalName || '');
    const identifierName = /^(id|identifier|record_id|sample_id|observation_id|expedition_id|content_id)$/.test(token) || /_id$/.test(token);
    if (identifierName) return [field.key, 'identifier'];
    if (field.type === 'number') return [field.key, 'numeric'];
    const unique = uniqueness(field);
    if (unique.populated >= 10 && unique.ratio >= 0.85) return [field.key, 'identifier'];
    return [field.key, 'categorical'];
  }));
}

export function buildDefaultMapping(dataset, detectedRoles, classifications) {
  const fields = {};
  for (const field of dataset?.fields || []) {
    const classification = classifications[field.key];
    fields[field.key] = classification === 'ignored' || classification === 'identifier' ? 'ignore' : 'variable';
  }
  for (const fieldKey of Object.values(detectedRoles).filter(Boolean)) fields[fieldKey] = 'ignore';
  return {
    version: MAPPING_VERSION,
    roles: { lat: null, lon: null, depth: null, pressure: null, time: null, station: null, ...detectedRoles },
    fields,
  };
}

export function detectDatasetMapping(dataset) {
  const usedKeys = new Set();
  const roleDetails = {};
  const detectedRoles = {};
  const ambiguousRoles = [];

  for (const role of COORDINATE_ROLES) {
    const detail = chooseRoleCandidate(dataset, role, usedKeys);
    roleDetails[role] = detail;
    if (detail.confidence === 'high') {
      detectedRoles[role] = detail.fieldKey;
      usedKeys.add(detail.fieldKey);
    } else {
      detectedRoles[role] = null;
      if (detail.fieldKey && detail.confidence !== 'none') ambiguousRoles.push(role);
    }
  }

  const classifications = classifyFields(dataset, detectedRoles);
  const mapping = buildDefaultMapping(dataset, detectedRoles, classifications);
  const units = Object.fromEntries((dataset?.fields || []).map((field) => [field.key, parseUnitFromField(field)]));

  return {
    mapping,
    roleDetails,
    classifications,
    units,
    ambiguousRoles,
    needsMapping: ambiguousRoles.length > 0,
  };
}

export function validateMapping(dataset, mapping) {
  const validKeys = new Set((dataset?.fields || []).map((field) => field.key));
  const errors = [];
  const seen = new Map();
  for (const role of COORDINATE_ROLES) {
    const key = mapping?.roles?.[role] || null;
    if (!key) continue;
    if (!validKeys.has(key)) errors.push(`${role} refers to an unknown field.`);
    if (seen.has(key)) errors.push(`${key} is assigned to both ${seen.get(key)} and ${role}.`);
    seen.set(key, role);
  }
  for (const [key, action] of Object.entries(mapping?.fields || {})) {
    if (!validKeys.has(key)) errors.push(`Field action refers to unknown field ${key}.`);
    if (!['variable', 'ignore'].includes(action)) errors.push(`Field ${key} has an invalid action.`);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizedFieldToken(field) {
  const raw = String(field?.normalizedName || field?.originalName || '')
    .replace(/\s*\[[^\]]+\]\s*$/, '')
    .replace(/\s*\([^()]+\)\s*$/, '');
  return canonicalToken(raw);
}
