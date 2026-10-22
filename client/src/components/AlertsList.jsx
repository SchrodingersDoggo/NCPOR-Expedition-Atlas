import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle } from 'lucide-react';
import { fetchAlerts, resolveAlert, dangerTypeLabel } from '../api/alerts.js';
import { useAuth } from '../context/AuthContext.jsx';

// Only these roles can resolve — matches the server-side authorize() check
// on the resolve route. Reporting stays open to researchers too; clearing
// a danger status deliberately does not.
const CAN_RESOLVE_ROLES = ['comms_officer', 'admin'];

export default function AlertsList({ expeditionId, onDangerLevelChange }) {
  const { user } = useAuth();
  const canResolve = CAN_RESOLVE_ROLES.includes(user?.role);
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAlerts(expeditionId)
      .then((data) => {
        if (!cancelled) {
          setAlerts(data);
          setStatus('ready');
        }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [expeditionId]);

  async function handleResolve(alertId) {
    setResolvingId(alertId);
    try {
      const updated = await resolveAlert(expeditionId, alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
      if (updated.expedition?.dangerLevel) onDangerLevelChange?.(updated.expedition.dangerLevel);
      toast.success('Alert resolved.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not resolve this alert.');
    } finally {
      setResolvingId(null);
    }
  }

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading alert history…</p>;
  if (status === 'error') return <p className="text-sm text-red-400">Could not load alert history.</p>;
  if (alerts.length === 0) return <p className="text-sm text-slate-500">No alerts reported for this expedition yet.</p>;

  return (
    <ul className="space-y-2">
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={`rounded-lg border p-3 text-sm ${alert.resolved ? 'border-slate-800 bg-[#0b1c25]/60' : 'border-red-800/50 bg-red-950/20'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {alert.resolved ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-red-400 shrink-0" fill="currentColor" />
                )}
                <span className="font-medium text-white">{dangerTypeLabel(alert.type)}</span>
                <span className="text-xs text-slate-500">{new Date(alert.createdAt).toLocaleString()}</span>
              </div>
              {alert.message && <p className="mt-1 text-slate-300">{alert.message}</p>}
              <p className="mt-1 text-xs text-slate-500">
                Reported by {alert.reporter?.name || 'Unknown'}
                {alert.resolved && (
                  <> · Resolved by {alert.resolver?.name || 'Unknown'} at {new Date(alert.resolvedAt).toLocaleString()}</>
                )}
              </p>
            </div>
            {!alert.resolved && canResolve && (
              <button
                onClick={() => handleResolve(alert.id)}
                disabled={resolvingId === alert.id}
                className="shrink-0 rounded-lg border border-emerald-700/60 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
              >
                {resolvingId === alert.id ? 'Resolving…' : 'Resolve'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
