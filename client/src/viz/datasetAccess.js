import api from '../api/client.js';

const EXPIRY_SAFETY_MS = 30_000;
const accessCache = new Map();

function expiryTime(access) {
  const clientValue = Number(access?._clientExpiresAt || 0);
  if (Number.isFinite(clientValue) && clientValue > 0) return clientValue;
  const value = Date.parse(access?.expiresAt || '');
  return Number.isFinite(value) ? value : null;
}

function isNearExpiry(access) {
  if (!access || access.storageProvider !== 'minio') return false;
  const expiresAt = expiryTime(access);
  return expiresAt != null && expiresAt - Date.now() <= EXPIRY_SAFETY_MS;
}

export async function refreshDatasetAccess(contentId, { signal = null } = {}) {
  const { data } = await api.get(`/content/${contentId}/access`, { signal });
  const access = {
    ...data,
    // Track expiry from receipt time too, so a user's incorrect device clock
    // does not make the visualizer trust a signed URL longer than intended.
    ...(Number(data?.expiresIn) > 0
      ? { _clientExpiresAt: Date.now() + Number(data.expiresIn) * 1000 }
      : {}),
  };
  accessCache.set(String(contentId), access);
  return access;
}

// Central V0 access point. Signed URLs live only in this in-memory cache;
// they are deliberately never written to IndexedDB/localStorage.
export async function getDatasetAccess(contentId, { forceRefresh = false, signal = null } = {}) {
  const key = String(contentId);
  let access = forceRefresh ? null : accessCache.get(key);
  if (!access || isNearExpiry(access)) {
    access = await refreshDatasetAccess(key, { signal });
  }
  return access;
}

export function clearDatasetAccessCache(contentId = null) {
  if (contentId == null) accessCache.clear();
  else accessCache.delete(String(contentId));
}

async function responseLooksExpired(response, access) {
  if (access?.storageProvider !== 'minio') return false;
  if (![400, 401, 403].includes(response.status)) return false;
  if (isNearExpiry(access)) return true;

  try {
    const body = await response.clone().text();
    if (/RequestExpired|ExpiredToken|request\s+has\s+expired|signature.*expired/i.test(body)) {
      return true;
    }
  } catch {
    // MinIO/CORS may hide the structured body on an expired signature.
  }
  // One fresh access retry is safe here because the portal re-authorizes the
  // user before issuing the replacement URL. Persistent storage failures will
  // still fail immediately on the second attempt.
  return true;
}

async function fetchWithAccess(contentId, init = {}) {
  const signal = init?.signal || null;
  let access = await getDatasetAccess(contentId, { signal });
  let response = await fetch(access.url, init);

  if (await responseLooksExpired(response, access)) {
    access = await refreshDatasetAccess(contentId, { signal });
    response = await fetch(access.url, init);
  }

  if (!response.ok) {
    const error = new Error(`Dataset request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  return { response, access };
}

export async function fetchDataset(contentId, init = {}) {
  return fetchWithAccess(contentId, init);
}

export async function fetchDatasetRange(contentId, {
  start = 0,
  end,
  headers = {},
  ...init
} = {}) {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new Error('Dataset range start must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(end) || end < start) {
    throw new Error('Dataset range end must be an integer greater than or equal to start.');
  }

  const rangeHeaders = new Headers(headers);
  rangeHeaders.set('Range', `bytes=${start}-${end}`);
  const result = await fetchWithAccess(contentId, { ...init, headers: rangeHeaders });

  // Never let a server/CORS misconfiguration turn a 1 MiB preview into a
  // silent full-file download. A proper byte-range response is 206. A 200 is
  // accepted only when the entire object itself fits inside the requested
  // byte window.
  if (result.response.status !== 206) {
    const requestedBytes = end - start + 1;
    const knownFileSize = Number(result.access?.fileSize || 0);
    const contentLength = Number(result.response.headers.get('Content-Length') || 0);
    const entireObjectFits = (Number.isSafeInteger(knownFileSize) && knownFileSize > 0 && knownFileSize <= requestedBytes)
      || (Number.isSafeInteger(contentLength) && contentLength > 0 && contentLength <= requestedBytes);

    if (!entireObjectFits) {
      try { await result.response.body?.cancel(); } catch { /* best effort */ }
      const error = new Error('Dataset server did not honor the requested byte range; preview download was stopped.');
      error.code = 'DATASET_RANGE_UNSUPPORTED';
      throw error;
    }
  }

  return result;
}
