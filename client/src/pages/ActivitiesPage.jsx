import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Award, BookOpen, CheckCircle2, ChevronRight, ClipboardCheck,
  Compass, Database, Filter, Globe2,
  Microscope, Plus, Radio, Send, ShieldCheck, Users, Waves, X, Zap, MapPin,
  CalendarDays, ExternalLink, RefreshCw,
} from 'lucide-react';
import { fetchExpeditionsForGlobe } from '../api/expeditions.js';
import { fetchActivitiesOverview, fetchObservations, createObservation } from '../api/activities.js';
import { useAuth } from '../context/AuthContext.jsx';

const ACTIVITY_CARDS = [
  { id: 'observation', type: 'Field work', title: 'Log a field observation', desc: 'Submit a structured species, sea-ice, weather or station observation for review and future research.', icon: Compass },
  { id: 'dataset', type: 'Data', title: 'Share a dataset', desc: 'Open the existing repository upload workflow and attach provenance, metadata and a scientific summary.', icon: Database },
  { id: 'review', type: 'Knowledge', title: 'Review a public record', desc: 'Open the repository review workflow for authorised reviewers, or browse public records as a visitor.', icon: ClipboardCheck },
  { id: 'institutional', type: 'Institutional', title: 'Institutional activities', desc: 'See official upcoming events and notices. Officers and admins can publish the date, time and venue.', icon: CalendarDays },
];

const FILTERS = ['All', 'Field work', 'Data', 'Knowledge', 'Institutional'];
const REGIONS = ['Arctic', 'Antarctic', 'Himalaya', 'Southern_Ocean', 'Other'];

const EMPTY_OBSERVATION = {
  title: '', observationType: 'Sea-ice condition', description: '', region: 'Antarctic',
  latitude: '', longitude: '', observedAt: new Date().toISOString().slice(0, 16),
  confidence: 'medium', evidenceUrl: '', expeditionId: '',
};

function Pill({ children }) {
  return <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400">{children}</span>;
}

function SectionHeader({ eyebrow, title, desc, icon: Icon }) {
  return <div className="mb-6">
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--brass-bright)]"><Icon className="h-4 w-4" /> {eyebrow}</div>
    <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{title}</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{desc}</p>
  </div>;
}

function Metric({ value, label, icon: Icon }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
    <Icon className="h-5 w-5 text-cyan-300" />
    <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    <div className="mt-1 text-xs text-slate-400">{label}</div>
  </div>;
}

function Modal({ title, children, onClose }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0c222b] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><div className="text-[11px] uppercase tracking-widest text-[var(--brass-bright)]">NCPOR Activities</div><h3 className="mt-1 text-xl font-semibold text-white">{title}</h3></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/5"><X className="h-5 w-5" /></button>
      </div>
      {children}
    </div>
  </div>;
}

