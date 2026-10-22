import api from './client.js';

export async function fetchActivitiesOverview() {
  const { data } = await api.get('/activities/overview');
  return data;
}

export async function fetchObservations(limit = 20) {
  const { data } = await api.get('/activities/observations', { params: { limit } });
  return Array.isArray(data) ? data : [];
}

export async function createObservation(payload) {
  const { data } = await api.post('/activities/observations', payload);
  return data;
}

// Returns { posts, nextCursor }. Pass the previous response's nextCursor
// to fetch the batch after it; nextCursor comes back null once there's
// nothing more to load.
export async function fetchCommunityPosts(limit = 6, cursor = null) {
  const { data } = await api.get('/activities/community/posts', { params: { limit, ...(cursor ? { cursor } : {}) } });
  if (Array.isArray(data)) return { posts: data, nextCursor: null }; // defensive, old-shape fallback
  return { posts: Array.isArray(data?.posts) ? data.posts : [], nextCursor: data?.nextCursor ?? null };
}

export async function createCommunityPost(payload) {
  const { data } = await api.post('/activities/community/posts', payload);
  return data;
}

export async function deleteCommunityPost(postId) {
  const { data } = await api.delete(`/activities/community/posts/${postId}`);
  return data;
}

export async function joinCommunityCircle(circleId) {
  const { data } = await api.post(`/activities/community/circles/${circleId}/join`);
  return data;
}

export async function leaveCommunityCircle(circleId) {
  const { data } = await api.delete(`/activities/community/circles/${circleId}/leave`);
  return data;
}

export async function toggleCommunityLike(postId) {
  const { data } = await api.post(`/activities/community/posts/${postId}/like`);
  return data;
}

export async function addCommunityComment(postId, body) {
  const { data } = await api.post(`/activities/community/posts/${postId}/comments`, { body });
  return data;
}

export async function verifyCommunityPost(postId) {
  const { data } = await api.patch(`/activities/community/posts/${postId}/verify`);
  return data;
}

export async function fetchInstitutionalActivities() {
  const { data } = await api.get('/activities/institutional');
  return Array.isArray(data) ? data : [];
}

export async function createInstitutionalActivity(payload) {
  const { data } = await api.post('/activities/institutional', payload);
  return data;
}
