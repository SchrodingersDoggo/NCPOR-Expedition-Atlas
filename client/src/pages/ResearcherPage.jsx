import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Database, FileText, Image as ImageIcon, MapPin, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { fetchResearcher } from '../api/researchers.js';
import ContactCard from '../components/communities/ContactCard.jsx';

function formatDate(value) {
  if (!value) return 'Date not available';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export default function ResearcherPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchResearcher(id).then(setData).catch((e) => setError(e?.response?.data?.error || 'Researcher could not be loaded.')).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <main className="min-h-screen bg-[#061820] text-slate-400 flex items-center justify-center">Loading researcher…</main>;
  if (error || !data) return <main className="min-h-screen bg-[#061820] text-white px-6 py-12"><div className="max-w-4xl mx-auto"><Link to="/explore" className="text-cyan-300 text-sm">← Back to Explorer</Link><p className="mt-8 text-red-300">{error || 'Researcher not found.'}</p></div></main>;

  const { researcher, stats, expeditions, content } = data;

  return (
    <main className="min-h-screen bg-[#061820] text-white px-6 py-10">
      <div className="max-w-7xl mx-auto">
        <Link to="/explore" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300"><ArrowLeft className="w-4 h-4" /> Back to Explorer</Link>

        <section className="mt-6 rounded-2xl border border-slate-700 bg-gradient-to-r from-[#0b2532] to-[#0a1b23] p-6 md:p-8 flex flex-col md:flex-row gap-6 items-start">
          <div className="w-28 h-28 rounded-full overflow-hidden bg-[#102936] border border-slate-600 flex items-center justify-center shrink-0">
            {researcher.avatarUrl ? <img src={researcher.avatarUrl} alt={researcher.name} className="w-full h-full object-cover" /> : <UserRound className="w-12 h-12 text-slate-500" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Researcher profile</p>
            <h1 className="text-3xl md:text-4xl font-bold mt-1">{researcher.name}</h1>
            <p className="text-slate-300 mt-2">{researcher.organization || 'NCPOR'}</p>
            <p className="text-sm text-slate-500 mt-1">{researcher.designation ? `${researcher.designation} · ` : ''}Research contributor · NCPOR Polar Research Portal</p>
            {researcher.bio && <p className="text-sm text-slate-300 mt-3 max-w-2xl whitespace-pre-line">{researcher.bio}</p>}
            <Link to={`/communities/u/${researcher.id}`} className="inline-block mt-3 text-xs text-cyan-300 hover:underline">View community posts →</Link>
          </div>
          {/* Communities update — ways to connect with this researcher */}
          <ContactCard person={researcher} title="Connect with this researcher" className="w-full md:ml-auto md:w-80 md:shrink-0" />
        </section>

        <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5">
          {[
            [stats.expeditions, 'Expeditions'], [stats.datasets, 'Datasets'], [stats.photos, 'Photos'], [stats.reports, 'Reports & papers'], [stats.videos, 'Videos'], [stats.activities, 'Activities'],
          ].map(([value, label]) => <div key={label} className="rounded-xl border border-slate-700 bg-[#0a1b23] p-4"><p className="text-2xl font-bold text-white">{value}</p><p className="text-xs text-slate-500 mt-1">{label}</p></div>)}
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-semibold">Expeditions</h2><span className="text-xs text-slate-500">Click an expedition to open its existing page</span></div>
          {expeditions.length === 0 ? <p className="text-sm text-slate-500">No expeditions are associated with this researcher yet.</p> : (
            <div className="grid md:grid-cols-2 gap-3">
              {expeditions.map((expedition) => <Link key={expedition.id} to={`/expeditions/${expedition.id}`} className="rounded-xl border border-slate-700 bg-[#0a1b23] p-4 hover:border-cyan-500/50 transition">
                <h3 className="font-semibold text-white">{expedition.name}</h3>
                <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{formatDate(expedition.startDate)}</span>{expedition.region && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{String(expedition.region).replace('_', ' ')}</span>}</div>
              </Link>)}
            </div>
          )}
        </section>

        <section className="grid lg:grid-cols-2 gap-6 mt-8">
          <ContentList title="Datasets" icon={Database} items={content.datasets} />
          <ContentList title="Reports & Publications" icon={FileText} items={content.reports} />
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-cyan-300" /> Photos</h2>
          {content.photos.length === 0 ? <p className="text-sm text-slate-500">No published photos uploaded by this researcher.</p> : <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{content.photos.map((photo) => <div key={photo.id} className="rounded-xl overflow-hidden border border-slate-700 bg-[#0a1b23]"><img src={photo.thumbnailUrl || photo.fileUrl} alt={photo.title} className="aspect-square w-full object-cover" /><p className="p-2 text-xs text-slate-300 truncate">{photo.title}</p></div>)}</div>}
        </section>
      </div>
    </main>
  );
}

function ContentList({ title, icon: Icon, items }) {
  return <section className="rounded-2xl border border-slate-700 bg-[#0a1b23] p-5"><h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Icon className="w-5 h-5 text-cyan-300" /> {title}</h2>{items.length === 0 ? <p className="text-sm text-slate-500">No published items.</p> : <div className="space-y-2">{items.map((item) => <div key={item.id} className="p-3 rounded-lg border border-slate-800"><p className="text-sm font-medium text-white">{item.title}</p>{item.expedition?.name && <p className="text-xs text-slate-500 mt-1">{item.expedition.name}</p>}</div>)}</div>}</section>;
}
