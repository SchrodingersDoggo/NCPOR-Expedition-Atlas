import { canonicalPreviewRows } from './model.js';
import { detectDatasetMapping, validateMapping } from './detection.js';
import { normalizeScientificDataset } from './scientificNormalize.js';
import { groupDatasetCasts } from './casts.js';
import { evaluateCapabilities } from './capabilities.js';
import { loadVizMapping, saveVizMapping } from './storage.js';

export async function prepareScientificDataset(dataset, {
  ownerId = null,
  mapping = null,
  loadSavedMapping = true,
  persistAcceptedMapping = false,
} = {}) {
  const detection = detectDatasetMapping(dataset);
  const saved = !mapping && loadSavedMapping ? await loadVizMapping(dataset, { ownerId }) : null;
  const resolved = mapping || saved || detection.mapping;
  const validation = validateMapping(dataset, resolved);
  if (!validation.valid) {
    const error = new Error(`Invalid visualization mapping: ${validation.errors.join(' ')}`);
    error.code = 'VIZ_INVALID_MAPPING';
    throw error;
  }

  if (!mapping && !saved && detection.needsMapping) {
    return {
      status: 'mapping-required',
      needsMapping: true,
      detection,
      suggestedMapping: detection.mapping,
      previewRows: canonicalPreviewRows(dataset, 20),
    };
  }

  if (mapping && persistAcceptedMapping) await saveVizMapping(dataset, mapping, { ownerId });
  const normalized = normalizeScientificDataset(dataset, resolved, detection);
  normalized.casts = groupDatasetCasts(normalized);
  const capabilities = evaluateCapabilities(normalized);
  return {
    status: 'ready',
    needsMapping: false,
    detection,
    mapping: resolved,
    mappingSource: mapping ? 'provided' : saved ? 'saved' : 'detected',
    dataset: normalized,
    capabilities,
  };
}

export async function acceptDatasetMapping(dataset, mapping, { ownerId = null } = {}) {
  const validation = validateMapping(dataset, mapping);
  if (!validation.valid) {
    const error = new Error(`Invalid visualization mapping: ${validation.errors.join(' ')}`);
    error.code = 'VIZ_INVALID_MAPPING';
    throw error;
  }
  await saveVizMapping(dataset, mapping, { ownerId });
  return prepareScientificDataset(dataset, { ownerId, mapping, loadSavedMapping: false, persistAcceptedMapping: false });
}
