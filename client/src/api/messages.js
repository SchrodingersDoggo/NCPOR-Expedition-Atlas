import api from './client.js';

// GET /api/messages/conversations[?since=ISO] — full inbox, or only
// conversations changed since the last poll's serverTime.
export const fetchConversations = (since) =>
  api.get('/messages/conversations', { params: since ? { since } : {} }).then((r) => r.data);

// Initial load: latest page + the other user's basic info.
export const fetchConversation = (userId) => api.get(`/messages/${userId}`).then((r) => r.data);

// Polling: only messages newer than afterId.
export const fetchNewMessages = (userId, afterId) =>
  api.get(`/messages/${userId}`, { params: { after: afterId } }).then((r) => r.data.messages);

// Scroll-up pagination: messages older than beforeId.
export const fetchOlderMessages = (userId, beforeId) =>
  api.get(`/messages/${userId}`, { params: { before: beforeId } }).then((r) => r.data);

export const sendMessage = (userId, body) => api.post(`/messages/${userId}`, { body }).then((r) => r.data);
export const markConversationRead = (userId) => api.patch(`/messages/${userId}/read`).then((r) => r.data);
