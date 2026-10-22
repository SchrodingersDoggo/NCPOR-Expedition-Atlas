import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Newspaper, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { fetchCommunities, joinCommunity } from '../../api/communities.js';
import SortBar from '../../components/communities/SortBar.jsx';
import PostList from '../../components/communities/PostList.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { formatCount } from '../../components/communities/utils.js';

const COPY = {
  home: { title: 'Home', empty: 'Nothing here yet. Join communities from Explore and their posts will show up on Home.' },
  popular: { title: 'Popular', empty: 'No posts yet — be the first to start a discussion.' },
  news: { title: 'News', empty: 'No news yet. Researchers can share daily polar-science headlines here.' },
};

function PopularCommunities() {
  const [list, setList] = useState(null);
  const { refreshMine } = useOutletContext();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { fetchCommunities({ limit: 6 }).then((d) => setList(d.communities)).catch(() => setList([])); }, []);

  async function join(c) {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: '/communities' } } }); return; }
    const res = await joinCommunity(c.slug);
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, membership: { role: 'member', status: res.status } } : x)));
    refreshMine();
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Popular communities</h2>
      <div className="mt-3 space-y-1">
        {list === null && <p className="text-xs text-slate-500">Loading…</p>}
        {list?.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
            <CommunityIcon community={c} size={32} />
            <Link to={`/communities/c/${c.slug}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-200 hover:underline">c/{c.slug}</span>
              <span className="block text-[11px] text-slate-500">{formatCount(c.memberCount)} members</span>
            </Link>
            {!c.membership && <button type="button" onClick={() => join(c)} className="rounded-full bg-cyan-300 px-3 py-1 text-xs font-bold text-[#06202a] hover:bg-cyan-200">Join</button>}
          </div>
        ))}
      </div>
      <Link to="/communities/explore" className="mt-2 block text-center text-xs text-cyan-300 hover:underline">See more</Link>
    </section>
  );
}

export default function FeedPage({ feed }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [homeFallback, setHomeFallback] = useState(false);
  const sort = params.get('sort') || (feed === 'news' ? 'new' : 'hot');
  const t = params.get('t') || 'week';
  const canPostNews = user && ['researcher', 'comms_officer', 'admin'].includes(user.role);
  const copy = COPY[feed];

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 max-w-3xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            {feed === 'news' && <Newspaper className="h-5 w-5 text-[#ffb000]" />} {copy.title}
          </h1>
          {feed === 'news' && canPostNews && (
            <button type="button" onClick={() => navigate('/communities/submit?type=news')} className="inline-flex items-center gap-1.5 rounded-full bg-[#ffb000] px-4 py-2 text-sm font-bold text-[#1a1a1b] hover:bg-[#ffc233]">
              <Plus className="h-4 w-4" /> Post news
            </button>
          )}
        </div>
        {feed === 'home' && homeFallback && (
          <p className="mb-3 rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-4 py-3 text-sm text-slate-300">
            You haven't joined any communities yet, so here's what's popular. <Link to="/communities/explore" className="font-semibold text-cyan-300 hover:underline">Explore communities</Link>
          </p>
        )}
        <SortBar sort={sort} t={t} onChange={(next) => setParams(next.sort === 'top' ? next : { sort: next.sort })} />
        <PostList
          query={{ feed, sort, t: sort === 'top' ? t : undefined }}
          empty={copy.empty}
          onMeta={(d) => setHomeFallback(Boolean(d.homeFallback))}
        />
      </div>
      <aside className="hidden w-[300px] shrink-0 space-y-4 xl:block">
        {feed === 'news' ? (
          <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4 text-sm text-slate-400">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">About News</h2>
            <p className="mt-2 leading-6">Daily headlines from polar and climate science, shared by NCPOR researchers. Every item links to its original source — vote up what's most useful and discuss it in the comments.</p>
          </section>
        ) : <PopularCommunities />}
      </aside>
    </div>
  );
}
