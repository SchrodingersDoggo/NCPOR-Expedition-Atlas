import React from 'react';
import { Circle } from 'lucide-react';

const DANGER_STYLES = {
  low: { label: 'LOW', color: '#34d399', border: 'border-emerald-700/60', text: 'text-emerald-300' },
  moderate: { label: 'MODERATE', color: '#fbbf24', border: 'border-amber-700/60', text: 'text-amber-300' },
  high: { label: 'HIGH', color: '#fb923c', border: 'border-orange-700/60', text: 'text-orange-300' },
  critical: { label: 'CRITICAL', color: '#f87171', border: 'border-red-700/60', text: 'text-red-300' },
};

export default function DangerBadge({ level }) {
  const style = DANGER_STYLES[level] || DANGER_STYLES.low;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${style.border} ${style.text}`}>
      <Circle className="w-2.5 h-2.5" fill={style.color} stroke="none" />
      {style.label}
    </div>
  );
}
