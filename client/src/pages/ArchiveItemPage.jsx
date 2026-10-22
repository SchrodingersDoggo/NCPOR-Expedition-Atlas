import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Download, CalendarDays, MapPin, Users, Compass, Tag as TagIcon,
  FileText, Database, Image, Video, BookOpen, Building2, Clock3, ExternalLink,
  CheckCircle2, Navigation, Layers3, UserRound, Activity, ShieldCheck, Ship, Hash
} from 'lucide-react';
import { fetchArchiveItem } from '../api/archive.js';
import { TypeBadge, StagePill, FileRoleBadge, REGION_LABEL, DOMAIN_LABEL, ArchiveResultCard } from '../components/archive/ArchiveUI.jsx';
import DatasetDownloadButton from '../components/DatasetDownloadButton.jsx';

const TYPE_ICONS = { report: FileText, dataset: Database, publication: BookOpen, photo: Image, video: Video, activity: Activity };
const TYPE_TITLES = { report: 'Reports', dataset: 'Scientific Data', publication: 'Publications', photo: 'Photos', video: 'Videos', activity: 'Activities' };

function MetaRow({ icon: Icon, label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="flex items-start gap-2 text-sm"><Icon className="w-4 h-4 text-[var(--brass)] mt-0.5 shrink-0"/><span className="text-slate-400 w-32 shrink-0">{label}</span><span className="text-slate-200">{value}</span></div>;
}

function Section({ id, title, icon: Icon, children, className = '' }) {
  return <section id={id} className={`scroll-mt-24 bg-[#0f2129] border border-slate-700 rounded-xl p-5 md:p-7 ${className}`}>
    <h2 className="text-lg md:text-xl font-semibold text-white mb-5 flex items-center gap-2"><Icon className="w-5 h-5 text-[var(--brass-bright)]"/>{title}</h2>{children}
  </section>;
}

function DatasetMetaTable({ meta }) {
  if (!meta || !meta.columns) return null;
  return <div className="mt-4"><div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold text-white">Dataset preview</h4><span className="text-xs text-slate-500">{meta.row_count ?? '—'} rows</span></div><div className="bg-[#0a1b23] border border-slate-700 rounded-lg overflow-x-auto"><table className="w-full text-xs text-slate-400"><thead><tr>{meta.columns.map(col => <th key={col.name} className="p-2.5 border-b border-slate-700 text-left whitespace-nowrap">{col.name} <span className="text-slate-600">({col.type})</span></th>)}</tr></thead><tbody>{(meta.preview_rows || []).slice(0,8).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} className="p-2.5 border-b border-slate-800 whitespace-nowrap">{String(cell ?? '')}</td>)}</tr>)}</tbody></table></div></div>;
}

function Stat({ value, label, icon: Icon, href }) {
  const inner = <><Icon className="w-4 h-4 text-[var(--brass-bright)]"/><strong className="text-xl text-white gauge-text">{value}</strong><span className="text-xs text-slate-400">{label}</span></>;
  return href ? <a href={href} className="min-w-[120px] flex-1 bg-[#0a1b23] border border-slate-700 hover:border-[var(--brass-dim)] rounded-lg p-3 flex items-center gap-2 transition-colors">{inner}</a> : <div className="min-w-[120px] flex-1 bg-[#0a1b23] border border-slate-700 rounded-lg p-3 flex items-center gap-2">{inner}</div>;
}

function ContentMiniCard({ entry }) {
  const Icon = TYPE_ICONS[entry.type] || FileText;
  return <Link to={`/archive/${entry.id}`} className="group bg-[#0a1b23] border border-slate-700 hover:border-[var(--brass-dim)] rounded-lg p-4 transition-colors block">
    <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-lg bg-[#16313c] flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-[var(--brass-bright)]"/></div><div className="min-w-0"><p className="text-sm text-slate-200 group-hover:text-white font-medium line-clamp-2">{entry.title}</p><p className="text-xs text-slate-500 mt-1">{entry.year || new Date(entry.createdAt).getFullYear()} · {entry.authors || entry.uploader?.name || 'NCPOR'}</p></div></div>
  </Link>;
}

export default function ArchiveItemPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => { setStatus('loading'); fetchArchiveItem(id).then(res=>{setData(res);setStatus('ready');window.scrollTo(0,0);}).catch(err=>{console.error(err);setStatus(err?.response?.status===404?'notfound':'error');}); }, [id]);
  if (status === 'loading') return <div className="min-h-screen chart-backdrop px-6 py-10 text-slate-500">Loading expedition record…</div>;
  if (status === 'notfound') return <div className="min-h-screen chart-backdrop px-6 py-10"><p className="text-slate-400">This archive item doesn't exist or isn't published yet.</p><Link to="/archive" className="text-cyan-400 hover:underline text-sm mt-2 inline-block">← Back to Archive</Link></div>;
  if (status === 'error') return <div className="min-h-screen chart-backdrop px-6 py-10 text-red-400">Couldn't load this item. Try again.</div>;

  const { item, relatedByType, expeditionContent = [] } = data;
  const expedition = item.expedition;
  const allContent = expeditionContent.length ? expeditionContent : [item];
  const grouped = Object.fromEntries(Object.keys(TYPE_TITLES).map(t => [t, allContent.filter(x => x.type === t)]));
  const researchers = (() => {
    const map = new Map();
    allContent.forEach(x => {
      if (x.uploader?.name) map.set(`u-${x.uploader.id}`, { name:x.uploader.name, organization:x.uploader.organization, role:'Contributor / uploader' });
      (x.authors || '').split(',').map(v=>v.trim()).filter(Boolean).forEach(name => { const k=`a-${name.toLowerCase()}`; if(![...map.values()].some(v=>v.name.toLowerCase()===name.toLowerCase())) map.set(k,{name,organization:x.source || 'Research contributor',role:'Author / researcher'}); });
    });
    if (expedition?.pi?.name) map.set('pi', { name:expedition.pi.name, organization:expedition.pi.organization, role:'Principal Investigator' });
    return [...map.values()];
  })();
  const mediaCount = grouped.photo.length + grouped.video.length;
  const start = expedition?.startDate ? new Date(expedition.startDate) : null;
  const end = expedition?.endDate ? new Date(expedition.endDate) : null;
  const duration = start && end ? Math.max(1, Math.ceil((end-start)/86400000)+1) : null;
  const fmt = d => d ? new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : null;

  return <div className="min-h-screen chart-backdrop px-4 md:px-8 py-8"><div className="max-w-6xl mx-auto">
    <Link to="/archive" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-5"><ArrowLeft className="w-4 h-4"/> Back to Archive</Link>

    <header className="bg-[#0f2129] border border-slate-700 rounded-xl p-6 md:p-8 mb-4 relative overflow-hidden">
      <div className="absolute right-0 top-0 w-64 h-64 rounded-full bg-cyan-900/10 blur-3xl pointer-events-none"/>
      <div className="relative"><div className="flex flex-wrap items-center gap-2 mb-3"><TypeBadge type={item.type}/>{item.type === 'dataset' && <FileRoleBadge role={item.fileRole}/>}<StagePill stage={item.archiveStage}/>{item.status === 'published' && <span className="inline-flex items-center gap-1 text-xs text-emerald-300 border border-emerald-700/60 rounded-full px-2 py-1"><ShieldCheck className="w-3.5 h-3.5"/> NCPOR Approved</span>}</div>
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--brass)] mb-2">Expedition Knowledge Hub</p><h1 className="text-2xl md:text-4xl font-semibold text-white mb-2">{expedition?.name || item.title}</h1>
      <p className="text-slate-400 max-w-3xl">{expedition?.description || item.description || item.summary || 'Central record for the expedition and its connected scientific material.'}</p>
      <div className="flex flex-wrap gap-2 mt-5 text-xs text-slate-300">{expedition?.region && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><MapPin className="w-3.5 h-3.5"/>{REGION_LABEL[expedition.region] || expedition.region}</span>}{(start || item.year) && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5"/>{start ? fmt(start) : item.year}{end ? ` – ${fmt(end)}` : ''}</span>}{duration && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><Clock3 className="w-3.5 h-3.5"/>{duration} days</span>}</div></div>
    </header>

    <div className="flex flex-wrap gap-3 mb-4"><Stat value={researchers.length} label="Researchers" icon={Users} href="#team"/><Stat value={grouped.dataset.length} label="Datasets" icon={Database} href="#data"/><Stat value={grouped.publication.length + grouped.report.length} label="Reports & Papers" icon={FileText} href="#reports"/><Stat value={mediaCount} label="Media" icon={Image} href="#media"/><Stat value={allContent.length} label="Total Records" icon={Layers3}/></div>

    <nav className="sticky top-2 z-20 mb-6 bg-[#0b1c24]/95 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 overflow-x-auto"><div className="flex gap-1 min-w-max text-xs">{[['overview','Overview'],['team','Team'],['timeline','Timeline'],['data','Data'],['reports','Reports & Publications'],['media','Media'],['related','Related'],['provenance','Sources']].map(([a,l])=><a key={a} href={`#${a}`} className="px-3 py-2 rounded-md text-slate-400 hover:text-white hover:bg-[#16313c]">{l}</a>)}</div></nav>

    <div className="space-y-5">
      <Section id="overview" title="Expedition Overview" icon={Compass}><div className="grid md:grid-cols-2 gap-6"><div className="space-y-3"><MetaRow icon={CalendarDays} label="Start date" value={fmt(expedition?.startDate)}/><MetaRow icon={CalendarDays} label="End date" value={fmt(expedition?.endDate)}/><MetaRow icon={MapPin} label="Region" value={REGION_LABEL[item.region || expedition?.region] || item.region || expedition?.region}/><MetaRow icon={Ship} label="Ship" value={expedition?.shipName}/><MetaRow icon={Hash} label="Voyage" value={expedition?.voyageName}/><MetaRow icon={Compass} label="Cruise" value={expedition?.cruiseName}/><MetaRow icon={Hash} label="Cruise / Expedition No." value={expedition?.cruiseNumber}/><MetaRow icon={Navigation} label="Route / Area" value={expedition?.routeArea}/><MetaRow icon={MapPin} label="Stations Visited" value={expedition?.stationsVisited?.length ? expedition.stationsVisited.join(', ') : null}/><MetaRow icon={UserRound} label="Lead researcher" value={expedition?.pi?.name || item.authors || item.uploader?.name}/><MetaRow icon={Building2} label="Institution" value={expedition?.pi?.organization || item.uploader?.organization}/><MetaRow icon={FileText} label="Research domain" value={DOMAIN_LABEL[item.researchDomain]}/></div><div className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4"><h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2"><Navigation className="w-4 h-4 text-[var(--brass)]"/>Location</h3>{expedition?.latitude != null && expedition?.longitude != null ? <><div className="h-24 rounded-md border border-slate-700 bg-[radial-gradient(circle_at_center,rgba(111,212,201,.14),transparent_55%)] flex items-center justify-center"><MapPin className="w-8 h-8 text-cyan-300"/></div><p className="gauge-text text-xs text-slate-400 mt-3">{String(expedition.latitude)}, {String(expedition.longitude)}</p><a className="inline-flex items-center gap-1 text-xs text-cyan-400 mt-2 hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${expedition.latitude}&mlon=${expedition.longitude}#map=5/${expedition.latitude}/${expedition.longitude}`}>Open map <ExternalLink className="w-3 h-3"/></a></> : <p className="text-sm text-slate-500">No expedition coordinates have been catalogued yet.</p>}</div></div>
        {(item.description || item.summary) && <div className="mt-6 pt-5 border-t border-slate-700"><h3 className="text-sm font-semibold text-white mb-2">Mission / research summary</h3><p className="text-sm leading-6 text-slate-400">{item.summary || item.description}</p></div>}
        {item.body && <div className="prose prose-invert prose-sm max-w-none mt-5 text-slate-300" dangerouslySetInnerHTML={{__html:item.body}}/>}
      </Section>

      <Section id="team" title="Research Team" icon={Users}>{researchers.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{researchers.map((r,i)=><div key={`${r.name}-${i}`} className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4"><div className="w-9 h-9 rounded-full bg-[#16313c] flex items-center justify-center mb-3"><UserRound className="w-4 h-4 text-[var(--brass-bright)]"/></div><p className="text-sm font-medium text-white">{r.name}</p><p className="text-xs text-[var(--brass)] mt-1">{r.role}</p><p className="text-xs text-slate-500 mt-1">{r.organization}</p></div>)}</div> : <p className="text-sm text-slate-500">Researcher information has not been catalogued for this expedition yet.</p>}</Section>

      <Section id="timeline" title="Expedition Timeline" icon={Clock3}><div className="relative ml-2 border-l border-slate-700 pl-6 space-y-5">{start && <div><span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--brass-bright)]"/><p className="text-xs text-[var(--brass)]">{fmt(start)}</p><p className="text-sm text-white mt-1">Expedition started</p></div>}{allContent.slice(0,12).map(x=><div key={x.id}><span className="absolute -left-[4px] w-2 h-2 rounded-full bg-cyan-700"/><p className="text-xs text-slate-500">{fmt(x.createdAt)}</p><p className="text-sm text-slate-300 mt-1">{x.title} <span className="text-xs text-slate-600">· {TYPE_TITLES[x.type]}</span></p></div>)}{end && <div><span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--brass-bright)]"/><p className="text-xs text-[var(--brass)]">{fmt(end)}</p><p className="text-sm text-white mt-1">Expedition completed</p></div>}</div></Section>

      <Section id="data" title="Scientific Data" icon={Database}>{grouped.dataset.length ? <div className="space-y-4">{grouped.dataset.map(d=><div key={d.id} className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4"><div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div><div className="flex items-center gap-2 flex-wrap mb-1"><Link to={`/archive/${d.id}`} className="text-sm font-medium text-white hover:text-cyan-300">{d.title}</Link><FileRoleBadge role={d.fileRole}/></div><p className="text-xs text-slate-500">{d.description || `${d.year || ''} scientific dataset`}</p></div><DatasetDownloadButton itemId={d.id} className="inline-flex items-center gap-1 text-xs text-cyan-400 disabled:opacity-60" /></div><DatasetMetaTable meta={d.datasetMeta}/></div>)}</div> : <p className="text-sm text-slate-500">No approved datasets are linked to this expedition yet.</p>}</Section>

      <Section id="reports" title="Reports & Publications" icon={BookOpen}>{[...grouped.report,...grouped.publication].length ? <div className="grid md:grid-cols-2 gap-3">{[...grouped.report,...grouped.publication].map(x=><ContentMiniCard key={x.id} entry={x}/>)}</div> : <p className="text-sm text-slate-500">No approved reports or publications are linked yet.</p>}</Section>

      <Section id="media" title="Photos & Videos" icon={Image}>{mediaCount ? <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{[...grouped.photo,...grouped.video].map(x=><a key={x.id} href={x.fileUrl} target="_blank" rel="noreferrer" className="group bg-[#0a1b23] border border-slate-700 rounded-lg overflow-hidden"><div className="aspect-video bg-[#16313c] relative flex items-center justify-center">{x.thumbnailUrl ? <img src={x.thumbnailUrl} alt={x.title} className="w-full h-full object-cover"/> : x.type==='video' ? <Video className="w-7 h-7 text-slate-500"/> : <Image className="w-7 h-7 text-slate-500"/>}<span className="absolute top-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-[10px] uppercase">{x.type}</span></div><div className="p-3"><p className="text-xs text-slate-300 group-hover:text-white line-clamp-2">{x.title}</p><p className="text-[10px] text-slate-600 mt-1">{x.year || fmt(x.createdAt)}</p></div></a>)}</div> : <p className="text-sm text-slate-500">No approved expedition photos or videos are linked yet.</p>}</Section>

      <Section id="related" title="Related Content" icon={Layers3}>{Object.values(relatedByType || {}).every(a=>!a?.length) ? <p className="text-slate-500 text-sm">No related archive material found yet.</p> : <div className="space-y-5">{Object.entries(TYPE_TITLES).map(([type,label])=>{const key=`${type}s`; const arr=relatedByType?.[key]||[]; return arr.length ? <div key={type}><h3 className="text-sm text-slate-400 mb-2">Related {label}</h3><div className="grid md:grid-cols-2 gap-3">{arr.map(r=><ArchiveResultCard key={r.id} item={r}/>)}</div></div>:null})}</div>}</Section>

      <Section id="provenance" title="Sources, Citation & Provenance" icon={ShieldCheck}><div className="grid md:grid-cols-2 gap-x-8 gap-y-3"><MetaRow icon={Building2} label="Original source" value={item.source}/><MetaRow icon={UserRound} label="Uploaded by" value={item.uploader?.name}/><MetaRow icon={Building2} label="Organization" value={item.uploader?.organization}/><MetaRow icon={CheckCircle2} label="Approved by" value={item.approver?.name}/><MetaRow icon={CalendarDays} label="Uploaded" value={fmt(item.createdAt)}/><MetaRow icon={Clock3} label="Last updated" value={fmt(item.updatedAt)}/><MetaRow icon={TagIcon} label="Keywords" value={item.keywords?.length ? item.keywords.join(', ') : null}/><MetaRow icon={FileText} label="Record ID" value={item.id}/></div>{item.type === 'dataset' ? <DatasetDownloadButton itemId={item.id} label="Download / View Original File" className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium disabled:opacity-60" /> : item.fileUrl && <a href={item.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium"><Download className="w-4 h-4"/> Download / View Original File</a>}</Section>
    </div>
  </div></div>;
}
