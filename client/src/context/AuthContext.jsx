import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loginRequest, registerRequest } from '../api/auth.js';
import {
  cleanupStaleDatasetUploadSessions,
  restoreDatasetUploadSessionTokens,
} from '../api/datasetUpload.js';
import { scrubDatasetUploadSessionTokens } from '../offline/datasetUploads.js';
import { clearDatasetAccessCache } from '../viz/datasetAccess.js';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem('ncpor_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt/old localStorage value — treat as logged out rather than crash.
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(false);

  // api/client.js clears localStorage and fires this event whenever a
  // request comes back 401 (expired/invalid token). Keep React state
  // in sync so the UI doesn't keep showing a "logged in" navbar for a
  // session that the server no longer honors.
  useEffect(() => {
    const onForcedLogout = () => setUser((previousUser) => {
      if (previousUser?.id) void scrubDatasetUploadSessionTokens(previousUser.id);
      return null;
    });
    window.addEventListener('ncpor:auth:logout', onForcedLogout);
    return () => window.removeEventListener('ncpor:auth:logout', onForcedLogout);
  }, []);

  // Multipart cleanup is owner-scoped and best-effort. Restore tokens that
  // were intentionally scrubbed during logout, then reconcile/clean only
  // genuinely stale records. Normal upload/resume behavior is unchanged.
  useEffect(() => {
    if (!user?.id || !['researcher', 'comms_officer', 'admin'].includes(user.role)) return;
    let active = true;
    void (async () => {
      try {
        await restoreDatasetUploadSessionTokens(user.id);
        if (active) await cleanupStaleDatasetUploadSessions(user.id);
      } catch (error) {
        console.warn('Multipart dataset cleanup skipped:', error);
      }
    })();
    return () => { active = false; };
  }, [user?.id, user?.role]);

  // Visualizer V0: short-lived MinIO URLs are intentionally memory-only,
  // but that memory must also be account-scoped. Clear them whenever the
  // authenticated identity changes so a signed URL issued to one account can
  // never be reused by another account in the same SPA tab.
  useEffect(() => {
    clearDatasetAccessCache();
  }, [user?.id]);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const { token, user: loggedInUser } = await loginRequest(email, password);
      localStorage.setItem('ncpor_token', token);
      localStorage.setItem('ncpor_user', JSON.stringify(loggedInUser));
      setUser((previousUser) => {
        if (previousUser?.id && previousUser.id !== loggedInUser.id) {
          void scrubDatasetUploadSessionTokens(previousUser.id);
        }
        return loggedInUser;
      });
      // Phase 7: a queue that stalled on an expired session should resume the
      // moment there's a usable token again, not at the next 30s poll — the
      // researcher is standing there watching, and a satellite window is short.
      window.dispatchEvent(new Event('ncpor:auth:login'));
      return loggedInUser;
    } finally {
      setLoading(false);
    }
  }, []);

  // The backend's /register only creates the user (no token), so log in
  // right after with the same credentials for a one-step signup flow. The
  // account starts accountStatus: 'pending' — login still succeeds (see
  // requireActiveAccount in the backend middleware, which only blocks
  // protected write actions, not login itself), so the new user lands in
  // the app immediately and sees the pending-approval notice there.
  const register = useCallback(async (fields) => {
    setLoading(true);
    try {
      await registerRequest(fields);
      return await login(fields.email, fields.password);
    } finally {
      setLoading(false);
    }
  }, [login]);

  const logout = useCallback(() => {
    if (user?.id) void scrubDatasetUploadSessionTokens(user.id);
    localStorage.removeItem('ncpor_token');
    localStorage.removeItem('ncpor_user');
    setUser(null);
  }, [user?.id]);

  // Profile edits (name/organization/avatar) happen on the Profile page,
  // not through login/register — this keeps the navbar and localStorage
  // in sync with whatever the server just confirmed, without a refetch.
  const updateStoredUser = useCallback((patch) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('ncpor_user', JSON.stringify(next));
      return next;
    });
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    loading,
    login,
    register,
    logout,
    updateStoredUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
