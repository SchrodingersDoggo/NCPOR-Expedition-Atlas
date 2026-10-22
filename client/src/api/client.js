import axios from 'axios';

// vite.config.js already proxies /api -> http://localhost:5000, so no
// separate base URL / env var is needed in dev. In production this should
// point at wherever the API is actually deployed.
const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ncpor_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ncpor_token');
      localStorage.removeItem('ncpor_user');
      // AuthProvider listens for this so a dead/expired token doesn't leave
      // the navbar stuck showing a logged-in user with no valid session.
      window.dispatchEvent(new Event('ncpor:auth:logout'));
    }
    return Promise.reject(error);
  }
);

export default api;
