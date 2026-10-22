import api from './client.js';
import { cacheExpedition } from '../offline/queue.js';

// The globe needs: id, name, region, lat, lng, year, pi, desc.
// The backend returns: id, name, region, latitude, longitude, startDate,
// description, pi: { name, ... }. This maps one to the other in one place,
// so the globe component doesn't need to know about the API's shape at all.
export async function fetchExpeditionsForGlobe() {
  const { data } = await api.get('/expeditions', { params: { limit: 100 } });

  return data.expeditions
    // Pins need real coordinates — silently skip any expedition that was
    // created without lat/lng rather than crashing the globe render.
    .filter((exp) => exp.latitude != null && exp.longitude != null)
    .map((exp) => ({
      id: exp.id,
      name: exp.name,
      region: exp.region || 'Other',
      lat: parseFloat(exp.latitude),
      lng: parseFloat(exp.longitude),
      year: exp.startDate ? new Date(exp.startDate).getFullYear() : null,
      pi: exp.pi?.name || 'Unassigned',
      desc: exp.description || 'No description available yet.',
      dangerLevel: exp.dangerLevel || 'low',
    }));
}

// Raw expedition list for pickers (Upload page's "attach to existing
// expedition" dropdown) — unlike fetchExpeditionsForGlobe this keeps the
// original id/name/region/startDate shape instead of reshaping for the globe,
// and doesn't drop expeditions that have no lat/lng yet.
export async function fetchExpeditionsList() {
  const { data } = await api.get('/expeditions', { params: { limit: 100 } });
  return data.expeditions;
}

// POST /api/expeditions — used by the Upload page when a researcher is
// logging a brand new expedition rather than attaching content to one that
// already exists.
export async function createExpedition(payload) {
  const { data } = await api.post('/expeditions', payload);
  return data;
}

// PATCH /api/expeditions/:id — Phase 7 conflict-aware update.
//
// `expectedUpdatedAt` is the updatedAt value the edit was based on. The server
// refuses the write with 409 (carrying its own current copy) if the record
// changed in the meantime, instead of silently overwriting someone else's
// correction. Omit it to keep the old last-write-wins behavior.
export async function updateExpedition(id, payload, expectedUpdatedAt, clientRequestId, requestConfig = {}) {
  const { data } = await api.patch(`/expeditions/${id}`, {
    ...payload,
    expected_updated_at: expectedUpdatedAt || undefined,
    client_request_id: clientRequestId || undefined,
  }, requestConfig);
  return data;
}


export async function fetchExpeditionById(id) {
  const { data } = await api.get(`/expeditions/${id}`);
  await cacheExpedition(data);
  return data;
}

// Fetch one expedition and reshape it to the same offline-friendly shape
// used by the globe. The Archive/Save-offline flow uses this when a
// researcher saves an approved expedition for offline access.
export async function fetchExpeditionForOffline(expeditionId) {
  const exp = await fetchExpeditionById(expeditionId);
  return {
    id: exp.id,
    name: exp.name,
    region: exp.region || 'Other',
    lat: exp.latitude != null ? parseFloat(exp.latitude) : null,
    lng: exp.longitude != null ? parseFloat(exp.longitude) : null,
    year: exp.startDate ? new Date(exp.startDate).getFullYear() : null,
    pi: exp.pi?.name || 'Unassigned',
    desc: exp.description || 'No description available yet.',
    startDate: exp.startDate || null,
    endDate: exp.endDate || null,
  };
}

// DELETE /api/expeditions/:id — admin only (see expedition.routes.js). The
// backend removes the expedition plus every linked portal content record
// (reports, datasets, tags, AI generations, social posts) in one transaction.
export async function deleteExpedition(expeditionId) {
  const { data } = await api.delete(`/expeditions/${expeditionId}`);
  return data;
}
