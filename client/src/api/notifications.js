import api from './client.js';

export const fetchNotifications = (params = {}) => api.get('/notifications', { params }).then((r) => r.data);
// Two integers only: { notifications, messages } — safe to check occasionally.
export const fetchNotificationSummary = () => api.get('/notifications/summary').then((r) => r.data);
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data);
export const markAllNotificationsRead = () => api.patch('/notifications/read-all').then((r) => r.data);
