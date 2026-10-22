import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock, MapPin, Plus, Send, ShieldCheck, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createInstitutionalActivity, fetchInstitutionalActivities } from '../api/activities.js';
import { useAuth } from '../context/AuthContext.jsx';

const initialForm = () => ({ title: '', description: '', location: '', organizer: '', date: new Date().toISOString().slice(0, 10), startTime: '10:00', endTime: '12:00' });

export default function InstitutionalActivitiesPage() {
  const { user, isAuthenticated } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(initialForm);
  const canManage = isAuthenticated && ['admin', 'comms_officer'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchInstitutionalActivities();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load institutional activities. Please check that the NCPOR server is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createInstitutionalActivity(form);
      setOpen(false);
      setForm(initialForm());
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create the event notice.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen chart-backdrop pb-16">
      <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
        <Link to="/activities" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to Activities</Link>
        <section className="mt-6 overflow-hidden rounded-3xl border border-amber-200/15 bg-gradient-to-br from-[#3b3020] via-[#19252a] to-[#071620] p-7 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.25em] text-amber-200"><CalendarDays className="h-4 w-4" /> Institutional activities</div>
              <h1 className="mt-3 text-4xl font-semibold text-white md:text-5xl">Official upcoming events</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">A central notice board for official NCPOR activities, events and institutional programmes.</p>
            </div>
            {canManage && <button onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-200 px-5 py-3 text-sm font-bold text-[#231d12] hover:bg-amber-100"><Plus className="h-4 w-4" /> Create event notice</button>}
          </div>
        </section>

        {canManage && <div className="mt-4 rounded-xl border border-emerald-300/10 bg-emerald-300/5 p-3 text-xs text-emerald-100"><ShieldCheck className="mr-2 inline h-4 w-4" />You are authorised to publish institutional event notices.</div>}
        {!canManage && isAuthenticated && <div className="mt-4 rounded-xl border border-white/10 bg-white/[.02] p-3 text-xs text-slate-400">Institutional notices are published by Officers and Admins. You can view all published events here.</div>}
        {!isAuthenticated && <div className="mt-4 rounded-xl border border-white/10 bg-white/[.02] p-3 text-xs text-slate-400">You can view published institutional notices. Sign in if you need access to other portal features.</div>}

        {error && <div className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100"><span>{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

        {loading ? <div className="mt-8 rounded-2xl border border-white/10 bg-[#0c222b] p-12 text-center text-sm text-slate-400">Loading institutional activities…</div> : items.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-[#0c222b] p-14 text-center"><CalendarDays className="mx-auto h-10 w-10 text-amber-200/60" /><h2 className="mt-4 text-lg font-semibold text-white">No upcoming activities</h2><p className="mt-2 text-sm text-slate-500">Official events published by authorised staff will appear here.</p></div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2">{items.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-[#0c222b] p-6 transition hover:border-amber-200/25"><div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 rounded-full bg-amber-200/10 px-3 py-1 text-[10px] text-amber-100"><CalendarDays className="h-3.5 w-3.5" />{item.activityDate ? new Date(item.activityDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not set'}</span><span className="inline-flex items-center gap-1 text-[10px] text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" /> Official notice</span></div><h2 className="mt-5 text-xl font-semibold text-white">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p><div className="mt-5 grid gap-3 text-xs text-slate-400 sm:grid-cols-2"><div><MapPin className="mr-2 inline h-4 w-4 text-cyan-200" />{item.location || 'Location not set'}</div><div><Clock className="mr-2 inline h-4 w-4 text-cyan-200" />{item.startTime ? new Date(item.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Time not set'}{item.endTime ? ` – ${new Date(item.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</div><div><Users className="mr-2 inline h-4 w-4 text-cyan-200" />Organizer: {item.organizer || 'NCPOR'}</div></div></article>)}</div>
        )}
      </div>

      {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0c222b] p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="text-xl font-semibold text-white">Create official event notification</h3><p className="mt-1 text-xs text-slate-500">Only Officer/Admin accounts can publish this notice.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-4"><input required placeholder="Event title" value={form.title} onChange={(e) => update('title', e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /><textarea required rows="4" placeholder="What is the event about?" value={form.description} onChange={(e) => update('description', e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /><div className="grid gap-4 md:grid-cols-2"><input required placeholder="Location" value={form.location} onChange={(e) => update('location', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /><input required placeholder="Organizer" value={form.organizer} onChange={(e) => update('organizer', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /></div><div className="grid gap-4 md:grid-cols-3"><input required type="date" value={form.date} onChange={(e) => update('date', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /><input required type="time" value={form.startTime} onChange={(e) => update('startTime', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /><input type="time" value={form.endTime} onChange={(e) => update('endTime', e.target.value)} className="rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white" /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-amber-200 px-5 py-2 text-sm font-bold text-[#231d12] disabled:opacity-50"><Send className="h-4 w-4" />{saving ? 'Publishing…' : 'Publish notice'}</button></div></div></form></div>}
    </div>
  );
}
