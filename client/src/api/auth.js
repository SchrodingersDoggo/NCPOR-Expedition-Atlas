import api from './client.js';

// Server returns { token, user: { id, name, role, accountStatus } } on success.
export async function loginRequest(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

// NPDC-style registration fields (see RegisterPage.jsx). Server returns
// the created user object, no token — registration and login are separate
// steps on the backend; the account starts accountStatus: 'pending'
// regardless of anything sent here.
export async function registerRequest(fields) {
  const { data } = await api.post('/auth/register', fields);
  return data;
}
