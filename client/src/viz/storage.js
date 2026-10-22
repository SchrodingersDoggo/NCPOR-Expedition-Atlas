import { getDb } from '../offline/db.js';
import { STORE_VIZ_MAPPINGS } from '../offline/constants.js';
import { MAPPING_VERSION } from './detection.js';
import { buildVizMappingKey } from './storageKeys.js';

export function canPersistVizMapping(dataset, { ownerId = null } = {}) {
  return Boolean(ownerId && dataset?.contentId && dataset?.datasetFingerprint);
}

export async function loadVizMapping(dataset, { ownerId = null } = {}) {
  if (!canPersistVizMapping(dataset, { ownerId })) return null;
  const db = await getDb();
  const mappingKey = buildVizMappingKey({ ownerId, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint });
  const record = await db.get(STORE_VIZ_MAPPINGS, mappingKey);
  if (!record || record.mappingVersion !== MAPPING_VERSION) return null;
  return record.mapping || null;
}

export async function saveVizMapping(dataset, mapping, { ownerId = null } = {}) {
  if (!canPersistVizMapping(dataset, { ownerId })) return null;
  const db = await getDb();
  const mappingKey = buildVizMappingKey({ ownerId, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint });
  const record = {
    mappingKey,
    ownerId: ownerId || 'shared',
    contentId: dataset.contentId,
    datasetFingerprint: dataset.datasetFingerprint,
    mappingVersion: MAPPING_VERSION,
    mapping,
    updatedAt: new Date().toISOString(),
  };
  await db.put(STORE_VIZ_MAPPINGS, record);
  return record;
}

export async function removeVizMapping(dataset, { ownerId = null } = {}) {
  if (!canPersistVizMapping(dataset, { ownerId })) return false;
  const db = await getDb();
  const mappingKey = buildVizMappingKey({ ownerId, contentId: dataset.contentId, datasetFingerprint: dataset.datasetFingerprint });
  await db.delete(STORE_VIZ_MAPPINGS, mappingKey);
  return true;
}
