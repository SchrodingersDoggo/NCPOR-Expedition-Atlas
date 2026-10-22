import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchCommunities } from '../../api/communities.js';
import PostCard from '../../components/communities/PostCard.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import Avatar from '../../components/communities/Avatar.jsx';
import { formatCount } from '../../components/communities/utils.js';
import { JoinButton } from './CommunityPage.jsx';

const TABS = [['posts', 'Posts'], ['communities', 'Communities'], ['people', 'People']];

export default function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const type = params.get('type') || 'posts';
  const [data, setData] = useState(null);

  async function load() {
    setData(null);
    try { setData(await searchCommunities(q, type, 25)); } catch { setData({ communities: [], posts: [], people: [] }); }
  }
  useEffect(() => { if (q) load(); }, [q, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = data?.[type] || [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg text-slate-300">Search results for <span className="font-bold text-white">“{q}”</span></h1>
      <div className="mt-3 flex gap-1">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setParams({ q, type: id })} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${type === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`}>{label}</button>
        ))}
      </div>

      {data === null ? <p className="py-16 text-center text-sm text-slate-500">Searching…</p> : list.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">No {type} found for “{q}”. Try different keywords or a #tag.</p>
      ) : (
        <div className="mt-3 divide-y divide-white/10">
          {type === 'posts' && list.map((p) => <PostCard key={p.id} post={p} onDeleted={load} />)}
          {type === 'communities' && list.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-3">
              <CommunityIcon community={c} size={40} />
              <Link to={`/communities/c/${c.slug}`} className="min-w-0 flex-1">
                <span className="block font-semibold text-white hover:underline">c/{c.slug}</span>
                <span className="block truncate text-xs text-slate-500">{formatCount(c.memberCount)} members · {c.description}</span>
              </Link>
              <JoinButton community={c} onChange={load} />
            </div>
          ))}
          {type === 'people' && list.map((p) => (
            <Link key={p.id} to={`/communities/u/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-white/[0.03]">
              <Avatar user={p} size={40} />
              <span><span className="block font-semibold text-white">u/{p.name}</span><span className="block text-xs text-slate-500">{p.organization} · {p.role?.replace('_', ' ')}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
