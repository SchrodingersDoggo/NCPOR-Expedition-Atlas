import { useEffect, useState } from 'react';

// Phase 8 — smooths the raw detected quality before it reaches rendering,
// specifically to stop the landing page's globe from being torn down and
// remounted every time a borderline connection flickers between two tiers.
//
// The two directions are handled differently on purpose, per the Phase 8
// spec: a connection getting WORSE should be reacted to immediately (an
// expensive globe/full-quality photo shouldn't keep loading a moment longer
// than necessary once things look bad), but a connection getting BETTER
// only takes effect once it's held for a bit — a brief blip back to "fast"
// in the middle of an otherwise slow session shouldn't yo-yo the globe back
// in and immediately back out again.
//
// 'offline' is excluded from this smoothing entirely: it comes from the
// browser's real online/offline events (Phase 1), not a noisy RTT/downlink
// estimate, so there's nothing to debounce — it always applies immediately
// in both directions.
const QUALITY_RANK = { slow: 0, medium: 1, fast: 2 };
const UPGRADE_STABILIZE_MS = 4000;

export function useStableNetworkQuality(detectedQuality) {
  const [stable, setStable] = useState(detectedQuality);

  useEffect(() => {
    if (detectedQuality === 'offline' || stable === 'offline') {
      setStable(detectedQuality);
      return;
    }

    if (detectedQuality === stable) return;

    const isImprovement = QUALITY_RANK[detectedQuality] > QUALITY_RANK[stable];

    if (!isImprovement) {
      // Degrading — apply right away, no waiting.
      setStable(detectedQuality);
      return;
    }

    // Improving — only commit to it if it holds for UPGRADE_STABILIZE_MS.
    // If detectedQuality (or stable, once it changes) changes again before
    // this fires, React's effect cleanup below clears this timer first.
    const timer = setTimeout(() => setStable(detectedQuality), UPGRADE_STABILIZE_MS);
    return () => clearTimeout(timer);
  }, [detectedQuality, stable]);

  return stable;
}

export default useStableNetworkQuality;
