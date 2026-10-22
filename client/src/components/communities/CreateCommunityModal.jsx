import React, { useState } from 'react';
import { Eye, Globe, Lock, Plus, X } from 'lucide-react';
import { createCommunity } from '../../api/communities.js';
import CommunityIcon from './CommunityIcon.jsx';

export const COMMUNITY_TOPICS = [
  'Arctic', 'Antarctic', 'Himalaya', 'Southern Ocean', 'Glaciology', 'Oceanography', 'Climate',
  'Biodiversity', 'Atmospheric Science', 'Geology', 'Data & Tools', 'Field Logistics', 'Students', 'General',
];

export const TYPE_OPTIONS = [
  { id: 'public', icon: Globe, label: 'Public', desc: 'Anyone can view, comment and join. Members can post.' },
  { id: 'restricted', icon: Eye, label: 'Restricted', desc: 'Anyone can view. Request membership to comment; approved members can post.' },
  { id: 'private', icon: Lock, label: 'Private', desc: 'Only approved members can view and contribute.' },
];

const COLORS = ['#ff4500', '#0079d3', '#46d160', '#ffb000', '#7193ff', '#ff66ac', '#0dd3bb', '#ea0027'];

// "Start a community" — mirrors Reddit's create-community dialog.
export default function CreateCommunityModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', topic: 'General', type: 'public', iconColor: COLORS[0], rules: [''] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const slug = form.name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 21);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (slug.length < 3) { setError('Name must be at least 3 characters (letters, numbers, underscores).'); return; }
    setBusy(true);
    try {
      const community = await createCommunity({ ...form, name: form.name.trim(), rules: form.rules.filter((r) => r.trim()) });
      onCreated?.(community);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the community.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c222b] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Start a community</h2>
            <p className="text-xs text-slate-400">A home for a research topic, expedition team or question.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Community name</span>
              <div className="mt-1.5 flex items-center rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-cyan-300/50">
                <span className="text-slate-500">c/</span>
                <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={21} className="w-full bg-transparent px-1 py-2.5 text-white outline-none" placeholder="sea_ice_watch" />
                <span className="text-xs text-slate-500">{21 - form.name.length}</span>
              </div>
              <span className="mt-1 block text-[11px] text-slate-500">Names can't be changed later. A URL-friendly c/slug is created automatically.</span>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-200">Description</span>
              <textarea required value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={3} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50" placeholder="What is this community about?" />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-200">Topic</span>
              <select value={form.topic} onChange={(e) => set('topic', e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-2.5 text-sm text-white outline-none">
                {COMMUNITY_TOPICS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>

            <fieldset>
              <legend className="text-sm font-medium text-slate-200">Community type</legend>
              <div className="mt-2 space-y-2">
                {TYPE_OPTIONS.map(({ id, icon: Icon, label, desc }) => (
                  <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${form.type === id ? 'border-cyan-300/50 bg-cyan-300/[0.06]' : 'border-white/10 hover:bg-white/[0.03]'}`}>
                    <input type="radio" name="type" checked={form.type === id} onChange={() => set('type', id)} className="mt-1 accent-cyan-300" />
                    <Icon className="mt-0.5 h-4 w-4 text-slate-300" />
                    <span><span className="block text-sm font-semibold text-white">{label}</span><span className="block text-xs text-slate-400">{desc}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <span className="text-sm font-medium text-slate-200">Rules <span className="text-slate-500">(optional)</span></span>
              <div className="mt-1.5 space-y-2">
                {form.rules.map((rule, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="mt-2.5 w-5 text-xs text-slate-500">{i + 1}.</span>
                    <input value={rule} maxLength={200} onChange={(e) => set('rules', form.rules.map((r, j) => (j === i ? e.target.value : r)))} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" placeholder="e.g. Cite your data source" />
                    {form.rules.length > 1 && <button type="button" onClick={() => set('rules', form.rules.filter((_, j) => j !== i))} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>}
                  </div>
                ))}
                {form.rules.length < 5 && <button type="button" onClick={() => set('rules', [...form.rules, ''])} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline"><Plus className="h-3.5 w-3.5" /> Add rule</button>}
              </div>
            </div>

            <div>
              <span className="text-sm font-medium text-slate-200">Icon colour</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {COLORS.map((c) => <button key={c} type="button" onClick={() => set('iconColor', c)} style={{ background: c }} className={`h-7 w-7 rounded-full ${form.iconColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0c222b]' : ''}`} aria-label={c} />)}
              </div>
            </div>
          </div>

          {/* Live preview card, like Reddit's */}
          <aside className="h-fit overflow-hidden rounded-2xl border border-white/10 bg-[#0a1d25]">
            <div className="h-10" style={{ background: form.iconColor }} />
            <div className="p-4">
              <div className="-mt-9 mb-2"><CommunityIcon community={{ slug: slug || 'c', iconColor: form.iconColor }} size={48} className="ring-4 ring-[#0a1d25]" /></div>
              <p className="font-semibold text-white">c/{slug || 'communityname'}</p>
              <p className="text-xs text-slate-500">1 member · {form.type}</p>
              <p className="mt-3 line-clamp-4 text-xs leading-5 text-slate-400">{form.description || 'Your community description'}</p>
            </div>
          </aside>
        </div>

        {error && <p className="mx-6 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-white/5 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={busy || slug.length < 3 || !form.description.trim()} className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-[#06202a] hover:bg-cyan-200 disabled:opacity-40">{busy ? 'Creating…' : 'Create community'}</button>
        </div>
      </form>
    </div>
  );
}
