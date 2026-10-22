import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Shield, UserMinus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  approveMember, fetchCommunity, fetchCommunityMembers, makeModerator, removeMember, removeModerator, updateCommunity,
} from '../../api/communities.js';
import Avatar from '../../components/communities/Avatar.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { COMMUNITY_TOPICS, TYPE_OPTIONS } from '../../components/communities/CreateCommunityModal.jsx';
import { timeAgo } from '../../components/communities/utils.js';

// Moderator tools: join requests, members, community settings.
export default function ModToolsPage() {
  const { slug } = useParams();
  const [community, setCommunity] = useState(null);
  const [tab, setTab] = useState('requests');
  const [members, setMembers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  async function loadCommunity() {
    try {
      const c = await fetchCommunity(slug);
      if (!c.isModerator) { setError('Only moderators can open Mod Tools.'); return; }
      setCommunity(c);
      setSettings({ description: c.description, topic: c.topic, type: c.type, rules: c.rules.length ? c.rules : [''] });
    } catch (err) { setError(err.response?.data?.error || 'Could not load community.'); }
  }

  async function loadMembers(which = tab) {
    if (which === 'settings') return;
    try { setMembers(await fetchCommunityMembers(slug, which === 'requests' ? 'pending' : 'active')); } catch { setMembers([]); }
  }

  useEffect(() => { loadCommunity(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (community) loadMembers(tab); }, [tab, community?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, userId, msg) {
    try { await fn(slug, userId); toast.success(msg); loadMembers(); loadCommunity(); }
    catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function save(e) {
    e.preventDefault();
    try {
      await updateCommunity(slug, { ...settings, rules: settings.rules.filter((r) => r.trim()) });
      toast.success('Settings saved');
      loadCommunity();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  }

  if (error) return <div className="py-20 text-center text-slate-400">{error}</div>;
  if (!community) return <div className="py-20 text-center text-sm text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/communities/c/${slug}`} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to c/{slug}</Link>
      <div className="mt-3 flex items-center gap-3">
        <CommunityIcon community={community} size={44} />
        <div><h1 className="text-xl font-bold text-white">Mod Tools</h1><p className="text-xs text-slate-500">c/{slug} · {community.type}</p></div>
        <Shield className="ml-auto h-5 w-5 text-emerald-300" />
      </div>

      <div className="mt-5 flex gap-1 border-b border-white/10">
        {[['requests', `Join requests${community.pendingCount ? ` (${community.pendingCount})` : ''}`], ['members', 'Members'], ['settings', 'Settings']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === id ? 'border-cyan-300 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>

      {tab !== 'settings' && (
        <div className="mt-2 divide-y divide-white/10">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <Avatar user={m} size={36} />
              <Link to={`/communities/u/${m.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white hover:underline">u/{m.name} {m.memberRole === 'moderator' && <span className="ml-1 rounded bg-emerald-300/15 px-1.5 text-[10px] text-emerald-200">MOD</span>}</span>
                <span className="block truncate text-xs text-slate-500">{m.organization} · {tab === 'requests' ? 'requested' : 'joined'} {timeAgo(m.joinedAt)}</span>
              </Link>
              {tab === 'requests' ? (
                <>
                  <button type="button" onClick={() => act(approveMember, m.id, 'Approved')} className="inline-flex items-center gap-1 rounded-full bg-cyan-300 px-3 py-1.5 text-xs font-bold text-[#06202a]"><Check className="h-3.5 w-3.5" /> Approve</button>
                  <button type="button" onClick={() => act(removeMember, m.id, 'Request declined')} className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:border-red-300/50"><X className="h-3.5 w-3.5" /> Decline</button>
                </>
              ) : m.memberRole === 'moderator' ? (
                m.id === community.creator?.id ? (
                  <span className="rounded-full border border-emerald-300/20 px-3 py-1.5 text-xs text-emerald-200">Creator</span>
                ) : (
                  <>
                    <button type="button" onClick={() => window.confirm(`Remove moderator role from u/${m.name}?`) && act(removeModerator, m.id, 'Moderator removed')} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">Remove mod</button>
                    <button type="button" onClick={() => window.confirm(`Remove u/${m.name} from the community?`) && act(removeMember, m.id, 'Member removed')} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-red-300" title="Remove"><UserMinus className="h-4 w-4" /></button>
                  </>
                )
              ) : (
                <>
                  <button type="button" onClick={() => act(makeModerator, m.id, 'Now a moderator')} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">Make mod</button>
                  <button type="button" onClick={() => window.confirm(`Remove u/${m.name}?`) && act(removeMember, m.id, 'Member removed')} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-red-300" title="Remove"><UserMinus className="h-4 w-4" /></button>
                </>
              )}
            </div>
          ))}
          {members.length === 0 && <p className="py-12 text-center text-sm text-slate-500">{tab === 'requests' ? 'No pending requests.' : 'No members yet.'}</p>}
        </div>
      )}

      {tab === 'settings' && settings && (
        <form onSubmit={save} className="mt-4 space-y-4">
          <label className="block text-sm text-slate-300">Description
            <textarea value={settings.description} maxLength={500} rows={3} onChange={(e) => setSettings({ ...settings, description: e.target.value })} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none" />
          </label>
          <label className="block text-sm text-slate-300">Topic
            <select value={settings.topic} onChange={(e) => setSettings({ ...settings, topic: e.target.value })} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-2.5 text-sm text-white outline-none">
              {[...new Set([settings.topic, ...COMMUNITY_TOPICS])].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm text-slate-300">Type</legend>
            <div className="mt-2 space-y-2">
              {TYPE_OPTIONS.map(({ id, label, desc }) => (
                <label key={id} className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2 ${settings.type === id ? 'border-cyan-300/50 bg-cyan-300/[0.06]' : 'border-white/10'}`}>
                  <input type="radio" checked={settings.type === id} onChange={() => setSettings({ ...settings, type: id })} className="accent-cyan-300" />
                  <span><span className="block text-sm font-semibold text-white">{label}</span><span className="text-xs text-slate-400">{desc}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <span className="text-sm text-slate-300">Rules</span>
            {settings.rules.map((r, i) => (
              <input key={i} value={r} maxLength={200} onChange={(e) => setSettings({ ...settings, rules: settings.rules.map((x, j) => (j === i ? e.target.value : x)) })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" placeholder={`Rule ${i + 1}`} />
            ))}
            {settings.rules.length < 10 && <button type="button" onClick={() => setSettings({ ...settings, rules: [...settings.rules, ''] })} className="mt-2 text-xs text-cyan-300 hover:underline">+ Add rule</button>}
          </div>
          <button type="submit" className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-[#06202a] hover:bg-cyan-200">Save changes</button>
        </form>
      )}
    </div>
  );
}
