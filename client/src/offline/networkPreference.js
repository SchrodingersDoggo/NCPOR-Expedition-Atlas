// Phase 7 — Manual Mode preference storage.
//
// This module only reads/writes the researcher's chosen mode — it has no
// opinion on network detection or rendering policy. NetworkContext.jsx stays
// the single place that turns a mode into an actual effective quality/policy,
// exactly like it already does for the auto-detected value from Phase 1.

const STORAGE_KEY = 'ncpor_network_mode';

export const NETWORK_MODES = Object.freeze({
  AUTO: 'auto',
  FULL: 'full',
  LOW_BANDWIDTH: 'low-bandwidth',
});

const VALID_MODES = new Set(Object.values(NETWORK_MODES));

export function getStoredNetworkMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.has(stored) ? stored : NETWORK_MODES.AUTO;
  } catch {
    // Private browsing / storage disabled — fall back to auto rather than crash.
    return NETWORK_MODES.AUTO;
  }
}

export function setStoredNetworkMode(mode) {
  if (!VALID_MODES.has(mode)) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best-effort — a failed write just means the choice won't survive a
    // reload; it still applies for the rest of the current session.
  }
}
