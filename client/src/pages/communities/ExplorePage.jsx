import React, { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Eye, Lock, Plus, Search } from 'lucide-react';
import { fetchCommunities } from '../../api/communities.js';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { formatCount } from '../../components/communities/utils.js';
import { JoinButton } from './CommunityPage.jsx';

// Explore — browse every community, filter by topic, join from the card.
export default function ExplorePage() {
  const { canCreateCommunity, openCreateCommunity } = useOutletContext();
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState('members');
  const [data, setData] = useState(null);
  const [topics, setTopics] = useState([]);

  async function load() {
    try {
      const res = await fetchCommunities({ q: q.trim() || undefined, topic: topic || undefined, sort, limit: 60 });
      setData(res.communities);
      if (!topic && !q) setTopics(res.topics);
    } catch { setData([]); }
  }

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, topic, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Explore Communities</h1>
        {canCreateCommunity && <button type="button" onClick={openCreateCommunity} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5"><Plus className="h-4 w-4" /> Start a community</button>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter communities" className="w-full bg-transparent py-2 text-sm text-white outline-none" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-full border border-white/10 bg-[#0f2530] px-3 py-2 text-sm text-slate-200 outline-none">
          <option value="members">Most members</option>
          <option value="new">Newest</option>
        </select>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        <button type="button" onClick={() => setTopic('')} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${!topic ? 'bg-white text-[#0a1c24] font-semibold' : 'bg-white/[0.07] text-slate-300 hover:bg-white/10'}`}>All</button>
        {topics.map((t) => (
          <button key={t} type="button" onClick={() => setTopic(t)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${topic === t ? 'bg-white text-[#0a1c24] font-semibold' : 'bg-white/[0.07] text-slate-300 hover:bg-white/10'}`}>{t}</button>
        ))}
      </div>

      {data === null ? <p className="py-16 text-center text-sm text-slate-500">Loading…</p> : data.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">{canCreateCommunity ? 'No communities match. Why not start one?' : 'No communities match your filters.'}</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <div key={c.id} className="flex flex-col rounded-2xl border border-white/10 bg-[#0c222b] p-4 hover:border-white/20">
              <div className="flex items-start gap-3">
                <CommunityIcon community={c} size={40} />
                <Link to={`/communities/c/${c.slug}`} className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate font-semibold text-white hover:underline">
                    c/{c.slug}
                    {c.type === 'private' && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                    {c.type === 'restricted' && <Eye className="h-3.5 w-3.5 text-slate-400" />}
                  </span>
                  <span className="block text-xs text-slate-500">{formatCount(c.memberCount)} members · {c.topic}</span>
                </Link>
                <JoinButton community={c} onChange={load} />
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-400">{c.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
