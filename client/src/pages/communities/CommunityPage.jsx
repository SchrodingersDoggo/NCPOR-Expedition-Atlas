import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Eye, Globe, Lock, Plus, Shield, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext.jsx';
import { fetchCommunity, joinCommunity, leaveCommunity, setCommunityFavorite } from '../../api/communities.js';
import SortBar from '../../components/communities/SortBar.jsx';
import PostList from '../../components/communities/PostList.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { colorFor, formatCount, pushRecentCommunity } from '../../components/communities/utils.js';

const TYPE_META = {
  public: { icon: Globe, label: 'Public' },
  restricted: { icon: Eye, label: 'Restricted' },
  private: { icon: Lock, label: 'Private' },
};

export function JoinButton({ community, onChange }) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { refreshMine } = useOutletContext();
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = community.membership;

  async function click() {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: `/communities/c/${community.slug}` } } }); return; }
    setBusy(true);
    try {
      if (m) {
        const msg = m.status === 'pending' ? 'Cancel your join request?' : `Leave c/${community.slug}?`;
        if (!window.confirm(msg)) return;
        await leaveCommunity(community.slug);
        toast.success(m.status === 'pending' ? 'Request cancelled' : `Left c/${community.slug}`);
      } else {
        const res = await joinCommunity(community.slug);
        toast.success(res.status === 'pending' ? 'Join request sent to the moderators' : `Joined c/${community.slug}`);
      }
      await onChange?.();
      refreshMine();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const label = !m ? (community.type === 'public' ? 'Join' : 'Request to join')
    : m.status === 'pending' ? (hover ? 'Cancel request' : 'Requested')
      : hover ? 'Leave' : 'Joined';
  const style = !m ? 'bg-cyan-300 text-[#06202a] hover:bg-cyan-200' : 'border border-white/25 text-slate-100 hover:border-red-300/50 hover:text-red-200';

  return (
    <button type="button" disabled={busy} onClick={click} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className={`min-w-[96px] rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50 ${style}`}>
      {label}
    </button>
  );
}

