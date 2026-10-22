import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Database, FileText, HardDriveDownload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { getSavedExpeditions, isLargeMinioDatasetForAutomaticOfflineCache, removeSavedExpedition } from '../offline/savedExpeditions.js';

function useBlobUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file?.blob) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function OfflineFileLink({ item, children, className = '' }) {
  const url = useBlobUrl(item.offlineFile);
  if (!url) {
    return <span className={`${className} opacity-50 cursor-not-allowed`} title="This attachment was not available when the expedition was saved">{children}</span>;
  }
  return <a href={url} target="_blank" rel="noreferrer" download={item.offlineFile?.name} className={className}>{children}</a>;
}

function OfflinePhoto({ item }) {
  const thumbnail = useBlobUrl(item.offlineThumbnail || item.offlineFile);
  return (
    <OfflineFileLink item={item} className="block rounded-lg overflow-hidden border border-slate-700 bg-[#0f2129] hover:border-cyan-700 transition">
      {thumbnail && item.type === 'photo' ? (
        <img src={thumbnail} alt={item.title} className="w-full h-32 object-cover" />
      ) : (
        <div className="w-full h-32 flex items-center justify-center text-slate-500"><ImageIcon className="w-7 h-7" /></div>
      )}
      <div className="px-3 py-2 text-sm text-white truncate">{item.title}</div>
    </OfflineFileLink>
  );
}

