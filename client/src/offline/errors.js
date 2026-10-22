// Phase 7 — one place that decides what a failed sync request *means*.
//
// Before this, syncManager only asked "is this temporary?" (network/429/5xx)
// and treated everything else as permanently failed. That silently destroyed
// two very different situations:
//
//   * an expired JWT marked a researcher's whole field session "failed",
//     even though the work was fine and only needed a fresh login;
//   * losing connectivity mid-request burned a retry attempt, so five
//     blizzards in a row exhausted MAX_ATTEMPTS and the item went red.
//
// Each classification answers three separate questions, which the old
// boolean conflated:
//   retry        — may this item be attempted again at all?
//   countAttempt — does this failure count against MAX_ATTEMPTS? (Only the
//                  server actually rejecting us does. Connectivity and auth
//                  problems are about the environment, not the item.)
//   halt         — should the rest of this sync run stop? (No point pushing
//                  20 more items at a dead network or an expired token.)

export const ERROR_KIND = {
  ABORTED: 'aborted',
  OFFLINE: 'offline',
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  SERVER: 'server',
  CONFLICT: 'conflict',
  TOO_LARGE: 'too_large',
  REJECTED: 'rejected',
  STORAGE: 'storage',
  UNKNOWN: 'unknown',
};

// Human-readable, researcher-facing text for each kind. Deliberately says
// what happens next, because the Sync Center shows this verbatim and
// "Request failed with status code 401" tells a field scientist nothing.
const KIND_LABEL = {
  [ERROR_KIND.ABORTED]: 'Interrupted — will resume automatically.',
  [ERROR_KIND.OFFLINE]: 'No connection — waiting for internet.',
  [ERROR_KIND.AUTH]: 'Session expired — sign in again to continue syncing.',
  [ERROR_KIND.RATE_LIMIT]: 'Server busy — will retry shortly.',
  [ERROR_KIND.SERVER]: 'Server error — will retry.',
  [ERROR_KIND.CONFLICT]: 'Changed on the server since this was saved.',
  [ERROR_KIND.TOO_LARGE]: 'File is too large for the server to accept.',
  [ERROR_KIND.REJECTED]: 'Rejected by the server.',
  [ERROR_KIND.STORAGE]: 'Not enough space on this device.',
  [ERROR_KIND.UNKNOWN]: 'Synchronization failed.',
};

export function isAbortError(err) {
  return (
    err?.name === 'CanceledError' ||
    err?.name === 'AbortError' ||
    err?.code === 'ERR_CANCELED' ||
    err?.message === 'canceled'
  );
}

// Firefox and Chrome disagree on the name/code for a full IndexedDB, and
// Safari has historically thrown a plain DOMException with code 22.
export function isQuotaExceededError(err) {
  if (!err) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    err.__ncporStorage === true
  );
}

// 429/503 may carry Retry-After, in seconds or as an HTTP date. Honoring it
// stops the client hammering a server that has explicitly said "wait".
function retryAfterMs(response) {
  const header = response?.headers?.['retry-after'] ?? response?.headers?.['Retry-After'];
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

function serverMessage(err) {
  const data = err?.response?.data;
  if (typeof data === 'string' && data.trim() && !data.startsWith('<')) return data.trim();
  return data?.error || data?.message || null;
}

export function classifySyncError(err) {
  if (err?.code === 'DATASET_STORAGE_UNAVAILABLE' || err?.code === 'DATASET_PART_PRESIGNED_EXPIRED') {
    return kind(ERROR_KIND.SERVER, {
      retry: true,
      countAttempt: false,
      halt: true,
      message: err.message || 'Dataset storage is temporarily unavailable.',
    });
  }

  if (err?.code === 'DATASET_PART_INTEGRITY') {
    return kind(ERROR_KIND.REJECTED, {
      retry: false,
      countAttempt: true,
      message: err.message || 'Dataset checksum integrity validation failed.',
    });
  }

  if (isAbortError(err)) {
    return kind(ERROR_KIND.ABORTED, { retry: true, countAttempt: false, halt: true });
  }

  if (isQuotaExceededError(err)) {
    return kind(ERROR_KIND.STORAGE, {
      retry: true,
      countAttempt: false,
      halt: true,
      message: err.message || KIND_LABEL[ERROR_KIND.STORAGE],
    });
  }

  const status = err?.response?.status;

  // No response at all — DNS failure, dropped link, server unreachable. This
  // is the ordinary Antarctic case and must never consume a retry attempt.
  if (!status) {
    return kind(ERROR_KIND.OFFLINE, { retry: true, countAttempt: false, halt: true });
  }

  if (status === 401) {
    return kind(ERROR_KIND.AUTH, { retry: true, countAttempt: false, halt: true });
  }

  // 403 is *not* an auth expiry — authorize() returns it for a role that
  // genuinely may not do this. Retrying it forever would be a loop.
  if (status === 403) {
    return kind(ERROR_KIND.REJECTED, {
      retry: false,
      countAttempt: true,
      message: serverMessage(err) || 'You do not have permission to upload this.',
    });
  }

  if (status === 409) {
    return kind(ERROR_KIND.CONFLICT, {
      retry: false,
      countAttempt: true,
      conflict: err.response?.data ?? null,
      message: serverMessage(err) || KIND_LABEL[ERROR_KIND.CONFLICT],
    });
  }

  if (status === 413) {
    return kind(ERROR_KIND.TOO_LARGE, {
      retry: false,
      countAttempt: true,
      message: serverMessage(err) || KIND_LABEL[ERROR_KIND.TOO_LARGE],
    });
  }

  if (status === 429) {
    return kind(ERROR_KIND.RATE_LIMIT, {
      retry: true,
      countAttempt: true,
      retryAfterMs: retryAfterMs(err.response),
    });
  }

  if (status >= 500) {
    return kind(ERROR_KIND.SERVER, {
      retry: true,
      countAttempt: true,
      retryAfterMs: retryAfterMs(err.response),
      message: serverMessage(err) || KIND_LABEL[ERROR_KIND.SERVER],
    });
  }

  // Any other 4xx: malformed payload, missing expedition, bad type. Retrying
  // identical bytes will produce an identical rejection, so fail it visibly
  // and let the researcher decide.
  return kind(ERROR_KIND.REJECTED, {
    retry: false,
    countAttempt: true,
    message: serverMessage(err) || KIND_LABEL[ERROR_KIND.REJECTED],
  });
}

function kind(name, options = {}) {
  return {
    kind: name,
    retry: options.retry ?? false,
    countAttempt: options.countAttempt ?? true,
    halt: options.halt ?? false,
    retryAfterMs: options.retryAfterMs ?? null,
    conflict: options.conflict ?? null,
    message: options.message || KIND_LABEL[name] || KIND_LABEL[ERROR_KIND.UNKNOWN],
  };
}

export function describeErrorKind(kindName) {
  return KIND_LABEL[kindName] || KIND_LABEL[ERROR_KIND.UNKNOWN];
}
