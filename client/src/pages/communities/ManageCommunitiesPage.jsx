import React, { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Search, Shield, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { leaveCommunity, setCommunityFavorite } from '../../api/communities.js';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { formatCount } from '../../components/communities/utils.js';

// Reddit's "Manage Communities": every community you're in, favourite
// toggle, Joined/Leave button, and a shortcut to Mod Tools.
export default function ManageCommunitiesPage() {
  const { mine, refreshMine } = useOutletContext();
  const [q, setQ] = useState('');
  const [hover, setHover] = useState(null);
  const list = mine.filter((c) => c.slug.toLowerCase().includes(q.toLowerCase()));

  async function favorite(c) {
    try { await setCommunityFavorite(c.slug, !c.membership.favorite); refreshMine(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not update'); }
  }

  async function leave(c) {
    const pending = c.membership.status === 'pending';
    if (!window.confirm(pending ? `Cancel your request to join c/${c.slug}?` : `Leave c/${c.slug}?`)) return;
    try { await leaveCommunity(c.slug); toast.success(pending ? 'Request cancelled' : `Left c/${c.slug}`); refreshMine(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not leave'); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Manage Communities</h1>
      <div className="mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4">
        <Search className="h-4 w-4 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your communities" className="w-full bg-transparent py-2 text-sm text-white outline-none" />
      </div>

      <div className="mt-4 divide-y divide-white/10">
        {list.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-3">
            <CommunityIcon community={c} size={40} />
            <Link to={`/communities/c/${c.slug}`} className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold text-white hover:underline">
                c/{c.slug}
                {c.membership.role === 'moderator' && <span className="rounded bg-emerald-300/15 px-1.5 text-[10px] font-bold text-emerald-200">MOD</span>}
                {c.membership.status === 'pending' && <span className="rounded bg-amber-300/15 px-1.5 text-[10px] font-bold text-amber-200">PENDING</span>}
              </span>
              <span className="block truncate text-xs text-slate-500">{formatCount(c.memberCount)} members · {c.description}</span>
            </Link>
            {c.membership.role === 'moderator' && (
              <Link to={`/communities/c/${c.slug}/manage`} title="Mod Tools" className="rounded-full p-2 text-slate-300 hover:bg-white/10"><Shield className="h-4 w-4" /></Link>
            )}
            {c.membership.status === 'active' && (
              <button type="button" onClick={() => favorite(c)} title={c.membership.favorite ? 'Unfavourite' : 'Favourite'} className="rounded-full p-2 hover:bg-white/10">
                <Star className={`h-4 w-4 ${c.membership.favorite ? 'text-[#ffb000]' : 'text-slate-400'}`} fill={c.membership.favorite ? 'currentColor' : 'none'} />
              </button>
            )}
            <button
              type="button"
              onMouseEnter={() => setHover(c.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => leave(c)}
              className="min-w-[88px] rounded-full border border-white/25 px-4 py-1.5 text-sm font-bold text-slate-100 hover:border-red-300/50 hover:text-red-200"
            >
              {hover === c.id ? (c.membership.status === 'pending' ? 'Cancel' : 'Leave') : c.membership.status === 'pending' ? 'Requested' : 'Joined'}
            </button>
          </div>
        ))}
        {mine.length === 0 && <p className="py-16 text-center text-sm text-slate-500">You haven't joined any communities yet. <Link to="/communities/explore" className="text-cyan-300 hover:underline">Explore</Link></p>}
      </div>
    </div>
  );
}