export default function ActivitiesPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [overview, setOverview] = useState(null);
  const [observations, setObservations] = useState([]);
  const [expeditions, setExpeditions] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [observation, setObservation] = useState(EMPTY_OBSERVATION);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [ov, obs, ex] = await Promise.all([
        fetchActivitiesOverview(), fetchObservations(12), fetchExpeditionsForGlobe(),
      ]);
      setOverview(ov); setObservations(obs); setExpeditions(ex);
    } catch (err) { setError(err.response?.data?.error || 'Could not load the Activities data. Check that the API is running.'); }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleActivities = useMemo(() => ACTIVITY_CARDS.filter((a) => filter === 'All' || a.type === filter), [filter]);
  const expeditionMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expeditions.filter((e) => !q || `${e.name} ${e.region || ''} ${e.pi || ''}`.toLowerCase().includes(q)).slice(0, 5);
  }, [expeditions, search]);

  const requireLogin = () => {
    if (!isAuthenticated) { navigate('/login', { state: { from: '/activities' } }); return false; }
    return true;
  };

  const openActivity = (id) => {
    if (id === 'dataset') { navigate('/upload'); return; }
    if (id === 'review') { navigate(user && ['admin', 'comms_officer'].includes(user.role) ? '/review' : '/archive'); return; }
    if (id === 'institutional') { navigate('/institutional-activities'); return; }
    if (id === 'observation') { if (requireLogin()) navigate('/observations'); return; }
    if (requireLogin()) { setModal('observation'); setError(''); }
  };

  const showNotice = (message) => { setNotice(message); window.setTimeout(() => setNotice(''), 3500); };

  const submitObservation = async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    setBusy(true); setError('');
    try {
      await createObservation({ ...observation, observedAt: new Date(observation.observedAt).toISOString() });
      setModal(null); setObservation(EMPTY_OBSERVATION); showNotice('Observation submitted to the repository review trail.'); await refresh();
    } catch (err) { setError(err.response?.data?.error || 'Observation could not be submitted.'); }
    finally { setBusy(false); }
  };

  const metric = overview?.metrics || { observations: 0, activeContributors: 0, openDatasets: 0 };

  return <div className="min-h-screen chart-backdrop pb-16">
    {notice && <div className="fixed right-5 top-20 z-[120] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-400/20 bg-[#102c35] px-4 py-3 text-sm text-emerald-100 shadow-2xl"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}
    {error && <div className="fixed right-5 top-20 z-[120] mt-12 flex max-w-sm items-start gap-3 rounded-xl border border-red-400/20 bg-[#32171b] px-4 py-3 text-sm text-red-100 shadow-2xl"><span className="font-bold">!</span><span>{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

    <section className="relative overflow-hidden border-b border-white/10 bg-gradient-to-b from-[#123848] to-[#071620]">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-cyan-300/10" />
      <div className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-20">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-xs text-cyan-200"><Radio className="h-3.5 w-3.5" /> NCPOR • Polar Knowledge Network</div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-6xl">Activities that turn <span className="text-cyan-200">polar data</span> into usable knowledge.</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300 md:text-lg">Contribute observations, publish repository data, follow institutional activities and support responsible review — with each action stored through the portal backend.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => openActivity('observation')} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-[#06202a] hover:bg-cyan-200"><Plus className="h-4 w-4" /> Contribute an observation</button>
            <Link to="/explore" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-300 hover:bg-white/5">Explore expeditions <ArrowUpRight className="h-4 w-4" /></Link>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric value={metric.observations} label="Field observations" icon={Compass} />
          <Metric value={metric.openDatasets} label="Published datasets" icon={Database} />
          <Metric value={metric.activeContributors} label="Active contributors" icon={Users} />
        </div>
      </div>
    </section>

    <main className="mx-auto max-w-7xl space-y-16 px-5 py-12 md:px-8">
      <section>
        <SectionHeader eyebrow="Activities hub" title="Observations, data & institutional activities" desc="Choose a workflow below to open its dedicated workspace. Discussions and research communities now live in the Communities tab." icon={Zap} />
        <div className="mb-5 flex flex-wrap gap-2">{FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1.5 text-xs ${filter === f ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-slate-400 hover:text-white'}`}>{f}</button>)}</div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleActivities.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => openActivity(item.id)} className="group text-left rounded-2xl border border-white/10 bg-[#0c222b] p-5 hover:-translate-y-0.5 hover:border-cyan-300/30 transition-all">
            <div className="flex items-start justify-between"><div className="rounded-xl bg-cyan-300/10 p-2.5"><Icon className="h-5 w-5 text-cyan-200" /></div><ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-cyan-200" /></div>
            <div className="mt-5 text-xs uppercase tracking-widest text-[var(--brass)]">{item.type}</div><h3 className="mt-1 text-base font-semibold text-white">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{item.desc}</p>
            <div className="mt-4 text-xs font-medium text-cyan-300">Open workflow →</div>
          </button>; })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-2xl border border-white/10 bg-[#0c222b] p-5 md:p-7">
          <SectionHeader eyebrow="Traceable contributions" title="Recent field observations" desc="Every submitted observation records its author, date, region and review status so the repository can distinguish contribution from verified knowledge." icon={MapPin} />
          <div className="space-y-3">
            {observations.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No observations yet. Use “Log a field observation” to create the first record.</div>}
            {observations.map((o) => <div key={o.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{o.title}</h3><Pill>{o.status}</Pill><Pill>{o.confidence} confidence</Pill></div><p className="mt-2 text-sm leading-6 text-slate-400">{o.description}</p></div><div className="shrink-0 text-right text-xs text-slate-500"><div>{new Date(o.observedAt).toLocaleDateString()}</div><div className="mt-1">{o.region || 'Region not set'}</div></div></div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500"><span>By {o.creator?.name}</span>{o.creator?.organization && <span>• {o.creator.organization}</span>}{o.expedition && <Link className="text-cyan-300 hover:text-cyan-200" to={`/expeditions/${o.expedition.id}`}>• {o.expedition.name}</Link>}{o.evidenceUrl && <a href={o.evidenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-300">Evidence <ExternalLink className="h-3 w-3" /></a>}</div>
            </div>)}
          </div>
        </div>
        <aside className="rounded-2xl border border-white/10 bg-[#0c222b] p-5 md:p-7">
          <div className="flex items-center justify-between"><div><div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--brass-bright)]"><Globe2 className="h-4 w-4" /> Expedition link</div><h2 className="mt-2 text-xl font-semibold text-white">Connect contributions to expeditions</h2></div><Waves className="h-5 w-5 text-cyan-200" /></div>
          <p className="mt-2 text-xs leading-5 text-slate-500">Choose an existing expedition while submitting an observation to preserve context.</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3"><Filter className="h-4 w-4 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expedition or region" className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-600" /></div>
          <div className="mt-4 space-y-2">{expeditionMatches.map((e) => <Link key={e.id} to={`/expeditions/${e.id}`} className="flex items-center gap-3 rounded-xl border border-white/5 p-3 hover:bg-white/5"><div className="rounded-lg bg-blue-300/10 p-2"><Waves className="h-4 w-4 text-blue-200" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm text-white">{e.name}</div><div className="text-[11px] text-slate-500">{e.region || 'Region not set'} · {e.pi || 'No PI listed'}</div></div><ChevronRight className="h-4 w-4 text-slate-600" /></Link>)}{!expeditionMatches.length && <div className="p-5 text-center text-xs text-slate-500">No expedition matches.</div>}</div>
          <Link to="/explore" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-cyan-300/20 py-2.5 text-xs text-cyan-200 hover:bg-cyan-300/5">Open full explorer <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </aside>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0c222b] p-5 md:p-7">
        <div className="grid gap-8 md:grid-cols-2">
          <div><div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--brass-bright)]"><Award className="h-4 w-4" /> Institutional value</div><h2 className="mt-2 text-2xl font-semibold text-white">A traceable path from activity to repository value</h2><p className="mt-3 text-sm leading-6 text-slate-400">The platform records who contributed information, when it was submitted and how the reviewer workflow handled it. This makes the activity layer useful to researchers and administrators without presenting unverified contributions as official findings.</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><ShieldCheck className="h-5 w-5 text-emerald-300" /><h3 className="mt-3 text-sm font-semibold text-white">Provenance</h3><p className="mt-1 text-xs leading-5 text-slate-500">Author, date, region and linked expedition stay attached to a contribution.</p></div><div className="rounded-xl border border-white/10 p-4"><Microscope className="h-5 w-5 text-cyan-300" /><h3 className="mt-3 text-sm font-semibold text-white">Review trail</h3><p className="mt-1 text-xs leading-5 text-slate-500">Authorised staff can mark submitted knowledge as reviewed.</p></div><div className="rounded-xl border border-white/10 p-4"><Database className="h-5 w-5 text-blue-300" /><h3 className="mt-3 text-sm font-semibold text-white">Repository link</h3><p className="mt-1 text-xs leading-5 text-slate-500">Datasets continue through the existing upload and archive workflow.</p></div><div className="rounded-xl border border-white/10 p-4"><BookOpen className="h-5 w-5 text-amber-200" /><h3 className="mt-3 text-sm font-semibold text-white">Public access</h3><p className="mt-1 text-xs leading-5 text-slate-500">Public users can discover records while contribution actions remain authenticated.</p></div></div>
        </div>
      </section>
    </main>

    {modal === 'observation' && <Modal title="Log a field observation" onClose={() => setModal(null)}><form onSubmit={submitObservation} className="mt-5 space-y-4">
      <div className="grid gap-4 md:grid-cols-2"><label className="text-xs text-slate-400">Observation title<input required value={observation.title} onChange={(e) => setObservation({ ...observation, title: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" placeholder="e.g. Sea-ice edge observation" /></label><label className="text-xs text-slate-400">Observation type<select value={observation.observationType} onChange={(e) => setObservation({ ...observation, observationType: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-3 text-sm text-white outline-none"><option>Sea-ice condition</option><option>Species sighting</option><option>Weather</option><option>Station observation</option><option>Ocean observation</option><option>Other</option></select></label></div>
      <label className="block text-xs text-slate-400">Observation details<textarea required value={observation.description} onChange={(e) => setObservation({ ...observation, description: e.target.value })} rows="5" className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" placeholder="Describe what was observed, relevant conditions and evidence." /></label>
      <div className="grid gap-4 md:grid-cols-3"><label className="text-xs text-slate-400">Region<select value={observation.region} onChange={(e) => setObservation({ ...observation, region: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-3 text-sm text-white outline-none">{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></label><label className="text-xs text-slate-400">Confidence<select value={observation.confidence} onChange={(e) => setObservation({ ...observation, confidence: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-3 text-sm text-white outline-none"><option>low</option><option>medium</option><option>high</option></select></label><label className="text-xs text-slate-400">Observed at<input required type="datetime-local" value={observation.observedAt} onChange={(e) => setObservation({ ...observation, observedAt: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" /></label></div>
      <div className="grid gap-4 md:grid-cols-2"><label className="text-xs text-slate-400">Latitude (optional)<input type="number" step="any" min="-90" max="90" value={observation.latitude} onChange={(e) => setObservation({ ...observation, latitude: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" /></label><label className="text-xs text-slate-400">Longitude (optional)<input type="number" step="any" min="-180" max="180" value={observation.longitude} onChange={(e) => setObservation({ ...observation, longitude: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" /></label></div>
      <div className="grid gap-4 md:grid-cols-2"><label className="text-xs text-slate-400">Link to expedition<select value={observation.expeditionId} onChange={(e) => setObservation({ ...observation, expeditionId: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-3 text-sm text-white outline-none"><option value="">No expedition link</option>{expeditions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="text-xs text-slate-400">Evidence URL (optional)<input type="url" value={observation.evidenceUrl} onChange={(e) => setObservation({ ...observation, evidenceUrl: e.target.value })} className="mt-2 w-full rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-white outline-none" placeholder="https://…" /></label></div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/10 bg-cyan-300/5 p-3 text-xs text-slate-400"><span>Submitted observations start as <b className="text-cyan-200">submitted</b>; they are not automatically treated as verified scientific findings.</span><button disabled={busy} type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-[#06202a] disabled:opacity-50">{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit</button></div>
    </form></Modal>}

  </div>;
}
