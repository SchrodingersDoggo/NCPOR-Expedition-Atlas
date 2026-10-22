const pendingBaseWrites = new Map();

export function trackVizBaseCacheWrite(cacheKey, promise) {
  if (!cacheKey || !promise?.then) return promise;
  pendingBaseWrites.set(cacheKey, promise);
  promise.finally(() => {
    if (pendingBaseWrites.get(cacheKey) === promise) pendingBaseWrites.delete(cacheKey);
  });
  return promise;
}

export async function waitForVizBaseCacheWrite(cacheKey) {
  const pending = pendingBaseWrites.get(cacheKey);
  if (!pending) return null;
  try { return await pending; } catch { return null; }
}

export function hasPendingVizBaseCacheWrite(cacheKey) {
  return pendingBaseWrites.has(cacheKey);
}
