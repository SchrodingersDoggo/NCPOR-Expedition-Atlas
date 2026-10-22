import api from './client.js';
import { getDefaultResearchStations } from '../data/researchStations.js';

export async function fetchResearchStations() {
  try {
    const res = await fetch('/api/explorer/stations');
    if (!res.ok) throw new Error(`Research stations request failed (${res.status})`);

    const json = await res.json();
    const stations = Array.isArray(json?.data) ? json.data : [];

    // An empty/invalid response should not silently erase the three fixed
    // landing-globe stations. Keep the API authoritative whenever it
    // supplies usable station records, otherwise fall back locally.
    return stations.length ? stations : getDefaultResearchStations();
  } catch (error) {
    console.warn('[NCPOR stations] using bundled research-station fallback', error);
    return getDefaultResearchStations();
  }
}

// --- Controlled research-location vocabulary (region -> station ---------
// -> coordinates), backed by the database — distinct from the static
// fetchResearchStations() above, which feeds the Explorer globe's fixed
// three-station illustration and is left untouched here.

// GET /api/stations?region=Antarctic&includeCounts=true
export async function fetchStations({ region, includeCounts } = {}) {
  const params = {};
  if (region) params.region = region;
  if (includeCounts) params.includeCounts = 'true';
  const { data } = await api.get('/stations', { params: Object.keys(params).length ? params : undefined });
  return Array.isArray(data) ? data : [];
}

// admin/comms_officer only.
export async function createStation(payload) {
  const { data } = await api.post('/stations', payload);
  return data;
}

// admin/comms_officer only.
export async function updateStation(id, payload) {
  const { data } = await api.patch(`/stations/${id}`, payload);
  return data;
}

// admin/comms_officer only — refused with 409 if the station is in use.
export async function deleteStation(id) {
  await api.delete(`/stations/${id}`);
}
