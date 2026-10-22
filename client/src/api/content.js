import api from './client.js';

// Fetches all published content items for a single expedition (reports,
// publications, photos, videos, datasets) and buckets them by which tab
// of the Expedition Detail Panel they belong on.
//
// GET /api/content?expedition_id=... already returns everything we need,
// including datasetMeta for type === 'dataset' items — Phase 5 (the Data
// tab) reads straight from that, no re-parsing.
export async function fetchExpeditionContent(expeditionId) {
  const { data } = await api.get('/content', {
    params: { expedition_id: expeditionId, status: 'published' },
  });

  const items = Array.isArray(data) ? data : [];

  return {
    reports: items.filter((i) => i.type === 'report' || i.type === 'publication'),
    photos: items.filter((i) => i.type === 'photo' || i.type === 'video'),
    data: items.filter((i) => i.type === 'dataset'),
    all: items,
  };
}


// GET /api/content/:id/download — access-controlled dataset download.
// MinIO returns a short-lived presigned URL; historical Cloudinary-backed
// dataset records return their existing URL only after the same access check.
export async function fetchContentDownload(id) {
  const { data } = await api.get(`/content/${id}/download`);
  return data;
}

// GET /api/content?status=in_review — everything waiting on a
// comms_officer/admin to publish it. Researcher uploads land here (see
// content.controller.js#createContent); admin/comms_officer uploads skip
// this entirely by auto-publishing.
export async function fetchReviewQueue() {
  const { data } = await api.get('/content', { params: { status: 'in_review' } });
  return Array.isArray(data) ? data : [];
}

// PATCH /api/content/:id/status — comms_officer/admin only (enforced
// server-side too). Used by the Review Queue to publish or archive
// (reject) a pending item.
export async function setContentStatus(id, status) {
  const { data } = await api.patch(`/content/${id}/status`, { status });
  return data;
}

// PATCH /api/content/:id — comms_officer/admin only. Used by the Expedition
// Knowledge Hub editor to update titles, article text, summaries and archive metadata.
export async function updateContentItem(id, payload) {
  const { data } = await api.patch(`/content/${id}`, payload);
  return data;
}
