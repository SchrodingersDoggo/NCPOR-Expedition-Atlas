import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Building2, CalendarDays, CheckCircle2, Clock3, Compass,
  Database, FileText, Image, Layers3, MapPin, Navigation, ShieldCheck,
  Tag, UserRound, Users, Video, Pencil, Trash2, X, Save,
  CloudOff, Wifi, TriangleAlert, HardDriveDownload, Bookmark, BarChart3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { deleteExpedition, fetchExpeditionById, updateExpedition } from '../api/expeditions.js';
import { fetchExpeditionContent, updateContentItem } from '../api/content.js';
import { enqueueExpeditionEdit, getCachedExpedition } from '../offline/queue.js';
import { runSync } from '../offline/syncManager.js';
import { saveExpeditionOffline, isExpeditionSaved, removeSavedExpedition } from '../offline/savedExpeditions.js';
import { useAuth } from '../context/AuthContext.jsx';
import RichTextEditor from '../components/RichTextEditor.jsx';
import AlertReportModal from '../components/AlertReportModal.jsx';
import DangerBadge from '../components/DangerBadge.jsx';
import AlertsList from '../components/AlertsList.jsx';
import { buildOceanSectionFromMeta } from '../utils/oceanSection.js';
import OceanSection3D from '../components/OceanSection3D.jsx';
import TempSalinityDepth3D from '../components/TempSalinityDepth3D.jsx';
import DatasetDownloadButton from '../components/DatasetDownloadButton.jsx';
import { canReadDataset } from '../viz/registry.js';

const REGION_OPTIONS = ['', 'Arctic', 'Antarctic', 'Himalaya', 'Southern_Ocean', 'Other'];
const TYPE_LABEL = {
  report: 'Report', publication: 'Publication', dataset: 'Dataset',
  photo: 'Photo', video: 'Video', activity: 'Activity'
};

function toForm(exp) {
  return {
    name: exp?.name || '',
    region: exp?.region || '',
    description: exp?.description || '',
    start_date: exp?.startDate ? String(exp.startDate).slice(0, 10) : '',
    end_date: exp?.endDate ? String(exp.endDate).slice(0, 10) : '',
    latitude: exp?.latitude ?? '',
    longitude: exp?.longitude ?? '',
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (Expedition Knowledge Hub layout)
// ---------------------------------------------------------------------------

function Section({ id, title, icon: Icon, children }) {
  return (
    <section id={id} className="scroll-mt-24 bg-[#0f2129] border border-slate-700 rounded-xl p-5 md:p-7">
      <h2 className="text-lg md:text-xl font-semibold text-white mb-5 flex items-center gap-2">
        <Icon className="w-5 h-5 text-[var(--brass-bright)]" /> {title}
      </h2>
      {children}
    </section>
  );
}

function MetaRow({ icon: Icon, label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 text-[var(--brass)] mt-0.5 shrink-0" />
      <span className="text-slate-400 w-32 shrink-0">{label}</span>
      <span className="text-slate-200 break-words">{value}</span>
    </div>
  );
}

function Stat({ value, label, icon: Icon, href }) {
  return (
    <a href={href} className="min-w-[120px] flex-1 bg-[#0a1b23] border border-slate-700 hover:border-[var(--brass-dim)] rounded-lg p-3 flex items-center gap-2 transition-colors">
      <Icon className="w-4 h-4 text-[var(--brass-bright)]" />
      <strong className="text-xl text-white gauge-text">{value}</strong>
      <span className="text-xs text-slate-400">{label}</span>
    </a>
  );
}

function normaliseDatasetMeta(raw) {
  if (!raw) return null;
  let meta = raw;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return null; }
  }
  if (!meta || typeof meta !== 'object') return null;
  const columns = Array.isArray(meta.columns) ? meta.columns : [];
  const sourceRows = Array.isArray(meta.preview_rows) ? meta.preview_rows : [];
  const rows = sourceRows.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === 'object') return columns.map((col) => row[col.name]);
    return [row];
  });
  return { ...meta, columns, preview_rows: rows };
}

