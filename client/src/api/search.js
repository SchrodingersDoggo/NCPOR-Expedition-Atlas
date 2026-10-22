import api from './client.js';
let timeout = null;

export function searchGlobal(query, debounceMs = 300) {
  return new Promise((resolve) => {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', { params: { q: query || '', limit: 20 } });
        resolve({ success: true, data: data.results || data, query });
      } catch (e) {
        resolve({ success: false, error: 'Search failed' });
      }
    }, debounceMs);
  });
}
