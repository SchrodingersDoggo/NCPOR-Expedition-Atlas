import api from './client.js';

// POST /api/ai/generate — content_item_id is optional (nullable in the
// schema), so this can run mid-upload before the content item itself has
// been created yet. Returns an array (one per requested type); we only ever
// ask for one type here, so callers take the first result.
export async function generateSummary(sourceText, { contentItemId = null, type = 'web_summary' } = {}) {
  const { data } = await api.post('/ai/generate', {
    content_item_id: contentItemId,
    source_text: sourceText,
    types: [type],
  });
  return data[0];
}

// PATCH /api/ai/:id/edit — persists a human edit of the AI draft as an
// audit trail (ai_output stays untouched, edited_output + version bump +
// reviewed_by get set). Researchers can only do this for their own
// generations; comms_officer/admin can edit any (enforced server-side).
export async function editSummary(generationId, editedOutput) {
  const { data } = await api.patch(`/ai/${generationId}/edit`, { edited_output: editedOutput });
  return data;
}
