import api from './client.js';

// POST /api/dataset-metadata — metadata-first create.
// If `content` is omitted, this creates a description-only record (no file
// yet — Priya submitting her CTD metadata the day she gets back). If
// `content` is included (the result of an /api/upload call the caller
// already made) along with a `role` (raw/processed/documentation/
// calibration/derived/other, defaults to 'raw' server-side), the first
// linked file is created in the same request. Further files — a processed
// version added later, a calibration PDF — go through addFileToMetadata,
// any number of times; one metadata record is not limited to one file.
export async function createDatasetMetadata(payload) {
  const { data } = await api.post('/dataset-metadata', payload);
  return data;
}

// GET /api/dataset-metadata/mine?unlinked=true
// The signed-in researcher's own metadata records. Pass unlinked: true to
// get only the ones with zero files attached at all — this is what the
// Upload page's "saved metadata awaiting a file" reminder panel uses. A
// record that already has one file (say, raw) but could still use another
// (processed) is NOT "unlinked" — omit the flag to fetch all of a
// researcher's own records, which is what the "attach a file to an
// existing record" picker uses, so a record can keep receiving files.
export async function fetchMyDatasetMetadata({ unlinked } = {}) {
  const { data } = await api.get('/dataset-metadata/mine', {
    params: unlinked ? { unlinked: 'true' } : undefined,
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchDatasetMetadataById(id) {
  const { data } = await api.get(`/dataset-metadata/${id}`);
  return data;
}

export async function updateDatasetMetadata(id, payload) {
  const { data } = await api.patch(`/dataset-metadata/${id}`, payload);
  return data;
}

// GET /api/dataset-metadata/queue?status=submitted,under_review — staff
// only. Everything currently waiting on a reviewer, across every
// researcher (unlike fetchMyDatasetMetadata, which is scoped to "mine").
export async function fetchMetadataQueue(statuses) {
  const { data } = await api.get('/dataset-metadata/queue', {
    params: statuses ? { status: statuses.join(',') } : undefined,
  });
  return Array.isArray(data) ? data : [];
}

// The review workflow: action is one of start_review | request_changes |
// approve | publish | archive (staff only) or resubmit (the record's own
// researcher, after fixing a changes_requested record). comment is
// required by the server for request_changes, optional/ignored otherwise.
export async function reviewDatasetMetadata(id, action, comment) {
  const { data } = await api.patch(`/dataset-metadata/${id}/status`, { action, comment });
  return data;
}

// Standalone fetch of just the review history — the full record (via
// fetchDatasetMetadataById) already includes this under .reviewHistory,
// so this is for a caller that wants only the timeline.
export async function fetchMetadataReviewHistory(id) {
  const { data } = await api.get(`/dataset-metadata/${id}/review-history`);
  return Array.isArray(data) ? data : [];
}

// POST /api/dataset-metadata/:id/files — attach one more file to a metadata
// record that may already have others. `content` is the result of an
// /api/upload call; `role` is raw/processed/documentation/calibration/
// derived/other (defaults to 'raw'); `label` is optional free text for
// when role alone doesn't disambiguate (e.g. two 'raw' files from
// different instruments).
export async function addFileToMetadata(id, { role, label, ...content }) {
  const { data } = await api.post(`/dataset-metadata/${id}/files`, { role, label, ...content });
  return data;
}

// DELETE /api/dataset-metadata/:id/files/:fileId — removes one file from a
// metadata record without touching the record or its other files.
export async function removeFileFromMetadata(id, fileId) {
  await api.delete(`/dataset-metadata/${id}/files/${fileId}`);
}
