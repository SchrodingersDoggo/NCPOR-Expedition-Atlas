import { useEffect, useRef, useState } from 'react';

const CONNECTION_KEYS = ['connection', 'mozConnection', 'webkitConnection'];

function getConnection() {
  if (typeof navigator === 'undefined') return null;

  for (const key of CONNECTION_KEYS) {
    if (navigator[key]) return navigator[key];
  }

  return null;
}

/**
 * Classify the current connection without changing any UI.
 *
 * Phase 1 deliberately keeps this logic local to the hook. A global context
 * belongs to Phase 2.
 */
export function classifyNetwork({ online, effectiveType, downlink, rtt, saveData }) {
  if (!online) return 'offline';

  // Respect the browser/user request to minimize data usage.
  if (saveData) return 'slow';

  const type = String(effectiveType || '').toLowerCase();

  if (type === 'slow-2g' || type === '2g') return 'slow';

  // Very weak measured links are slow even when effectiveType briefly says 3g/4g.
  if (typeof downlink === 'number' && downlink > 0 && downlink < 0.75) return 'slow';
  if (typeof rtt === 'number' && rtt >= 700) return 'slow';

  if (type === '3g') return 'medium';
  if (typeof downlink === 'number' && downlink > 0 && downlink < 2.5) return 'medium';
  if (typeof rtt === 'number' && rtt >= 300) return 'medium';

  // If the Network Information API is unavailable, preserve the current full
  // site instead of incorrectly degrading the experience. On browsers that
  // don't implement the API at all (Firefox, Safari), useNetworkQuality
  // below replaces this default with an actively-measured value instead.
  return 'fast';
}

function readNetworkSnapshot() {
  const connection = getConnection();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  const snapshot = {
    online,
    effectiveType: connection?.effectiveType ?? null,
    downlink: typeof connection?.downlink === 'number' ? connection.downlink : null,
    rtt: typeof connection?.rtt === 'number' ? connection.rtt : null,
    saveData: Boolean(connection?.saveData),
    supported: Boolean(connection),
  };

  return {
    ...snapshot,
    quality: classifyNetwork(snapshot),
  };
}

// --- Active probe fallback (Firefox / Safari) ------------------------------
// Firefox has never shipped the Network Information API and Safari doesn't
// either, so getConnection() returns null there and readNetworkSnapshot()
// always falls back to 'fast' — the classifier has nothing to measure. This
// fills that gap the only way possible without a browser-native API: time a
// same-origin download and turn that into an estimated downlink, which
// feeds into the exact same classifyNetwork() used everywhere else.

// A dedicated 200KB random-byte payload, not favicon.svg. A file as small
// as the favicon (~9.5KB) measures mostly request/response overhead
// (server processing, round-trip latency) rather than actual transfer
// speed — even a genuinely fast connection reads as slow-ish that way,
// since there's barely enough data for bandwidth to matter. 200KB gives
// bandwidth room to actually show up in the timing. Random bytes are used
// so the file doesn't compress well — if it did, a server with gzip/
// brotli enabled could transmit far fewer bytes than its on-disk size,
// and Resource Timing's transferSize would then understate what a real
// (larger, less compressible) asset would cost to load.
const PROBE_URL = '/probe-payload.bin';
// Below this, a fetch that's still pending is itself evidence of a very
// slow link — don't wait indefinitely for an accurate byte count. Sized
// for the 200KB payload: generous enough for a genuinely slow-but-usable
// connection (a few hundred kbps) to finish, short enough that a true
// worst case (e.g. ~9 KB/s) doesn't leave the user waiting a long time
// just to confirm what's already obvious well before it would complete.
const PROBE_TIMEOUT_MS = 8000;
// Re-probe periodically so a connection that degrades (or recovers) mid-
// session is eventually noticed — only relevant on browsers already paying
// the probe cost, since supported browsers get this for free from the OS.
const PROBE_INTERVAL_MS = 60_000;

