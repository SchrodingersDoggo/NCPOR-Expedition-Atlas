import React from 'react';
import { Clock, Flame, Trophy } from 'lucide-react';

const SORTS = [
  { id: 'hot', label: 'Hot', icon: Flame },
  { id: 'new', label: 'New', icon: Clock },
  { id: 'top', label: 'Top', icon: Trophy },
];
const WINDOWS = [['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];

export default function SortBar({ sort, t, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/10 pb-2">
      {SORTS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onChange({ sort: id, t })} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${sort === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
          <Icon className="h-4 w-4" /> {label}
        </button>
      ))}
      {sort === 'top' && (
        <select value={t} onChange={(e) => onChange({ sort, t: e.target.value })} className="ml-1 rounded-full border border-white/10 bg-[#0f2530] px-3 py-1.5 text-xs text-slate-200 outline-none">
          {WINDOWS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      )}
    </div>
  );
}
