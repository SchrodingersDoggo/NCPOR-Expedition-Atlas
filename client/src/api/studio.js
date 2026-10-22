import api from './client.js';

export async function uploadStudioAsset(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return {
    name: file.name,
    url: data.file_url,
    mimeType: data.mime_type,
    size: data.file_size_bytes,
    thumbnailUrl: data.thumbnail_url,
    publicId: data.cloudinary_public_id,
  };
}

export async function listStudioProjects() {
  const { data } = await api.get('/studio/projects');
  return data;
}

export async function listVoiceoverLanguages() {
  const { data } = await api.get('/studio/voiceover-languages');
  return data;
}

export async function createStudioProject(payload) {
  const { data } = await api.post('/studio/projects', payload);
  return data;
}

export async function generateStudioProject(id) {
  const { data } = await api.post(`/studio/projects/${id}/generate`);
  return data;
}

export async function getStudioProject(id) {
  const { data } = await api.get(`/studio/projects/${id}`);
  return data;
}

export async function updateStudioProject(id, patch) {
  const { data } = await api.patch(`/studio/projects/${id}`, patch);
  return data;
}

export async function deleteStudioGenerated(id) {
  const { data } = await api.delete(`/studio/projects/${id}/generated`);
  return data;
}

export async function deleteStudioProject(id) {
  await api.delete(`/studio/projects/${id}`);
}
