import api from './client.js';

// ---- Communities ----
export const fetchCommunities = (params = {}) => api.get('/communities', { params }).then((r) => r.data);
export const fetchMyCommunities = () => api.get('/communities/mine').then((r) => r.data.communities);
export const createCommunity = (payload) => api.post('/communities', payload).then((r) => r.data);
export const fetchCommunity = (slug) => api.get(`/communities/c/${slug}`).then((r) => r.data);
export const updateCommunity = (slug, payload) => api.patch(`/communities/c/${slug}`, payload).then((r) => r.data);
export const joinCommunity = (slug) => api.post(`/communities/c/${slug}/join`).then((r) => r.data);
export const leaveCommunity = (slug) => api.delete(`/communities/c/${slug}/leave`).then((r) => r.data);
export const setCommunityFavorite = (slug, favorite) => api.patch(`/communities/c/${slug}/favorite`, { favorite }).then((r) => r.data);
export const fetchCommunityMembers = (slug, status = 'active') => api.get(`/communities/c/${slug}/members`, { params: { status } }).then((r) => r.data.members);
export const approveMember = (slug, userId) => api.post(`/communities/c/${slug}/members/${userId}/approve`).then((r) => r.data);
export const makeModerator = (slug, userId) => api.post(`/communities/c/${slug}/members/${userId}/moderator`).then((r) => r.data);
export const removeModerator = (slug, userId) => api.delete(`/communities/c/${slug}/members/${userId}/moderator`).then((r) => r.data);
export const removeMember = (slug, userId) => api.delete(`/communities/c/${slug}/members/${userId}`).then((r) => r.data);

// ---- Feed & posts ----
// params: { feed: home|popular|news, community, author, sort: hot|new|top, t, page, limit }
export const fetchFeed = (params) => api.get('/communities/feed', { params }).then((r) => r.data);
export const fetchPost = (id) => api.get(`/communities/posts/${id}`).then((r) => r.data);
export const createPost = (payload) => api.post('/communities/posts', payload).then((r) => r.data);
export const updatePost = (id, payload) => api.patch(`/communities/posts/${id}`, payload).then((r) => r.data);
export const deletePost = (id) => api.delete(`/communities/posts/${id}`).then((r) => r.data);
export const votePost = (id, value) => api.post(`/communities/posts/${id}/vote`, { value }).then((r) => r.data);
export const addComment = (postId, body, parentId) => api.post(`/communities/posts/${postId}/comments`, { body, parentId }).then((r) => r.data);
export const deleteComment = (id) => api.delete(`/communities/comments/${id}`).then((r) => r.data);
export const voteComment = (id, value) => api.post(`/communities/comments/${id}/vote`, { value }).then((r) => r.data);

export async function uploadCommunityMedia(files, onProgress) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const { data } = await api.post('/communities/media', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
  });
  return data.media;
}

// ---- Search & profiles ----
export const searchCommunities = (q, type = 'all', limit = 5, signal) =>
  api.get('/communities/search', { params: { q, type, limit }, signal }).then((r) => r.data);
export const fetchCommunityUser = (id) => api.get(`/communities/users/${id}`).then((r) => r.data);
