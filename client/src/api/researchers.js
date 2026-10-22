import api from './client.js';

export async function fetchResearchers() {
  const { data } = await api.get('/researchers');
  return data?.researchers || [];
}

export async function fetchResearcher(id) {
  const { data } = await api.get(`/researchers/${id}`);
  return data;
}
