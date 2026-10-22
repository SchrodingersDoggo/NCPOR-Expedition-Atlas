import { getDb } from './db.js';
import { STORE_GLOBE_CACHE, GLOBE_CACHE_KEY } from './constants.js';

// Phase 4 — read/write cache for the landing page globe's expedition list.
// This is a plain best-effort cache: writes never throw into the caller's
// success path, and a missing/failed read just means "nothing cached yet"
// rather than an error. It does not participate in the pending-queue /
// sync-manager system at all — it only exists so the offline and
// low-bandwidth views have real expedition data to show.

// Called after a successful fetchExpeditionsForGlobe() so the next offline
// visit has something to fall back to.
export async function cacheGlobeExpeditions(expeditions) {
  if (!Array.isArray(expeditions)) return;
  try {
    const db = await getDb();
    await db.put(STORE_GLOBE_CACHE, {
      id: GLOBE_CACHE_KEY,
      expeditions,
      cachedAt: Date.now(),
    });
  } catch (err) {
    // Best-effort — a failed cache write shouldn't break the live page.
    console.warn('[NCPOR globeCache] failed to cache expedition list', err);
  }
}

// Returns { expeditions, cachedAt } or null if nothing has been cached yet.
export async function getCachedGlobeExpeditions() {
  try {
    const db = await getDb();
    const row = await db.get(STORE_GLOBE_CACHE, GLOBE_CACHE_KEY);
    return row ?? null;
  } catch (err) {
    console.warn('[NCPOR globeCache] failed to read cached expedition list', err);
    return null;
  }
}
