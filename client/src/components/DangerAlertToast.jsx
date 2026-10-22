import React from 'react';
import toast from 'react-hot-toast';
import { TriangleAlert, X } from 'lucide-react';
import { dangerTypeLabel } from '../api/alerts.js';

// Rendered via toast.custom() — a "prominent notification" that stays up
// until dismissed rather than auto-fading like a normal toast, since this
// is carrying a danger report, not routine feedback.
export default function DangerAlertToast({ t, alert }) {
  return (
    <div
      className={`w-full max-w-sm rounded-xl border border-red-700/70 bg-[#1a0f10] p-4 text-white shadow-xl transition-all ${
        t.visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-red-400 font-semibold">
          <TriangleAlert className="w-4 h-4" /> DANGER ALERT
        </div>
        <button onClick={() => toast.dismiss(t.id)} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 space-y-1 text-sm text-slate-200">
        <p><span className="text-slate-400">Location:</span> {alert.expedition?.name || 'Unknown'}</p>
        <p><span className="text-slate-400">Type:</span> {dangerTypeLabel(alert.type)}</p>
        {alert.message && <p className="italic text-slate-300">&ldquo;{alert.message}&rdquo;</p>}
        <p><span className="text-slate-400">Reported by:</span> {alert.reporter?.name || 'Unknown'}</p>
        <p><span className="text-slate-400">Time:</span> {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </div>
  );
}