function DatasetPreview({ item, expeditionId }) {
  const meta = normaliseDatasetMeta(item.datasetMeta);
  return (
    <div className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{item.title}</p>
          <p className="text-xs text-slate-500 mt-1">{item.description || 'Scientific dataset linked to this expedition.'}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {canReadDataset(item.originalFileName || item.fileName || item.title || '') && (
            <Link to={`/expeditions/${expeditionId}/visualize?dataset=${item.id}`} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200">
              <BarChart3 className="w-3.5 h-3.5" /> Visualize
            </Link>
          )}
          <DatasetDownloadButton
            itemId={item.id}
            className="inline-flex items-center gap-1 text-xs text-cyan-400 disabled:opacity-60"
          />
        </div>
      </div>
      {meta && meta.columns.length > 0 ? (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs text-slate-500">{meta.row_count ?? '—'} rows · {meta.columns.length} columns</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {meta.columns.map((col, idx) => (
              <span key={`${col.name}-${idx}`} className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">
                {col.name}<span className="text-slate-600"> · {col.type || 'text'}</span>
              </span>
            ))}
          </div>
          {meta.preview_rows.length > 0 ? (
            <div className="rounded-md overflow-x-auto border border-slate-800">
              <table className="w-full text-xs text-slate-400">
                <thead className="bg-slate-800/60"><tr>
                  {meta.columns.map((col, idx) => <th key={`${col.name}-${idx}`} className="p-2 text-left whitespace-nowrap text-slate-200">{col.name}</th>)}
                </tr></thead>
                <tbody>
                  {meta.preview_rows.slice(0, 8).map((row, rIdx) => (
                    <tr key={rIdx} className="border-t border-slate-800">
                      {meta.columns.map((_, cIdx) => <td key={cIdx} className="p-2 whitespace-nowrap">{String(row[cIdx] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">Dataset metadata is available, but there are no preview rows.</p>}
          <DatasetOceanPreview meta={meta} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 mt-3">Preview metadata is not available for this dataset. The original file can still be opened above.</p>
      )}
    </div>
  );
}

// Renders the 3D depth/temperature/salinity viewer for an already-submitted
// dataset, built from the small server-stored preview_rows (not the full
// table — that never leaves the browser at upload time). Silently renders
// nothing when the dataset doesn't look like a depth profile.
function DatasetOceanPreview({ meta }) {
  // Memoized so the 3D widgets below only rebuild their WebGL scene when the
  // underlying dataset actually changes — not on every unrelated re-render
  // of this page (which would otherwise recreate the renderer/canvas mid-
  // frame and can briefly show a stale, wrongly-sized mesh alongside the
  // fresh one).
  const section = useMemo(() => buildOceanSectionFromMeta(meta), [meta]);
  if (!section) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-white">3D ocean section</h4>
        <span className="text-xs text-slate-500">from preview data only</span>
      </div>
      <OceanSection3D section={section} />
      <TempSalinityDepth3D section={section} />
    </div>
  );
}

function ContentCard({ item }) {
  return (
    <div className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-[var(--brass)]">{TYPE_LABEL[item.type] || item.type}</span>
          <p className="text-sm font-medium text-white mt-1">{item.title}</p>
          {item.description && <p className="text-xs text-slate-500 mt-1 line-clamp-3">{item.description}</p>}
        </div>
        {item.type === 'dataset' ? <DatasetDownloadButton itemId={item.id} label="Open" showIcon={false} className="text-xs text-cyan-400 shrink-0 disabled:opacity-60" /> : item.fileUrl && <a href={item.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 shrink-0">Open</a>}
      </div>
    </div>
  );
}

function ReportDetailCard({ item }) {
  return (
    <article className="bg-[#0a1b23] border border-slate-700 rounded-xl overflow-hidden">
      <div className="p-5 md:p-6 border-b border-slate-800">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--brass)]">{TYPE_LABEL[item.type] || item.type}</span>
            <h3 className="text-lg font-semibold text-white mt-1">{item.title}</h3>
            {item.description && <p className="text-sm text-slate-400 mt-2">{item.description}</p>}
          </div>
          {item.fileUrl && (
            <a href={item.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-cyan-300 border border-cyan-800/60 rounded-md px-3 py-2 hover:bg-cyan-950/30 shrink-0">
              <FileText className="w-3.5 h-3.5" /> Open original file
            </a>
          )}
        </div>
      </div>

      {item.summary && (
        <div className="p-5 md:p-6 border-b border-slate-800">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--brass)] mb-2">Summary</p>
          <p className="text-sm leading-7 text-slate-300 whitespace-pre-wrap">{item.summary}</p>
        </div>
      )}

      {item.body && (
        <div className="p-5 md:p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--brass)] mb-3">Full article</p>
          <div
            className="prose prose-invert prose-sm md:prose-base max-w-none text-slate-300 prose-headings:text-white prose-strong:text-white prose-a:text-cyan-300"
            dangerouslySetInnerHTML={{ __html: item.body }}
          />
        </div>
      )}

      {!item.summary && !item.body && (
        <div className="p-5 md:p-6 text-sm text-slate-500">
          No written summary or article text is stored for this record.
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Quick edit — offline-safe. Available to researcher/comms_officer/admin
// (matches the route's own role guard). Goes through the same durable
// enqueue-then-sync path as every other offline write in this app: the
// edit is saved to IndexedDB with the server version it was based on
// *before* anything touches the network, so a connection dropping the
// instant after Save can never lose it. Conflicts are resolved by the
// server (see expedition.controller.js) and surfaced in the Sync Center,
// not here — this form only ever writes locally.
function QuickEditPanel({ expedition, online, onClose, onQueued }) {
  const [form, setForm] = useState(() => toForm(expedition));
  const [saving, setSaving] = useState(false);
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.name.trim()) {
      toast.error('Expedition name is required.');
      return;
    }
    setSaving(true);
    try {
      const changes = {
        name: form.name.trim(),
        region: form.region || undefined,
        description: form.description || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        latitude: form.latitude === '' ? undefined : Number(form.latitude),
        longitude: form.longitude === '' ? undefined : Number(form.longitude),
      };

      // Always make the edit durable first — this is what makes the field
      // flow safe. See offline/queue.js#enqueueExpeditionEdit.
      await enqueueExpeditionEdit({
        expeditionId: expedition.id,
        expectedUpdatedAt: expedition.updatedAt,
        changes,
      });

      toast.success(online ? 'Edit saved locally — synchronization started.' : 'Edit saved offline — it will sync automatically when internet returns.');
      if (online) void runSync();
      onQueued?.(changes);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not save the edit locally.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-lg bg-[#0f1f2b] border border-slate-700 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Quick edit</h2>
            <p className="text-xs text-slate-500 mt-1">
              Offline-safe: saved to this device first, so a weak connection can't lose it.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <label className="block text-sm text-slate-300">Name
            <input value={form.name} onChange={(e) => setField('name', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" />
          </label>
          <label className="block text-sm text-slate-300">Region
            <select value={form.region} onChange={(e) => setField('region', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white">
              {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r || 'Not specified'}</option>)}
            </select>
          </label>
          <label className="block text-sm text-slate-300">Description
            <textarea value={form.description} onChange={(e) => setField('description', e.target.value)} rows={4} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm text-slate-300">Start date<input type="date" value={form.start_date} onChange={(e) => setField('start_date', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" /></label>
            <label className="block text-sm text-slate-300">End date<input type="date" value={form.end_date} onChange={(e) => setField('end_date', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" /></label>
            <label className="block text-sm text-slate-300">Latitude<input type="number" step="any" value={form.latitude} onChange={(e) => setField('latitude', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" /></label>
            <label className="block text-sm text-slate-300">Longitude<input type="number" step="any" value={form.longitude} onChange={(e) => setField('longitude', e.target.value)} className="mt-1 w-full rounded-lg bg-[#0b1c25] border border-slate-700 p-3 text-white" /></label>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-700 pt-5">
          <p className="text-xs text-slate-500">Based on server version {new Date(expedition.updatedAt).toLocaleString()}</p>
          <button disabled={saving} onClick={save} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full record edit — staff only (comms_officer/admin), online only. Bulk
// edits the expedition plus every linked content item's archive metadata
// and article text in one go. Deliberately NOT offline-queued: it can touch
// dozens of records at once, which the single-item offline queue was never
// designed to represent, and staff editing the archive are assumed to be at
// a desk with a real connection rather than in the field.
function FullRecordEditModal({ expedition, content, onClose, onSaved }) {
  const all = content.all || [];
  const [busy, setBusy] = useState(false);
  const [editForm, setEditForm] = useState(() => ({
    name: expedition.name || '',
    region: expedition.region || 'Other',
    description: expedition.description || '',
    start_date: expedition.startDate ? new Date(expedition.startDate).toISOString().slice(0, 10) : '',
    end_date: expedition.endDate ? new Date(expedition.endDate).toISOString().slice(0, 10) : '',
    latitude: expedition.latitude ?? '',
    longitude: expedition.longitude ?? '',
  }));
  const [contentEdits, setContentEdits] = useState(() => all.map((item) => ({
    id: item.id,
    type: item.type || 'report',
    title: item.title || '',
    description: item.description || '',
    summary: item.summary || '',
    body: item.body || '',
    authors: item.authors || '',
    source: item.source || '',
    year: item.year ?? '',
    region: item.region || expedition.region || 'Other',
    research_domain: item.researchDomain || '',
    keywords: Array.isArray(item.tags)
      ? item.tags.map((entry) => entry?.tag?.name || entry?.name).filter(Boolean).join(', ')
      : '',
  })));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!editForm.name.trim()) {
      toast.error('Expedition name is required.');
      return;
    }
    if (editForm.start_date && editForm.end_date && new Date(editForm.end_date) < new Date(editForm.start_date)) {
      toast.error('End date cannot be before the start date.');
      return;
    }
    const invalidContent = contentEdits.find((item) => !item.title.trim());
    if (invalidContent) {
      toast.error('Every linked record must have a title.');
      return;
    }

    setBusy(true);
    try {
      const updated = await updateExpedition(expedition.id, {
        name: editForm.name.trim(),
        region: editForm.region || null,
        description: editForm.description.trim() || null,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        latitude: editForm.latitude === '' ? null : Number(editForm.latitude),
        longitude: editForm.longitude === '' ? null : Number(editForm.longitude),
      });

      await Promise.all(contentEdits.map((item) => updateContentItem(item.id, {
        type: item.type,
        title: item.title.trim(),
        description: item.description.trim() || null,
        summary: item.summary.trim() || null,
        body: item.body || null,
        authors: item.authors.trim() || null,
        source: item.source.trim() || null,
        year: item.year === '' ? null : Number(item.year),
        region: item.region || null,
        research_domain: item.research_domain || null,
        keywords: item.keywords,
      })));

      toast.success('Expedition and linked content updated.');
      await onSaved(updated);
      onClose();
    } catch (err) {
      console.error('Failed to update expedition', err);
      toast.error(err?.response?.data?.error || 'Could not update the expedition.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form onSubmit={handleSubmit} className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-[#0f2129] border border-slate-700 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Edit full record</h2>
            <p className="text-xs text-slate-500 mt-1">Updates the expedition and every linked report/dataset/media record. Requires a connection.</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <label className="md:col-span-2 text-xs text-slate-400">
            Expedition name
            <input required value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
          </label>
          <label className="text-xs text-slate-400">
            Region
            <select value={editForm.region} onChange={(e) => setEditForm((f) => ({ ...f, region: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600">
              <option value="Arctic">Arctic</option>
              <option value="Antarctic">Antarctic</option>
              <option value="Himalaya">Himalaya</option>
              <option value="Southern_Ocean">Southern Ocean</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <div />
          <label className="text-xs text-slate-400">
            Start date
            <input type="date" value={editForm.start_date} onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
          </label>
          <label className="text-xs text-slate-400">
            End date
            <input type="date" value={editForm.end_date} onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
          </label>
          <label className="text-xs text-slate-400">
            Latitude
            <input type="number" step="any" min="-90" max="90" value={editForm.latitude} onChange={(e) => setEditForm((f) => ({ ...f, latitude: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
          </label>
          <label className="text-xs text-slate-400">
            Longitude
            <input type="number" step="any" min="-180" max="180" value={editForm.longitude} onChange={(e) => setEditForm((f) => ({ ...f, longitude: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
          </label>
          <label className="md:col-span-2 text-xs text-slate-400">
            Description / mission summary
            <textarea rows="5" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="mt-1.5 w-full bg-[#0a1b23] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600 resize-y" />
          </label>
        </div>

        <div className="px-5 pb-5">
          <div className="border-t border-slate-700 pt-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Linked reports, datasets & media</h3>
              <p className="text-xs text-slate-500 mt-1">Edit the content stored under this expedition, including titles, summaries, full article text and archive metadata.</p>
            </div>

            {contentEdits.length === 0 ? (
              <p className="text-sm text-slate-500">No linked content records are available to edit.</p>
            ) : (
              <div className="space-y-4">
                {contentEdits.map((item, index) => {
                  const setField = (field, value) => setContentEdits((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
                  const isWritten = ['report', 'publication'].includes(item.type);
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-700 bg-[#0a1b23] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <p className="text-sm font-medium text-white">{item.title || `Record ${index + 1}`}</p>
                        <span className="text-[10px] uppercase tracking-wider text-[var(--brass)]">{TYPE_LABEL[item.type] || item.type}</span>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <label className="text-xs text-slate-400">
                          Content type
                          <select value={item.type} onChange={(e) => setField('type', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600">
                            <option value="report">Report</option>
                            <option value="dataset">Dataset</option>
                            <option value="publication">Publication</option>
                            <option value="photo">Photo</option>
                            <option value="video">Video</option>
                            <option value="activity">Activity</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Title
                          <input required value={item.title} onChange={(e) => setField('title', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
                        </label>
                        <label className="md:col-span-2 text-xs text-slate-400">
                          Description
                          <textarea rows="2" value={item.description} onChange={(e) => setField('description', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600 resize-y" />
                        </label>
                        <label className="text-xs text-slate-400">
                          Authors / researchers
                          <input value={item.authors} onChange={(e) => setField('authors', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
                        </label>
                        <label className="text-xs text-slate-400">
                          Source
                          <input value={item.source} onChange={(e) => setField('source', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
                        </label>
                        <label className="text-xs text-slate-400">
                          Archive year
                          <input type="number" min="1800" max="2200" value={item.year} onChange={(e) => setField('year', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
                        </label>
                        <label className="text-xs text-slate-400">
                          Region
                          <select value={item.region} onChange={(e) => setField('region', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600">
                            <option value="Arctic">Arctic</option>
                            <option value="Antarctic">Antarctic</option>
                            <option value="Himalaya">Himalaya</option>
                            <option value="Southern_Ocean">Southern Ocean</option>
                            <option value="Other">Other</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Research domain
                          <select value={item.research_domain} onChange={(e) => setField('research_domain', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600">
                            <option value="">Unspecified</option>
                            <option value="climate_science">Climate Science</option>
                            <option value="glaciology">Glaciology</option>
                            <option value="oceanography">Oceanography</option>
                            <option value="atmospheric_science">Atmospheric Science</option>
                            <option value="geology">Geology</option>
                            <option value="biology_ecology">Biology / Ecology</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Keywords
                          <input value={item.keywords} onChange={(e) => setField('keywords', e.target.value)} placeholder="ice, climate, antarctica" className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" />
                        </label>

                        {isWritten && (
                          <>
                            <label className="md:col-span-2 text-xs text-slate-400">
                              Summary
                              <textarea rows="4" value={item.summary} onChange={(e) => setField('summary', e.target.value)} className="mt-1.5 w-full bg-[#0f2129] border border-slate-700 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600 resize-y" />
                            </label>
                            <div className="md:col-span-2 text-xs text-slate-400">
                              <span className="block mb-1.5">Full article</span>
                              <RichTextEditor key={`${item.id}-article`} value={item.body} onChange={(value) => setField('body', value)} placeholder="Edit the full report/article text…" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700">
          <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 rounded-md border border-slate-700 text-slate-300 text-sm hover:bg-slate-800 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> {busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExpeditionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const isStaff = isAuthenticated && ['admin', 'comms_officer'].includes(user?.role);

  const [expedition, setExpedition] = useState(null);
  const [content, setContent] = useState({ reports: [], photos: [], data: [], all: [] });
  const [status, setStatus] = useState('loading');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlineLimited, setOfflineLimited] = useState(false); // cached expedition, but no content
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [showFullEdit, setShowFullEdit] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOffline() {
      const cached = await getCachedExpedition(id).catch(() => null);
      if (cancelled) return;
      if (cached) {
        setExpedition(cached);
        setContent({ reports: [], photos: [], data: [], all: [] });
        setOfflineLimited(true);
        setStatus('offline');
      } else {
        setStatus('error');
      }
    }

    async function load() {
      setStatus('loading');
      if (!navigator.onLine) return loadOffline();
      try {
        const [exp, buckets] = await Promise.all([fetchExpeditionById(id), fetchExpeditionContent(id)]);
        if (cancelled) return;
        setExpedition(exp);
        setContent(buckets);
        setOfflineLimited(false);
        setStatus('ready');
        window.scrollTo(0, 0);
      } catch (err) {
        if (!cancelled) await loadOffline();
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (user?.id && expedition?.id) {
      isExpeditionSaved(user.id, expedition.id).then((v) => { if (!cancelled) setSaved(v); });
    }
    return () => { cancelled = true; };
  }, [user?.id, expedition?.id]);

  const all = content.all || [...content.reports, ...content.photos, ...content.data];
  const publications = all.filter((x) => x.type === 'publication');
  const reportsOnly = all.filter((x) => x.type === 'report');
  const photos = all.filter((x) => x.type === 'photo');
  const videos = all.filter((x) => x.type === 'video');

  const researchers = useMemo(() => {
    if (!expedition) return [];
    const names = new Map();
    if (expedition.pi?.name) names.set(expedition.pi.name.toLowerCase(), {
      name: expedition.pi.name,
      role: 'Principal Investigator',
      organization: expedition.pi.organization || 'NCPOR'
    });
    all.forEach((item) => {
      if (item.uploader?.name) names.set(item.uploader.name.toLowerCase(), {
        name: item.uploader.name,
        role: 'Research contributor / uploader',
        organization: item.uploader.organization || 'NCPOR'
      });
      String(item.authors || '').split(',').map((v) => v.trim()).filter(Boolean).forEach((name) => {
        const key = name.toLowerCase();
        if (!names.has(key)) names.set(key, { name, role: 'Author / researcher', organization: item.source || 'Research contributor' });
      });
    });
    return [...names.values()];
  }, [expedition, all]);

  async function handleDeleteExpedition() {
    if (!isStaff || deleteBusy || !expedition) return;
    const confirmed = window.confirm(
      `Delete "${expedition.name}"? This permanently removes the expedition and ALL linked reports, datasets, publications, photos, videos and generated portal records. This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    try {
      await deleteExpedition(id);
      toast.success('Expedition and linked data deleted.');
      navigate('/archive');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not delete the expedition.');
      setDeleteBusy(false);
    }
  }

  async function handleToggleSaveOffline() {
    if (!user?.id || saveBusy) return;
    setSaveBusy(true);
    try {
      if (saved) {
        await removeSavedExpedition(user.id, expedition.id);
        setSaved(false);
        toast.success('Removed from offline saves.');
      } else {
        await saveExpeditionOffline({ ownerId: user.id, expedition, content });
        setSaved(true);
        toast.success('Saved for offline reading.');
      }
    } catch (err) {
      toast.error(err.message || 'Could not update offline save.');
    } finally {
      setSaveBusy(false);
    }
  }

  if (!isAuthenticated) {
    return <div className="min-h-screen bg-[#0b1c25] p-8 text-white">Please sign in to view this expedition.</div>;
  }
  if (status === 'loading') return <div className="min-h-screen bg-[#0b1c25] px-6 py-10 text-slate-400">Opening expedition…</div>;
  if (status === 'error' || !expedition) return <div className="min-h-screen bg-[#0b1c25] px-6 py-10 text-red-300">This expedition is not available offline yet.</div>;

  const fmt = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const start = expedition.startDate ? new Date(expedition.startDate) : null;
  const end = expedition.endDate ? new Date(expedition.endDate) : null;
  const duration = start && end ? Math.max(1, Math.ceil((end - start) / 86400000) + 1) : null;
  const timelineItems = [...all].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <div className="min-h-screen chart-backdrop px-4 md:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Back to Expedition Atlas
          </button>
          <div className="flex items-center gap-2">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${online ? 'border-emerald-700/60 text-emerald-300' : 'border-amber-700/60 text-amber-300'}`}>
              {online ? <Wifi className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
              {online ? 'Online' : 'Offline'}
            </div>
            <DangerBadge level={expedition.dangerLevel} />
          </div>
        </div>

        {offlineLimited && (
          <div className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            You're viewing a cached, offline copy. Reports, datasets and media sections need a connection to load — check
            {' '}<Link to="/saved-offline" className="underline">your saved-offline expeditions</Link> for content saved in advance.
          </div>
        )}

        {showAlertModal && (
          <AlertReportModal
            expeditionId={id}
            onClose={() => setShowAlertModal(false)}
            onSent={(alert) => {
              if (alert.expedition?.dangerLevel) {
                setExpedition((prev) => (prev ? { ...prev, dangerLevel: alert.expedition.dangerLevel } : prev));
              }
            }}
          />
        )}
        {showQuickEdit && (
          <QuickEditPanel
            expedition={expedition}
            online={online}
            onClose={() => setShowQuickEdit(false)}
            onQueued={(changes) => setExpedition((prev) => (prev ? { ...prev, ...changes } : prev))}
          />
        )}
        {showFullEdit && isStaff && (
          <FullRecordEditModal
            expedition={expedition}
            content={content}
            onClose={() => setShowFullEdit(false)}
            onSaved={async (updated) => {
              setExpedition((prev) => ({ ...prev, ...updated }));
              const refreshed = await fetchExpeditionContent(id);
              setContent(refreshed);
            }}
          />
        )}

        <header className="bg-[#0f2129] border border-slate-700 rounded-xl p-6 md:p-8 mb-4 relative overflow-hidden">
          <div className="absolute right-0 top-0 w-64 h-64 rounded-full bg-cyan-900/10 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="flex flex-wrap gap-2 md:absolute md:right-0 md:top-0 mb-4 md:mb-0">
              <button
                type="button"
                onClick={() => setShowAlertModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-red-700/60 bg-red-950/40 text-red-300 hover:bg-red-900/50 text-xs font-semibold"
              >
                <TriangleAlert className="w-3.5 h-3.5" /> Report Danger
              </button>
              <button
                type="button"
                onClick={handleToggleSaveOffline}
                disabled={saveBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium disabled:opacity-50"
              >
                {saved ? <Bookmark className="w-3.5 h-3.5 fill-current" /> : <HardDriveDownload className="w-3.5 h-3.5" />}
                {saved ? 'Saved offline' : 'Save for offline'}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickEdit(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-cyan-800 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-950/40 text-xs font-medium"
              >
                <Pencil className="w-3.5 h-3.5" /> Quick edit
              </button>
              {isStaff && !offlineLimited && (
                <button
                  type="button"
                  onClick={() => setShowFullEdit(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-cyan-800 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-950/40 text-xs font-medium"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit full record
                </button>
              )}
              {isStaff && (
                <button
                  type="button"
                  onClick={handleDeleteExpedition}
                  disabled={deleteBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-red-800 text-red-300 bg-red-950/20 hover:bg-red-950/40 text-xs font-medium disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {deleteBusy ? 'Deleting…' : 'Delete expedition'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3 md:pr-64">
              <span className="inline-flex items-center gap-1 text-xs text-emerald-300 border border-emerald-700/60 rounded-full px-2 py-1"><ShieldCheck className="w-3.5 h-3.5" /> Expedition Record</span>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--brass)] mb-2">Expedition Knowledge Hub</p>
            <h1 className="text-2xl md:text-4xl font-semibold text-white mb-2">{expedition.name}</h1>
            <p className="text-slate-400 max-w-3xl">{expedition.description || 'Central record for this expedition and all approved scientific material linked to it.'}</p>
            <div className="flex flex-wrap gap-2 mt-5 text-xs text-slate-300">
              {expedition.region && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{String(expedition.region).replace('_', ' ')}</span>}
              {start && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{fmt(start)}{end ? ` – ${fmt(end)}` : ''}</span>}
              {duration && <span className="px-2.5 py-1.5 bg-[#16313c] rounded-md flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" />{duration} days</span>}
            </div>
          </div>
        </header>

        {!offlineLimited && (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              <Stat value={researchers.length} label="Researchers" icon={Users} href="#team" />
              <Stat value={content.data.length} label="Datasets" icon={Database} href="#data" />
              <Stat value={reportsOnly.length + publications.length} label="Reports & Papers" icon={FileText} href="#reports" />
              <Stat value={photos.length + videos.length} label="Media" icon={Image} href="#media" />
              <Stat value={all.length} label="Total Records" icon={Layers3} href="#related" />
            </div>

            <nav className="sticky top-2 z-20 mb-6 bg-[#0b1c24]/95 backdrop-blur border border-slate-700 rounded-lg px-3 py-2 overflow-x-auto">
              <div className="flex gap-1 min-w-max text-xs">
                {[['overview', 'Overview'], ['team', 'Team'], ['timeline', 'Timeline'], ['data', 'Data'], ['reports', 'Reports & Publications'], ['media', 'Media'], ['related', 'Connected Records'], ['alerts', 'Alerts'], ['provenance', 'Sources']].map(([key, label]) => (
                  <a key={key} href={`#${key}`} className="px-3 py-2 rounded-md text-slate-400 hover:text-white hover:bg-[#16313c]">{label}</a>
                ))}
              </div>
            </nav>
          </>
        )}

        <div className="space-y-5">
          <Section id="overview" title="Expedition Overview" icon={Compass}>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <MetaRow icon={CalendarDays} label="Start date" value={fmt(expedition.startDate)} />
                <MetaRow icon={CalendarDays} label="End date" value={fmt(expedition.endDate)} />
                <MetaRow icon={MapPin} label="Region" value={String(expedition.region || 'Other').replace('_', ' ')} />
                <MetaRow icon={UserRound} label="Lead researcher" value={expedition.pi?.name} />
                <MetaRow icon={Building2} label="Institution" value={expedition.pi?.organization} />
                <MetaRow icon={Tag} label="Expedition ID" value={expedition.id} />
              </div>
              <div className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4">
                <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2"><Navigation className="w-4 h-4 text-[var(--brass)]" />Location</h3>
                {expedition.latitude != null && expedition.longitude != null ? (
                  <>
                    <div className="h-24 rounded-md border border-slate-700 bg-[radial-gradient(circle_at_center,rgba(111,212,201,.14),transparent_55%)] flex items-center justify-center"><MapPin className="w-8 h-8 text-cyan-300" /></div>
                    <p className="gauge-text text-xs text-slate-400 mt-3">{String(expedition.latitude)}, {String(expedition.longitude)}</p>
                  </>
                ) : <p className="text-sm text-slate-500">No coordinates have been catalogued for this expedition.</p>}
              </div>
            </div>
            {expedition.description && <div className="mt-6 pt-5 border-t border-slate-700"><h3 className="text-sm font-semibold text-white mb-2">Mission / research summary</h3><p className="text-sm leading-6 text-slate-400">{expedition.description}</p></div>}
          </Section>

          {!offlineLimited && (
            <>
              <Section id="team" title="Research Team" icon={Users}>
                {researchers.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{researchers.map((r, i) => (
                  <div key={`${r.name}-${i}`} className="bg-[#0a1b23] border border-slate-700 rounded-lg p-4">
                    <div className="w-9 h-9 rounded-full bg-[#16313c] flex items-center justify-center mb-3"><UserRound className="w-4 h-4 text-[var(--brass-bright)]" /></div>
                    <p className="text-sm font-medium text-white">{r.name}</p><p className="text-xs text-[var(--brass)] mt-1">{r.role}</p><p className="text-xs text-slate-500 mt-1">{r.organization}</p>
                  </div>
                ))}</div> : <p className="text-sm text-slate-500">Researcher information has not been catalogued yet.</p>}
              </Section>

              <Section id="timeline" title="Expedition Timeline" icon={Clock3}>
                <div className="relative ml-2 border-l border-slate-700 pl-6 space-y-5">
                  {start && <div><span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--brass-bright)]" /><p className="text-xs text-[var(--brass)]">{fmt(start)}</p><p className="text-sm text-white mt-1">Expedition started</p></div>}
                  {timelineItems.slice(0, 20).map((item) => <div key={item.id}><span className="absolute -left-[4px] w-2 h-2 rounded-full bg-cyan-700" /><p className="text-xs text-slate-500">{fmt(item.createdAt)}</p><p className="text-sm text-slate-300 mt-1">{item.title} <span className="text-xs text-slate-600">· {TYPE_LABEL[item.type] || item.type}</span></p></div>)}
                  {end && <div><span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--brass-bright)]" /><p className="text-xs text-[var(--brass)]">{fmt(end)}</p><p className="text-sm text-white mt-1">Expedition completed</p></div>}
                </div>
              </Section>

              <Section id="data" title="Scientific Data" icon={Database}>
                {content.data.length ? (
                  <>
                    <div className="mb-4 flex justify-end">
                      <Link to={`/expeditions/${id}/visualize`} className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/60 bg-emerald-950/20 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-950/35">
                        <BarChart3 className="w-4 h-4" /> Visualize Data
                      </Link>
                    </div>
                    <div className="space-y-4">{content.data.map((item) => <DatasetPreview key={item.id} item={item} expeditionId={id} />)}</div>
                  </>
                ) : <p className="text-sm text-slate-500">No approved or archived datasets are linked to this expedition yet.</p>}
              </Section>

              <Section id="reports" title="Reports & Publications" icon={BookOpen}>
                {[...reportsOnly, ...publications].length ? (
                  <div className="space-y-5">
                    {[...reportsOnly, ...publications].map((item) => <ReportDetailCard key={item.id} item={item} />)}
                  </div>
                ) : <p className="text-sm text-slate-500">No reports or publications are linked yet.</p>}
              </Section>

              <Section id="media" title="Photos & Videos" icon={Image}>
                {[...photos, ...videos].length ? <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{[...photos, ...videos].map((item) => (
                  <a key={item.id} href={item.fileUrl} target="_blank" rel="noreferrer" className="group bg-[#0a1b23] border border-slate-700 rounded-lg overflow-hidden">
                    <div className="aspect-video bg-[#16313c] relative flex items-center justify-center">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" /> : item.type === 'video' ? <Video className="w-7 h-7 text-slate-500" /> : <Image className="w-7 h-7 text-slate-500" />}<span className="absolute top-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-[10px] uppercase">{item.type}</span></div>
                    <div className="p-3"><p className="text-xs text-slate-300 group-hover:text-white line-clamp-2">{item.title}</p></div>
                  </a>
                ))}</div> : <p className="text-sm text-slate-500">No photos or videos are linked yet.</p>}
              </Section>

              <Section id="related" title="Connected Expedition Records" icon={Layers3}>
                {all.length ? <div className="grid md:grid-cols-2 gap-3">{all.map((item) => <ContentCard key={item.id} item={item} />)}</div> : <p className="text-sm text-slate-500">No approved content records are linked to this expedition yet.</p>}
              </Section>
            </>
          )}

          <Section id="alerts" title="Alert History" icon={TriangleAlert}>
            <AlertsList
              expeditionId={id}
              onDangerLevelChange={(newLevel) => setExpedition((prev) => (prev ? { ...prev, dangerLevel: newLevel } : prev))}
            />
          </Section>

          {!offlineLimited && (
            <Section id="provenance" title="Sources & Provenance" icon={ShieldCheck}>
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
                <MetaRow icon={UserRound} label="Principal investigator" value={expedition.pi?.name} />
                <MetaRow icon={Building2} label="Organization" value={expedition.pi?.organization} />
                <MetaRow icon={CalendarDays} label="Expedition start" value={fmt(expedition.startDate)} />
                <MetaRow icon={CheckCircle2} label="Linked records" value={`${all.length} approved/archive record${all.length === 1 ? '' : 's'}`} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
