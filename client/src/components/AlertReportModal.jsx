import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { TriangleAlert, X, MapPin, Loader2 } from 'lucide-react';
import { DANGER_TYPES, reportAlert } from '../api/alerts.js';

// Best-effort GPS capture. A denied/unavailable location must never block
// sending an emergency alert — it's just left null and the report still goes.
function captureLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function AlertReportModal({ expeditionId, onClose, onSent }) {
  const [type, setType] = useState('medical');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(true);
  const [sending, setSending] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    captureLocation().then((loc) => {
      if (!cancelled) {
        setLocation(loc);
        setLocating(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function send() {
    setSending(true);
    try {
      const alert = await reportAlert(expeditionId, {
        type,
        message,
        latitude: location?.latitude,
        longitude: location?.longitude,
        clientRequestId: crypto.randomUUID(),
      });
      toast.success('Alert sent.');
      onSent?.(alert);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the alert. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-red-800/60 bg-[#0f1f2b] p-6 text-white">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-red-400">
            <TriangleAlert className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Emergency Alert</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block text-sm text-slate-300">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b1c25] p-3 text-white"
            >
              {DANGER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="What's happening?"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b1c25] p-3 text-white"
            />
          </label>

          <div className="flex items-center gap-2 text-sm text-slate-400">
            <MapPin className="w-4 h-4 shrink-0" />
            {locating ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting location…</span>
            ) : location ? (
              <span>{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</span>
            ) : (
              <span>Location unavailable — alert will still be sent.</span>
            )}
          </div>
        </div>

        <button
          disabled={sending || locating}
          onClick={send}
          className="mt-6 w-full rounded-lg bg-red-700 px-5 py-3 font-semibold hover:bg-red-600 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send Alert'}
        </button>
      </div>
    </div>
  );
}
