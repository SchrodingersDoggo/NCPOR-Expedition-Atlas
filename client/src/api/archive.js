import api from './client.js';

// GET /api/archive/search — Archive Search + Advanced Filters combined.
// `params` may include: q, type, region, research_domain, expedition_id,
// year, year_from, year_to, status (staff only), sort, page, limit.
export async function searchArchive(params = {}) {
  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const { data } = await api.get('/archive/search', { params: cleaned });
  return data;
}

// GET /api/archive/timeline — list of years with material, oldest first.
export async function fetchArchiveYears() {
  const { data } = await api.get('/archive/timeline');
  return data.years;
}

// GET /api/archive/timeline?year=YYYY — stats for a single selected year.
export async function fetchYearStats(year) {
  const { data } = await api.get('/archive/timeline', { params: { year } });
  return data;
}

// GET /api/archive/facets — dynamic filter options grounded in real data
// (expeditions that actually have archive content, year bounds, etc).
export async function fetchArchiveFacets() {
  const { data } = await api.get('/archive/facets');
  return data;
}

// GET /api/archive/items/:id — full detail page + Related Content.
export async function fetchArchiveItem(id) {
  const { data } = await api.get(`/archive/items/${id}`);
  return data;
}

// GET /api/archive/submissions?bucket=pending|done|all — Submission
// Tracking. Researchers see only their own; staff see everyone's.
export async function fetchSubmissions(bucket = 'pending', page = 1) {
  const { data } = await api.get('/archive/submissions', { params: { bucket, page } });
  return data;
}

// GET /api/archive/queue?sort=oldest|newest|priority|type|status
export async function fetchSubmissionQueue(sort = 'oldest', page = 1) {
  const { data } = await api.get('/archive/queue', { params: { sort, page } });
  return data;
}

// PATCH /api/archive/submissions/:id/status — comms_officer/admin only.
export async function updateSubmissionStatus(id, status) {
  const { data } = await api.patch(`/archive/submissions/${id}/status`, { status });
  return data;
}

// PATCH /api/archive/submissions/:id/priority — comms_officer/admin only.
export async function updateSubmissionPriority(id, priority) {
  const { data } = await api.patch(`/archive/submissions/${id}/priority`, { priority });
  return data;
}
