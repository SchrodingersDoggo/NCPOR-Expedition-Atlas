import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchRecentAlerts } from '../api/alerts.js';
import DangerAlertToast from '../components/DangerAlertToast.jsx';
import { playAlertSound } from '../utils/alertSound.js';

// No WebSocket/push service — the app deploys to Vercel's serverless
// functions, which don't hold a long-lived connection, and a 30-60s delay
// is acceptable for danger-status awareness. Polling is the simple choice
// that needs no extra infrastructure.
const POLL_INTERVAL_MS = 45_000;

export function useAlertNotifications() {
  const { isAuthenticated } = useAuth();
  // Starts at "now" on purpose: on sign-in/page load this should only ever
  // surface alerts reported from this point forward, not replay history.
  const lastCheckedRef = useRef(new Date().toISOString());

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let cancelled = false;

    async function poll() {
      try {
        const { alerts, checkedAt } = await fetchRecentAlerts(lastCheckedRef.current);
        if (cancelled) return;

        for (const alert of alerts) {
          playAlertSound();
          toast.custom((t) => <DangerAlertToast t={t} alert={alert} />, {
            id: alert.id,
            duration: 20_000,
          });
        }

        // Advance the watermark even when nothing new came back, so a brief
        // request failure doesn't leave it stuck at the same instant forever.
        lastCheckedRef.current = checkedAt;
      } catch {
        // A missed poll on a weak connection just means the next tick
        // (still `POLL_INTERVAL_MS` away) catches up — no need to surface
        // a network error for a background check.
      }
    }

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isAuthenticated]);
}