export default function CommunityPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { refreshMine } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [community, setCommunity] = useState(null);
  const [error, setError] = useState('');
  const sort = params.get('sort') || 'hot';
  const t = params.get('t') || 'week';

  async function load() {
    try {
      const data = await fetchCommunity(slug);
      setCommunity(data);
      setError('');
      pushRecentCommunity(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this community.');
    }
  }

  useEffect(() => { setCommunity(null); load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="py-20 text-center text-slate-400">{error} <Link to="/communities/explore" className="text-cyan-300 hover:underline">Explore communities</Link></div>;
  if (!community) return <div className="py-20 text-center text-sm text-slate-500">Loading community…</div>;

  const TypeIcon = TYPE_META[community.type]?.icon || Globe;
  const m = community.membership;
  const banner = community.bannerColor || community.iconColor || colorFor(community.slug);

  async function toggleFavorite() {
    await setCommunityFavorite(community.slug, !m.favorite);
    await load();
    refreshMine();
  }

  return (
    <div className="mx-auto max-w-[1120px]">
      {/* Banner + header */}
      <div className="h-24 rounded-2xl md:h-32" style={{ background: `linear-gradient(120deg, ${banner}, ${banner}88 60%, #0c222b)` }} />
      <div className="flex flex-wrap items-end gap-4 px-2 md:px-4">
        <CommunityIcon community={community} size={88} className="-mt-10 ring-4 ring-[#081820]" />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="truncate text-2xl font-bold text-white md:text-3xl">c/{community.slug}</h1>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {community.canPost && (
            <button type="button" onClick={() => navigate(`/communities/submit?community=${community.slug}`)} className="inline-flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-sm font-bold text-white hover:bg-white/5">
              <Plus className="h-4 w-4" /> Create Post
            </button>
          )}
          {m?.status === 'active' && (
            <button type="button" onClick={toggleFavorite} title={m.favorite ? 'Remove from favourites' : 'Add to favourites'} className="rounded-full border border-white/25 p-2 hover:bg-white/5">
              <Star className={`h-4 w-4 ${m.favorite ? 'text-[#ffb000]' : 'text-slate-300'}`} fill={m.favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {community.isModerator && (
            <Link to={`/communities/c/${community.slug}/manage`} className="inline-flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-sm font-bold text-white hover:bg-white/5">
              <Shield className="h-4 w-4" /> Mod Tools {community.pendingCount > 0 && <span className="rounded-full bg-[#ff4500] px-1.5 text-[10px]">{community.pendingCount}</span>}
            </Link>
          )}
          <JoinButton community={community} onChange={load} />
        </div>
      </div>

      <div className="mt-6 flex gap-6">
        <div className="min-w-0 flex-1">
          {community.canView ? (
            <>
              {m?.status === 'pending' && community.type === 'restricted' && (
                <p className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-2.5 text-sm text-amber-100">Your request is waiting for a moderator. You can read and comment meanwhile; posting unlocks once approved.</p>
              )}
              <SortBar sort={sort} t={t} onChange={(next) => setParams(next.sort === 'top' ? next : { sort: next.sort })} />
              <PostList
                query={{ community: community.slug, sort, t: sort === 'top' ? t : undefined }}
                hideCommunity
                canModerate={community.isModerator}
                empty={community.canPost ? 'No posts yet — start the first discussion.' : 'No posts yet.'}
              />
            </>
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-[#0c222b] px-6 py-16 text-center">
              <Lock className="h-10 w-10 text-slate-500" />
              <h2 className="mt-4 text-lg font-semibold text-white">c/{community.slug} is a private community</h2>
              <p className="mt-2 max-w-sm text-sm text-slate-400">Only approved members can view and take part. {m?.status === 'pending' ? 'Your request is waiting for a moderator.' : 'Request to join and a moderator will review it.'}</p>
            </div>
          )}
        </div>

        {community.canView && <aside className="hidden w-[320px] shrink-0 space-y-4 lg:block">
          <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
            <h2 className="font-semibold text-white">c/{community.slug}</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-400">{community.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Created {new Date(community.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span className="inline-flex items-center gap-1"><TypeIcon className="h-3.5 w-3.5" /> {TYPE_META[community.type]?.label}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
              <div><div className="font-semibold text-white">{formatCount(community.memberCount)}</div><div className="text-[11px] text-slate-500">Members</div></div>
              <div><div className="font-semibold text-white">{formatCount(community.postCount)}</div><div className="text-[11px] text-slate-500">Posts</div></div>
            </div>
            <span className="mt-3 inline-block rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">{community.topic}</span>
          </section>

          {community.rules.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">c/{community.slug} rules</h2>
              <ol className="mt-2 space-y-2 text-sm text-slate-300">
                {community.rules.map((r, i) => <li key={i} className="flex gap-2 border-b border-white/5 pb-2 last:border-0"><span className="text-slate-500">{i + 1}</span>{r}</li>)}
              </ol>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moderators</h2>
            <ul className="mt-2 space-y-1.5">
              {community.moderators.map((mod) => <li key={mod.id}><Link to={`/communities/u/${mod.id}`} className="text-sm text-cyan-300 hover:underline">u/{mod.name}</Link></li>)}
              {community.moderators.length === 0 && <li className="text-xs text-slate-500">Run by NCPOR staff.</li>}
            </ul>
            <Link to={`/messages?to=${community.moderators[0]?.id || ''}`} className={`mt-3 block rounded-full border border-white/15 py-2 text-center text-xs font-semibold text-slate-200 hover:bg-white/5 ${community.moderators.length ? '' : 'hidden'}`}>Message the mods</Link>
          </section>
        </aside>}
      </div>
    </div>
  );
}