function ExpeditionDetail({ record, onBack, onRemove }) {
  const [tab, setTab] = useState('reports');
  const exp = record.expedition;
  const content = record.content || { reports: [], photos: [], data: [] };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to saved expeditions
      </button>

      <div className="brass-plate rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Available offline</div>
            <h1 className="text-2xl italic text-white" style={{ fontFamily: 'var(--font-display)' }}>{exp.name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-400 mt-3">
              <span>Region: {(exp.region || 'Other').replace('_', ' ')}</span>
              <span>Year: {exp.year || (exp.startDate ? new Date(exp.startDate).getFullYear() : '—')}</span>
              <span>Principal investigator: {(typeof exp.pi === 'object' ? exp.pi?.name : exp.pi) || 'Unassigned'}</span>
            </div>
            {(exp.desc || exp.description) && <p className="text-sm leading-relaxed text-slate-300 mt-4 max-w-3xl">{exp.desc || exp.description}</p>}
          </div>
          <button onClick={onRemove} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-900/60 text-red-300 hover:bg-red-950/30 text-sm">
            <Trash2 className="w-4 h-4" /> Remove offline copy
          </button>
        </div>
      </div>

      <div className="flex gap-5 border-b border-slate-700 mb-5">
        {[['reports', 'Reports'], ['photos', 'Photos & Videos'], ['data', 'Data']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`pb-2 text-sm ${tab === key ? 'text-cyan-300 border-b-2 border-cyan-400' : 'text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {tab === 'reports' && (
        <div className="space-y-3">
          {content.reports.length === 0 ? <p className="text-slate-500">No reports were attached to this expedition.</p> : content.reports.map((item) => (
            <OfflineFileLink key={item.id} item={item} className="block bg-[#0f2129] border border-slate-700 rounded-lg p-4 hover:border-cyan-700 transition">
              <div className="flex items-center gap-2 text-white"><FileText className="w-4 h-4 text-cyan-400" /> {item.title}</div>
              {item.description && <p className="text-xs text-slate-400 mt-2">{item.description}</p>}
              <p className="text-[11px] text-slate-500 mt-2">{item.offlineFile ? 'Open saved file' : 'Metadata saved; attachment unavailable offline'}</p>
            </OfflineFileLink>
          ))}
        </div>
      )}

      {tab === 'photos' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {content.photos.length === 0 ? <p className="text-slate-500">No photos or videos were attached to this expedition.</p> : content.photos.map((item) => <OfflinePhoto key={item.id} item={item} />)}
        </div>
      )}

      {tab === 'data' && (
        <div className="space-y-4">
          {content.data.length === 0 ? <p className="text-slate-500">No datasets were attached to this expedition.</p> : content.data.map((item) => (
            <div key={item.id} className="bg-[#0f2129] border border-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-white"><Database className="w-4 h-4 text-cyan-400" /> {item.title}</div>
                {item.offlineFile ? (
                  <OfflineFileLink item={item} className="text-xs text-cyan-300 hover:underline">Open saved dataset</OfflineFileLink>
                ) : (
                  <span className="text-xs text-slate-500">File not cached</span>
                )}
              </div>
              {isLargeMinioDatasetForAutomaticOfflineCache(item) && !item.offlineFile && (
                <p className="text-xs text-amber-300 mt-3">Large scientific dataset — not cached automatically. Its metadata remains available offline; use the secure Download / View Original File action while online for the full file.</p>
              )}
              {item.datasetMeta ? (
                <>
                  <p className="text-xs text-slate-400 mt-3">{item.datasetMeta.row_count} rows · {item.datasetMeta.columns?.length ?? 0} columns</p>
                  <div className="overflow-x-auto mt-3 rounded border border-slate-800">
                    <table className="w-full text-xs text-slate-300">
                      <thead className="bg-[#162933]">
                        <tr>{item.datasetMeta.columns?.map((col) => <th key={col.name} className="text-left p-2">{col.name}</th>)}</tr>
                      </thead>
                      <tbody>
                        {(item.datasetMeta.preview_rows || []).slice(0, 8).map((row, ri) => (
                          <tr key={ri} className="border-t border-slate-800">{row.map((cell, ci) => <td key={ci} className="p-2">{cell == null ? '' : String(cell)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : <p className="text-xs text-slate-500 mt-3">No dataset preview was available when this expedition was saved.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SavedOfflinePage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setRecords(await getSavedExpeditions(user.id)); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [user.id]);
  const selected = useMemo(() => records.find((r) => r.expeditionId === selectedId), [records, selectedId]);

  const remove = async (record) => {
    await removeSavedExpedition(user.id, record.expeditionId);
    toast.success('Offline copy removed');
    setSelectedId(null);
    await refresh();
  };

  if (selected) return <div className="chart-backdrop min-h-screen px-6 py-10"><ExpeditionDetail record={selected} onBack={() => setSelectedId(null)} onRemove={() => remove(selected)} /></div>;

  return (
    <div className="chart-backdrop min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 text-cyan-300 mb-2"><HardDriveDownload className="w-5 h-5" /><span className="text-xs uppercase tracking-wider">Researcher offline library</span></div>
        <h1 className="text-2xl italic text-white" style={{ fontFamily: 'var(--font-display)' }}>Saved Files</h1>
        <p className="text-slate-400 mt-2 mb-7">Expeditions saved here can be opened even when this device has no internet connection.</p>

        {loading ? <p className="text-slate-500">Loading saved expeditions…</p> : records.length === 0 ? (
          <div className="brass-plate rounded-xl p-8 text-center">
            <HardDriveDownload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
            <p className="text-white">No expeditions saved yet.</p>
            <p className="text-sm text-slate-500 mt-1">Open Submission Management → Approved and choose “Save Offline”.</p>
            <Link to="/archive" className="inline-block mt-4 text-sm text-cyan-300 hover:underline">View approved submissions</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {records.map((record) => (
              <button key={record.storageKey} onClick={() => setSelectedId(record.expeditionId)} className="text-left brass-plate rounded-xl p-5 hover:border-cyan-700 transition">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-white font-semibold">{record.expedition.name}</h2>
                    <p className="text-sm text-slate-400 mt-1">{(record.expedition.region || 'Other').replace('_', ' ')} · {record.expedition.year || (record.expedition.startDate ? new Date(record.expedition.startDate).getFullYear() : 'Year unknown')}</p>
                  </div>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-950/40 text-emerald-300 border border-emerald-900">Offline</span>
                </div>
                <p className="text-xs text-slate-500 mt-4">{record.savedFiles}/{record.totalFiles} attached files saved · Saved {new Date(record.savedAt).toLocaleString()}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}