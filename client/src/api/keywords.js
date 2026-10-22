import api from './client.js';

// GET /api/keywords?status=approved (default). Staff can pass 'pending' to
// see the suggestion queue, or 'all'. This is what backs the Scientific
// Keywords autocomplete on Upload and the moderation panel on the Review
// Queue.
export async function fetchKeywords(status) {
  const { data } = await api.get('/keywords', { params: status ? { status } : undefined });
  return Array.isArray(data) ? data : [];
}

// admin/comms_officer only — adds a term directly to the controlled
// vocabulary, pre-approved.
export async function createKeyword(name) {
  const { data } = await api.post('/keywords', { name });
  return data;
}

// admin/comms_officer only — approve or reject a researcher-suggested term.
export async function setKeywordStatus(id, status) {
  const { data } = await api.patch(`/keywords/${id}/status`, { status });
  return data;
}

// admin/comms_officer only — refused with 409 if the term is in use.
export async function deleteKeyword(id) {
  await api.delete(`/keywords/${id}`);
}