async function probeDownlinkMbps() {
  if (typeof fetch === 'undefined') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // Give this probe's request a unique URL, both to defeat any caching and
  // so its Resource Timing entry below is unambiguous to find afterwards.
  const url = `${PROBE_URL}?probe=${Date.now()}`;
  // Keep the browser's timing buffer small so a long session doesn't fill
  // it up and start silently dropping entries this probe needs to read.
  performance.clearResourceTimings?.();

  try {
    // Warm-up request, deliberately not timed. Fetching a small file cold
    // spends most of its time on TCP/TLS handshake, not actual transfer —
    // that overhead would make even a fast connection look artificially
    // slow. This first request pays that cost; the browser reuses the same
    // connection (keep-alive) for the timed request right after, so the
    // measurement below reflects transfer speed, not connection setup.
    // Bounded by its own short timeout so a truly dead connection can't
    // hang here indefinitely before the real, timed attempt even starts.
    const warmupController = new AbortController();
    const warmupTimeout = setTimeout(() => warmupController.abort(), PROBE_TIMEOUT_MS / 2);
    await fetch(`${PROBE_URL}?warmup=${Date.now()}`, {
      cache: 'no-store',
      signal: warmupController.signal,
    }).catch(() => {});
    clearTimeout(warmupTimeout);

    const wallClockStart = performance.now();
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;

    const blob = await response.blob();
    const wallClockElapsedSeconds = (performance.now() - wallClockStart) / 1000;
    if (blob.size <= 0) return null;

    // Prefer the browser's own network-layer timing over the wall-clock
    // measurement above. The wall-clock version times how long the JS
    // engine took to notice the fetch finished — on a page doing heavy
    // main-thread work (e.g. the 3D globe animating), that can make a fast
    // connection look artificially slow, since the delay is CPU
    // contention, not network transfer time. Resource Timing records when
    // bytes actually moved over the network, independent of how busy the
    // main thread was at that moment.
    // Resource Timing entries are always keyed by the fully-resolved
    // absolute URL, never the relative path passed to fetch() — querying
    // with the relative form here silently never matched anything, which
    // is why every probe was falling back to the wall-clock measurement
    // regardless of actual connection speed.
    const absoluteUrl = new URL(url, window.location.origin).toString();
    const entry = performance.getEntriesByName?.(absoluteUrl)?.pop();
    const networkElapsedSeconds = entry ? (entry.responseEnd - entry.requestStart) / 1000 : null;
    const transferBytes = entry?.transferSize > 0 ? entry.transferSize : blob.size;

    const usedNetworkTiming = networkElapsedSeconds > 0;
    const elapsedSeconds = usedNetworkTiming ? networkElapsedSeconds : wallClockElapsedSeconds;
    if (elapsedSeconds <= 0) return null;

    const bits = transferBytes * 8;
    return {
      downlinkMbps: bits / elapsedSeconds / 1_000_000, // same unit downlink uses
      // Diagnostic only — lets us see which measurement path actually ran,
      // instead of guessing from the number alone.
      method: usedNetworkTiming ? 'resource-timing' : 'wall-clock-fallback',
      resourceTimingEntryFound: Boolean(entry),
      wallClockMs: Math.round(wallClockElapsedSeconds * 1000),
      networkTimingMs: networkElapsedSeconds != null ? Math.round(networkElapsedSeconds * 1000) : null,
      transferBytes,
    };
  } catch (err) {
    // A timeout is itself meaningful: taking longer than PROBE_TIMEOUT_MS
    // to transfer 200KB is already conclusive evidence of a slow link —
    // no need to know the exact number to know which classification bucket
    // it belongs in. Report a synthetic downlink low enough to guarantee
    // classifyNetwork() reads it as 'slow', rather than discarding a
    // timeout as "no data" and leaving the UI on whatever it showed
    // before, which is the one outcome that's actively wrong: silence on
    // exactly the connection this whole fallback exists to catch.
    if (err?.name === 'AbortError') {
      const worstCaseSeconds = PROBE_TIMEOUT_MS / 1000;
      const bits = 1000 * 8; // a small, conservative floor — well under a byte count that could look "fast"
      return { downlinkMbps: bits / worstCaseSeconds / 1_000_000, method: 'timeout' };
    }
    // Offline, CORS, or some other network failure — no reliable number.
    return { downlinkMbps: null, method: 'error', error: String(err?.message || err) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Phase 1 network detector.
 * Returns live connection information and one of:
 * fast | medium | slow | offline
 */
export function useNetworkQuality() {
  const [network, setNetwork] = useState(readNetworkSnapshot);
  // Distinguishes a still-valid effect run from a stale one. React 18
  // StrictMode (development only) mounts this effect, cleans it up, then
  // mounts it again immediately — before the first run's async probe has
  // necessarily resolved. A shared in-flight boolean broke here: the first
  // run's probe would still be marked "in flight" when the second run
  // started, so the second run's own probe skipped itself entirely, and
  // when the first run's probe finally resolved, its own cleanup had
  // already marked it stale — so its result was silently discarded too.
  // Net effect: the probe ran once and its answer went nowhere. An epoch
  // counter fixes this correctly for both StrictMode's synthetic double-
  // mount and any genuine unmount: each effect run gets its own id, and a
  // probe only applies its result if that id is still the current one when
  // it resolves.
  const epochRef = useRef(0);

  useEffect(() => {
    const connection = getConnection();
    const myEpoch = ++epochRef.current;
    let inFlight = false;

    const updateNetwork = () => {
      const next = readNetworkSnapshot();
      setNetwork(next);

      // Temporary Phase 1 debug output. No visible UI changes yet.
      console.debug('[NCPOR network]', {
        quality: next.quality,
        online: next.online,
        effectiveType: next.effectiveType,
        downlinkMbps: next.downlink,
        rttMs: next.rtt,
        saveData: next.saveData,
        networkInformationApiSupported: next.supported,
      });
    };

    const runProbe = async () => {
      // Native API present (Chrome/Edge/Android) — that's free and instant;
      // never spend a real network request duplicating it.
      if (connection) return;
      if (!navigator.onLine) return;
      if (inFlight) return;

      inFlight = true;
      const result = await probeDownlinkMbps();
      inFlight = false;
      // A newer effect run has started since this probe began (StrictMode's
      // double-mount, or a genuine unmount) — this result is stale, drop it.
      if (epochRef.current !== myEpoch || !result || result.downlinkMbps == null) {
        if (result) {
          console.debug('[NCPOR network] (probe produced no usable result)', result);
        }
        return;
      }

      const snapshot = {
        online: navigator.onLine,
        effectiveType: null,
        downlink: result.downlinkMbps,
        rtt: null,
        saveData: false,
        supported: false,
      };
      const next = { ...snapshot, quality: classifyNetwork(snapshot) };
      setNetwork(next);

      console.debug('[NCPOR network] (probed — no native API)', {
        quality: next.quality,
        estimatedDownlinkMbps: result.downlinkMbps,
        method: result.method,
        resourceTimingEntryFound: result.resourceTimingEntryFound,
        wallClockMs: result.wallClockMs,
        networkTimingMs: result.networkTimingMs,
        transferBytes: result.transferBytes,
      });
    };

    updateNetwork();
    runProbe();

    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    connection?.addEventListener?.('change', updateNetwork);
    // Coming back online is exactly when a stale probe result is most
    // likely wrong (could be a different network entirely) — re-probe then,
    // same way updateNetwork already reacts to that event for supported
    // browsers.
    window.addEventListener('online', runProbe);

    const intervalId = connection ? null : setInterval(runProbe, PROBE_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      connection?.removeEventListener?.('change', updateNetwork);
      window.removeEventListener('online', runProbe);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return network;
}

export default useNetworkQuality;
