import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Compass, MapPin, Plus, Send, ShieldCheck, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createObservation, fetchObservations } from '../api/activities.js';
import { useAuth } from '../context/AuthContext.jsx';

const REGIONS = ['Arctic', 'Antarctic', 'Himalaya', 'Southern_Ocean', 'Other'];
const TYPES = ['Sea-ice condition', 'Species sighting', 'Weather', 'Station observation', 'Ocean observation', 'Other'];

const initialForm = () => ({
  title: '',
  observationType: TYPES[0],
  description: '',
  region: 'Antarctic',
  latitude: '',
  longitude: '',
  observedAt: new Date().toISOString().slice(0, 16),
  confidence: 'medium',
  evidenceUrl: '',
});

export default function ObservationPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(initialForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchObservations(50);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load observations. Please check that the NCPOR server is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const requireLogin = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/observations' } });
      return false;
    }
    return true;
  };

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    setSaving(true);
    setError('');
    try {
      await createObservation({
        ...form,
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
        observedAt: new Date(form.observedAt).toISOString(),
      });
      setOpen(false);
      setForm(initialForm());
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit the observation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen chart-backdrop pb-16">
      <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
        <Link to="/activities" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Activities
        </Link>

        <section className="mt-6 overflow-hidden rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-[#123f50] to-[#071620] p-7 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.25em] text-cyan-200">
                <Compass className="h-4 w-4" /> Observation registry
              </div>
              <h1 className="mt-3 text-4xl font-semibold text-white md:text-5xl">Field Observations</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Record scientific observations with date, location, confidence and supporting evidence.
              </p>
            </div>
            <button onClick={() => requireLogin() && setOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#06202a] hover:bg-cyan-200">
              <Plus className="h-4 w-4" /> New observation
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Close error"><X className="h-4 w-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#0c222b] p-12 text-center text-sm text-slate-400">Loading observations…</div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-[#0c222b] p-14 text-center">
            <Compass className="mx-auto h-10 w-10 text-cyan-200/60" />
            <h2 className="mt-4 text-lg font-semibold text-white">No observations yet</h2>
            <p className="mt-2 text-sm text-slate-500">Be the first researcher to submit a field observation.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-[#0c222b] p-5 transition hover:border-cyan-300/25">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[10px] text-cyan-200">{item.observationType}</span>
                  <span className="text-[10px] uppercase text-slate-500">{item.status || 'submitted'}</span>
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">{item.title}</h2>
                <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-400">{item.description}</p>
                <div className="mt-5 space-y-2 text-xs text-slate-500">
                  <div><CalendarDays className="mr-2 inline h-4 w-4" />{item.observedAt ? new Date(item.observedAt).toLocaleString() : 'Date not set'}</div>
                  <div><MapPin className="mr-2 inline h-4 w-4" />{item.region || 'Region not specified'}{item.latitude != null && item.longitude != null ? ` • ${item.latitude}, ${item.longitude}` : ''}</div>
                  <div><ShieldCheck className="mr-2 inline h-4 w-4" />Confidence: {item.confidence || 'unverified'}</div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0c222b] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div><h3 className="text-xl font-semibold text-white">Submit field observation</h3><p className="mt-1 text-xs text-slate-500">Your submission will be stored for review.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input required placeholder="Observation title" value={form.title} onChange={(e) => update('title', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white outline-none" />
              <select value={form.observationType} onChange={(e) => update('observationType', e.target.value)} className="rounded-xl border border-white/10 bg-[#102b35] p-3 text-sm text-white">{TYPES.map((type) => <option key={type}>{type}</option>)}</select>
            </div>
            <textarea required rows="5" placeholder="Describe what was observed…" value={form.description} onChange={(e) => update('description', e.target.value)} className="mt-4 w-full rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white outline-none" />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <select value={form.region} onChange={(e) => update('region', e.target.value)} className="rounded-xl border border-white/10 bg-[#102b35] p-3 text-sm text-white">{REGIONS.map((region) => <option key={region}>{region}</option>)}</select>
              <select value={form.confidence} onChange={(e) => update('confidence', e.target.value)} className="rounded-xl border border-white/10 bg-[#102b35] p-3 text-sm text-white"><option value="low">Low confidence</option><option value="medium">Medium confidence</option><option value="high">High confidence</option></select>
              <input required type="datetime-local" value={form.observedAt} onChange={(e) => update('observedAt', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <input type="number" step="any" min="-90" max="90" placeholder="Latitude (optional)" value={form.latitude} onChange={(e) => update('latitude', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" />
              <input type="number" step="any" min="-180" max="180" placeholder="Longitude (optional)" value={form.longitude} onChange={(e) => update('longitude', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" />
            </div>
            <input type="url" placeholder="Evidence URL (optional)" value={form.evidenceUrl} onChange={(e) => update('evidenceUrl', e.target.value)} className="mt-4 w-full rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button>
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2 text-sm font-bold text-[#06202a] disabled:opacity-50"><Send className="h-4 w-4" />{saving ? 'Submitting…' : 'Submit observation'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
