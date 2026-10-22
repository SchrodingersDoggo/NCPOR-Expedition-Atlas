import React, { createContext, useContext, useMemo, useCallback, useState } from 'react';
import { useNetworkQuality } from '../hooks/useNetworkQuality.js';
import { useStableNetworkQuality } from '../hooks/useStableNetworkQuality.js';
import { getStoredNetworkMode, setStoredNetworkMode, NETWORK_MODES } from '../offline/networkPreference.js';

/**
 * Phase 2 — centralized rendering policy.
 *
 * IMPORTANT: these capabilities are only exposed here in Phase 2. Components
 * do not consume them yet, so the visible site stays exactly as it was.
 * Later phases can read these flags instead of duplicating network rules.
 */
const NETWORK_POLICIES = Object.freeze({
  fast: Object.freeze({
    mode: 'fast',
    renderLevel: 'full',
    heavyVisuals: true,
    animations: 'full',
    decorativeEffects: 'full',
    imageQuality: 'full',
    globeMode: 'full',
    externalHeavyAssets: true,
  }),
  medium: Object.freeze({
    mode: 'medium',
    renderLevel: 'reduced',
    heavyVisuals: true,
    animations: 'reduced',
    decorativeEffects: 'reduced',
    imageQuality: 'reduced',
    globeMode: 'reduced',
    externalHeavyAssets: true,
  }),
  slow: Object.freeze({
    mode: 'slow',
    renderLevel: 'lightweight',
    heavyVisuals: false,
    animations: 'minimal',
    decorativeEffects: 'minimal',
    imageQuality: 'lightweight',
    globeMode: 'lightweight',
    externalHeavyAssets: false,
  }),
  offline: Object.freeze({
    mode: 'offline',
    renderLevel: 'offline',
    heavyVisuals: false,
    animations: 'minimal',
    decorativeEffects: 'minimal',
    imageQuality: 'cached-only',
    globeMode: 'offline',
    externalHeavyAssets: false,
  }),
});

const NetworkContext = createContext(null);

export function NetworkProvider({ children }) {
  const network = useNetworkQuality(); // real, detected values — Phase 1's hook, never overridden here
  const [mode, setModeState] = useState(getStoredNetworkMode);

  // Phase 8 — debounced/asymmetric version of the detected quality, used
  // only for the 'auto' path below. A manual Full Quality / Low Bandwidth
  // choice (Phase 7) is a deliberate action and always applies instantly,
  // so it deliberately bypasses this smoothing.
  const stableDetectedQuality = useStableNetworkQuality(network.quality);

  const setMode = useCallback((next) => {
    setModeState(next);
    setStoredNetworkMode(next);
  }, []);

  const value = useMemo(() => {
    const detectedQuality = network.quality;

    // Phase 7 — Manual Mode. A genuinely offline connection always wins over
    // any manual choice: forcing "full quality" with no connection at all
    // wouldn't deliver full quality, it would just mean image/texture
    // requests that can never complete. Manual mode only ever chooses
    // between fast and slow while actually connected — 'auto' keeps
    // today's behavior of trusting the detected value, smoothed per Phase 8.
    const quality = detectedQuality === 'offline'
      ? 'offline'
      : mode === NETWORK_MODES.FULL
        ? 'fast'
        : mode === NETWORK_MODES.LOW_BANDWIDTH
          ? 'slow'
          : stableDetectedQuality;

    const policy = NETWORK_POLICIES[quality] ?? NETWORK_POLICIES.fast;

    return {
      ...network,
      quality,
      detectedQuality,
      mode,
      setMode,
      policy,
      isFast: quality === 'fast',
      isMedium: quality === 'medium',
      isSlow: quality === 'slow',
      isOffline: quality === 'offline',
    };
  }, [network, mode, setMode, stableDetectedQuality]);

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);

  if (!context) {
    throw new Error('useNetwork must be used inside <NetworkProvider>.');
  }

  return context;
}

export { NETWORK_POLICIES };
export default NetworkContext;
