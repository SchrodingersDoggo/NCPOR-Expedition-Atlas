import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { searchCommunities } from '../../api/communities.js';
import { useNetwork } from '../../context/NetworkContext.jsx';
import CommunityIcon from './CommunityIcon.jsx';
import Avatar from './Avatar.jsx';
import { formatCount } from './utils.js';

// Reddit-style search box with a typeahead dropdown (communities, people,
// posts). Debounced; the previous request is aborted when you keep typing.
// In low-bandwidth mode the typeahead is skipped — Enter runs the search.
export default function SearchBar() {
  const navigate = useNavigate();
  const { isSlow, isOffline } = useNetwork();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || isSlow || isOffline) { setResults(null); return undefined; }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        setResults(await searchCommunities(term, 'all', 4, controller.signal));
      } catch (err) {
        if (err.name !== 'CanceledError') setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, isSlow, isOffline]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  function submit(e) {
    e.preventDefault();
    const term = q.trim();
    if (term) go(`/communities/search?q=${encodeURIComponent(term)}`);
  }

  const hasResults = results && (results.communities.length || results.people.length || results.posts.length);

  return (
    <div className="relative w-full max-w-xl">
      <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 focus-within:border-cyan-300/50 focus-within:bg-white/[0.09]">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search communities, posts, researchers"
          className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-slate-500"
        />
        {q && <button type="button" onClick={() => { setQ(''); setResults(null); }} aria-label="Clear"><X className="h-4 w-4 text-slate-400 hover:text-white" /></button>}
      </form>

      {open && q.trim().length >= 2 && (
        <>
          <button type="button" aria-label="Close search" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f2530] py-2 shadow-2xl">
            {loading && !results && <p className="px-4 py-3 text-xs text-slate-500">Searching…</p>}
            {(isSlow || isOffline) && <p className="px-4 py-2 text-xs text-slate-500">{isOffline ? 'Search needs a connection.' : 'Low-bandwidth mode: press Enter to search.'}</p>}
            {results?.communities.length > 0 && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Communities</p>}
            {results?.communities.map((c) => (
              <button key={c.id} type="button" onClick={() => go(`/communities/c/${c.slug}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5">
                <CommunityIcon community={c} size={28} />
                <span className="min-w-0"><span className="block truncate text-sm text-white">c/{c.slug}</span><span className="block text-xs text-slate-500">{formatCount(c.memberCount)} members · {c.type}</span></span>
              </button>
            ))}
            {results?.people.length > 0 && <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">People</p>}
            {results?.people.map((p) => (
              <button key={p.id} type="button" onClick={() => go(`/communities/u/${p.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5">
                <Avatar user={p} size={28} />
                <span className="min-w-0"><span className="block truncate text-sm text-white">u/{p.name}</span><span className="block truncate text-xs text-slate-500">{p.organization}</span></span>
              </button>
            ))}
            {results?.posts.length > 0 && <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Posts</p>}
            {results?.posts.map((p) => (
              <button key={p.id} type="button" onClick={() => go(`/communities/post/${p.id}`)} className="block w-full px-4 py-2 text-left hover:bg-white/5">
                <span className="block truncate text-sm text-white">{p.title}</span>
                <span className="block text-xs text-slate-500">{p.circle ? `c/${p.circle.slug}` : 'News'} · {formatCount(p.score)} votes · {p.commentCount} comments</span>
              </button>
            ))}
            {results && !hasResults && <p className="px-4 py-3 text-sm text-slate-500">No quick matches.</p>}
            <button type="button" onClick={submit} className="mt-1 flex w-full items-center gap-3 border-t border-white/5 px-4 py-2.5 text-left text-sm text-cyan-300 hover:bg-white/5">
              <Search className="h-4 w-4" /> Search for “{q.trim()}”
            </button>
          </div>
        </>
      )}
    </div>
  );
}
