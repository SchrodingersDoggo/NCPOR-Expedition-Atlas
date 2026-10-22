import api from './client.js';

// GET /api/users/me — full profile + contribution stats (expeditions led,
// content uploaded/approved, activities created) for the Profile tab.
export async function fetchMyProfile() {
  const { data } = await api.get('/users/me');
  return data;
}

// PATCH /api/users/me — name / organization plus (Communities update) the
// optional public contact links. Avatar goes through uploadAvatar below
// since it's a separate multipart request.
export async function updateMyProfile({ name, organization, ...contact }) {
  const { data } = await api.patch('/users/me', { name, organization, ...contact });
  return data;
}

// POST /api/users/me/avatar — multipart/form-data, field name "avatar".
// Returns the updated user (with the new avatarUrl already set).
export async function uploadMyAvatar(file) {
  const formData = new FormData();
  formData.append('avatar', file);
  const { data } = await api.post('/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
