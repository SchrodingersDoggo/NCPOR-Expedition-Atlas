import React, { useEffect, useMemo, useState } from 'react';
import { Database, Image as ImageIcon, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchResearchers } from '../api/researchers.js';

export default function ResearchersPage() {
  const [researchers, setResearchers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResearchers().then(setResearchers).catch(() => setResearchers([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return researchers;
    return researchers.filter((r) => `${r.name} ${r.organization || ''}`.toLowerCase().includes(q));
  }, [query, researchers]);

  return (
    <main className="min-h-screen bg-[#061820] text-white px-6 py-12">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Explorer</p>
          <h1 className="text-4xl font-bold mt-2">Researchers</h1>
          <p className="text-slate-400 mt-2 max-w-2xl">Explore the researchers contributing to NCPOR expeditions, datasets, photographs, and reports.</p>
        </div>

        <div className="relative max-w-xl mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search researchers..." className="w-full rounded-xl border border-slate-700 bg-[#0a1b23] pl-11 pr-4 py-3 text-sm text-white outline-none focus:border-cyan-500" />
        </div>

        {loading ? <p className="text-slate-500">Loading researchers…</p> : filtered.length === 0 ? <p className="text-slate-500">No researchers found.</p> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {filtered.map((researcher) => (
              <Link key={researcher.id} to={`/researchers/${researcher.id}`} className="group overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1b23] hover:border-cyan-500/50 transition">
                <div className="aspect-square bg-[#102936] flex items-center justify-center overflow-hidden">
                  {researcher.avatarUrl ? <img src={researcher.avatarUrl} alt={researcher.name} className="w-full h-full object-cover group-hover:scale-105 transition" /> : <UserRound className="w-16 h-16 text-slate-500" />}
                </div>
                <div className="p-4">
                  <h2 className="font-semibold text-white truncate">{researcher.name}</h2>
                  <p className="text-xs text-slate-500 mt-1 truncate">{researcher.organization || 'NCPOR'}</p>
                  <div className="grid grid-cols-3 gap-2 mt-4 text-[11px] text-slate-400">
                    <span>{researcher.stats?.expeditions || 0}<br />Expeditions</span>
                    <span><Database className="w-3 h-3 inline" /> {researcher.stats?.datasets || 0}<br />Datasets</span>
                    <span><ImageIcon className="w-3 h-3 inline" /> {researcher.stats?.photos || 0}<br />Photos</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
