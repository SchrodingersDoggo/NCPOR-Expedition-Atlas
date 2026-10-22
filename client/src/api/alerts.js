import api from './client.js';

export const DANGER_TYPES = [
  { value: 'medical', label: 'Medical' },
  { value: 'weather', label: 'Weather' },
  { value: 'terrain_ice', label: 'Terrain/Ice' },
  { value: 'equipment_vehicle', label: 'Equipment/Vehicle' },
  { value: 'other', label: 'Other' },
];

export function dangerTypeLabel(value) {
  return DANGER_TYPES.find((t) => t.value === value)?.label || value;
}

// POST /api/expeditions/:id/alerts
// No offline queueing here on purpose: the app's low-bandwidth handling
// already keeps requests working on a weak connection, so an alert is sent
// directly rather than staged for a later sync — a safety report shouldn't
// sit unsent on a device.
export async function reportAlert(expeditionId, { type, message, latitude, longitude, clientRequestId }) {
  const { data } = await api.post(`/expeditions/${expeditionId}/alerts`, {
    type,
    message: message || undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    client_request_id: clientRequestId,
  });
  return data;
}

// GET /api/expeditions/:id/alerts
export async function fetchAlerts(expeditionId) {
  const { data } = await api.get(`/expeditions/${expeditionId}/alerts`);
  return data.alerts;
}

// GET /api/alerts?since=... — Phase 2 polling, across every expedition.
export async function fetchRecentAlerts(sinceIso) {
  const { data } = await api.get('/alerts', { params: { since: sinceIso } });
  return data; // { alerts, checkedAt }
}

// PATCH /api/expeditions/:id/alerts/:alertId/resolve — Phase 5, admin/comms_officer only.
export async function resolveAlert(expeditionId, alertId) {
  const { data } = await api.patch(`/expeditions/${expeditionId}/alerts/${alertId}/resolve`);
  return data;
}
