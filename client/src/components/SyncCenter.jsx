import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  HardDrive,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import { QUEUE_STATUS, SYNC_BLOCK } from '../offline/constants.js';
import {
  clearSyncedRecords,
  resetPendingContentForRetry,
  resetPendingExpeditionForRetry,
} from '../offline/queue.js';
import { runSync } from '../offline/syncManager.js';
import { ERROR_KIND } from '../offline/errors.js';
import { formatBytes, STORAGE_WARN_RATIO } from '../offline/storage.js';
import { listDatasetUploadSessions } from '../offline/datasetUploads.js';

function itemLabel(item) {
  return item.title || item.name || item.fileName || item.type || 'Untitled item';
}

function itemKind(item, expeditionIds) {
  if (expeditionIds.has(item.localId)) return item.operation === 'update' ? 'Expedition edit' : 'Expedition';
  return item.type ? item.type[0].toUpperCase() + item.type.slice(1) : 'Content';
}

function StatusIcon({ status }) {
  if (status === QUEUE_STATUS.SYNCED) return <Check className="w-4 h-4" />;
  if (status === QUEUE_STATUS.FAILED) return <XCircle className="w-4 h-4" />;
  if (status === QUEUE_STATUS.UPLOADING) return <LoaderCircle className="w-4 h-4 animate-spin" />;
  return <Cloud className="w-4 h-4" />;
}

const DATASET_UPLOAD_VIEW = {
  initiated: {
    label: 'Ready to resume',
    tone: 'text-amber-300',
    badge: 'border-amber-800/60 bg-amber-950/30 text-amber-300',
  },
  uploading: {
    label: 'Uploading / resumable',
    tone: 'text-cyan-300',
    badge: 'border-cyan-800/60 bg-cyan-950/30 text-cyan-300',
  },
  paused: {
    label: 'Paused — resumable',
    tone: 'text-amber-300',
    badge: 'border-amber-800/60 bg-amber-950/30 text-amber-300',
  },
  'waiting-network': {
    label: 'Waiting for network — resumable',
    tone: 'text-amber-300',
    badge: 'border-amber-800/60 bg-amber-950/30 text-amber-300',
  },
  'storage-unavailable': {
    label: 'Storage temporarily unavailable — resumable',
    tone: 'text-amber-300',
    badge: 'border-amber-800/60 bg-amber-950/30 text-amber-300',
  },
  'integrity-error': {
    label: 'Integrity check failed — resumable',
    tone: 'text-red-300',
    badge: 'border-red-800/60 bg-red-950/30 text-red-300',
  },
  finalizing: {
    label: 'Finalizing in MinIO',
    tone: 'text-cyan-300',
    badge: 'border-cyan-800/60 bg-cyan-950/30 text-cyan-300',
  },
  completed: {
    label: 'Upload complete — finalization pending',
    tone: 'text-emerald-300',
    badge: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300',
  },
  failed: {
    label: 'Upload failed',
    tone: 'text-red-300',
    badge: 'border-red-800/60 bg-red-950/30 text-red-300',
  },
  aborted: {
    label: 'Upload aborted',
    tone: 'text-slate-400',
    badge: 'border-slate-700 bg-slate-900/40 text-slate-400',
  },
};

function datasetUploadView(status) {
  return DATASET_UPLOAD_VIEW[status] || {
    label: status || 'Multipart upload',
    tone: 'text-slate-300',
    badge: 'border-slate-700 bg-slate-900/40 text-slate-300',
  };
}

function DatasetUploadIcon({ status }) {
  if (status === 'completed') return <Check className="w-4 h-4" />;
  if (status === 'failed' || status === 'integrity-error') return <XCircle className="w-4 h-4" />;
  if (status === 'uploading' || status === 'finalizing') return <LoaderCircle className="w-4 h-4 animate-spin" />;
  if (status === 'waiting-network' || status === 'storage-unavailable') return <CloudOff className="w-4 h-4" />;
  return <Cloud className="w-4 h-4" />;
}

function datasetUploadDetail(upload) {
  const uploaded = Math.max(0, Number(upload.uploadedBytes || 0));
  const total = Math.max(0, Number(upload.fileSize || 0));
  const completedParts = Array.isArray(upload.completedParts) ? upload.completedParts.length : 0;
  const totalParts = Math.max(0, Number(upload.totalParts || 0));

  if (upload.status === 'completed') {
    return upload.lastError
      || 'The file is safely in MinIO. The final dataset metadata/content attachment is still pending.';
  }
  if (upload.status === 'integrity-error') {
    return upload.lastError || 'SHA-256 integrity validation failed. Reselect the same file to resume from completed parts.';
  }
  if (upload.status === 'paused') {
    return `Paused at ${formatBytes(uploaded)} of ${formatBytes(total)}. Reselect the same file on Upload to continue.`;
  }
  if (upload.status === 'waiting-network') {
    return `Connection unavailable at ${formatBytes(uploaded)} of ${formatBytes(total)}. Completed parts remain in MinIO.`;
  }
  if (upload.status === 'storage-unavailable') {
    return upload.lastError || `MinIO is temporarily unavailable at ${formatBytes(uploaded)} of ${formatBytes(total)}. Completed parts remain safe and resumable.`;
  }
  if (upload.status === 'finalizing') {
    return 'All parts are uploaded; MinIO multipart completion is being finalized.';
  }
  if (upload.status === 'failed') {
    return upload.lastError || 'This multipart upload needs attention.';
  }

  const byteText = total > 0 ? `${formatBytes(uploaded)} of ${formatBytes(total)}` : 'Size unavailable';
  const partText = totalParts > 0 ? ` • ${completedParts}/${totalParts} parts committed` : '';
  return `${byteText}${partText}`;
}

function isDatasetUploadResumable(status) {
  return ['initiated', 'paused', 'waiting-network', 'storage-unavailable', 'integrity-error', 'completed'].includes(status);
}

// Failure kinds a researcher can act on are worth calling out by name — a
// conflict needs a decision, a rejection needs an edit, and a session expiry
// needs a login. Everything else is the machine's problem, not theirs.
const KIND_BADGE = {
  [ERROR_KIND.CONFLICT]: { label: 'Conflict', className: 'bg-fuchsia-950/40 text-fuchsia-300 border-fuchsia-800/60' },
  [ERROR_KIND.AUTH]: { label: 'Sign-in needed', className: 'bg-amber-950/40 text-amber-300 border-amber-800/60' },
  [ERROR_KIND.TOO_LARGE]: { label: 'Too large', className: 'bg-red-950/40 text-red-300 border-red-800/60' },
  [ERROR_KIND.REJECTED]: { label: 'Rejected', className: 'bg-red-950/40 text-red-300 border-red-800/60' },
  [ERROR_KIND.STORAGE]: { label: 'Device full', className: 'bg-red-950/40 text-red-300 border-red-800/60' },
  [ERROR_KIND.RATE_LIMIT]: { label: 'Server busy', className: 'bg-slate-800 text-slate-300 border-slate-700' },
  [ERROR_KIND.SERVER]: { label: 'Server error', className: 'bg-slate-800 text-slate-300 border-slate-700' },
  [ERROR_KIND.OFFLINE]: { label: 'Waiting for network', className: 'bg-slate-800 text-slate-300 border-slate-700' },
};

function relativeTime(timestamp) {
  const delta = timestamp - Date.now();
  if (delta <= 0) return 'now';
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  return `in ${Math.round(seconds / 60)} min`;
}

function itemDetail(item, progress) {
  if (item.status === QUEUE_STATUS.UPLOADING) {
    if (progress?.localId === item.localId && progress.total) {
      return `Uploading ${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`;
    }
    return item.uploadedFile ? 'File uploaded — saving details…' : 'Uploading…';
  }

  if (item.status === QUEUE_STATUS.FAILED) {
    return item.lastError || 'Synchronization failed.';
  }

  if (item.status === QUEUE_STATUS.QUEUED) {
    if (item.localExpeditionId) return 'Waiting for its expedition to sync first';
    const parts = [];
    if (item.lastError) parts.push(item.lastError);
    else parts.push('Waiting for synchronization');
    if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) parts.push(`next try ${relativeTime(item.nextAttemptAt)}`);
    if (item.attempts) parts.push(`${item.attempts} attempt${item.attempts === 1 ? '' : 's'}`);
    return parts.join(' • ');
  }

  return item.fileReleased
    ? 'Synchronized — local copy released to free space'
    : 'Successfully synchronized';
}

export default function SyncCenter() {
  const {
    expeditions,
    content,
    counts,
    loading,
    refresh,
    storage,
    storageLow,
    blockReason,
    progress,
  } = useSyncStatus();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [datasetUploads, setDatasetUploads] = useState([]);
  const [datasetUploadsLoading, setDatasetUploadsLoading] = useState(true);

  const refreshDatasetUploads = useCallback(async () => {
    if (!user?.id) {
      setDatasetUploads([]);
      setDatasetUploadsLoading(false);
      return;
    }

    try {
      setDatasetUploads(await listDatasetUploadSessions(user.id));
    } catch (error) {
      console.warn('Could not read local multipart dataset upload state:', error);
    } finally {
      setDatasetUploadsLoading(false);
    }
  }, [user?.id]);
  // Re-render once a second so backoff countdowns ("next try in 45s") move.
  const [, setTick] = useState(0);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, []);

  // Multipart dataset uploads live in their own metadata-only IndexedDB store,
  // separate from the Blob-backed offline queue above. Polling this local store
  // keeps Sync Center useful even when another tab is doing the actual PUTs.
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refreshDatasetUploads();
    };

    void load();
    const timer = setInterval(load, 1500);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshDatasetUploads]);

  const all = useMemo(() => [...expeditions, ...content], [expeditions, content]);
  const expeditionIds = useMemo(() => new Set(expeditions.map((item) => item.localId)), [expeditions]);

  const queuedBytes = useMemo(
    () =>
      all
        .filter((item) => item.status !== QUEUE_STATUS.SYNCED)
        .reduce((total, item) => total + (item.file?.size ?? item.fileSize ?? 0), 0),
    [all]
  );

  const resetFor = (item) =>
    expeditionIds.has(item.localId)
      ? resetPendingExpeditionForRetry(item.localId)
      : resetPendingContentForRetry(item.localId);

  async function retryItem(item) {
    await resetFor(item);
    await refresh();
    if (navigator.onLine) void runSync();
  }

  async function retryFailed() {
    setBusy(true);
    try {
      for (const item of all.filter((entry) => entry.status === QUEUE_STATUS.FAILED)) {
        await resetFor(item);
      }
      await refresh();
      if (navigator.onLine) await runSync();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearSynced() {
    setBusy(true);
    try {
      await clearSyncedRecords();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const pending = counts.queued + counts.uploading;
  const headline = !online
    ? `Offline • ${pending + counts.failed} pending`
    : blockReason === SYNC_BLOCK.AUTH
      ? 'Paused — sign in to continue syncing'
      : counts.uploading > 0
        ? `Syncing ${counts.uploading} item${counts.uploading === 1 ? '' : 's'}`
        : counts.queued > 0
          ? `${counts.queued} pending`
          : counts.failed > 0
            ? `${counts.failed} need attention`
            : 'Synced';

  if (loading) {
    return <div className="p-8 text-slate-400">Loading sync status…</div>;
  }

  return (
    <div className="min-h-screen bg-[#0b1c25] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Sync Center</h1>
            <p className="text-sm text-slate-400 mt-1">
              Local work stays on this device until it is safely synchronized. Nothing is deleted on failure.
            </p>
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
              online
                ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300'
                : 'border-amber-700/60 bg-amber-950/30 text-amber-300'
            }`}
          >
            {online ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
            {online ? 'Online' : 'Offline'}
          </div>
        </div>

        {/* Why the whole queue is stalled — stated plainly, with the one
            action that unblocks it. */}
        {blockReason === SYNC_BLOCK.AUTH && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-700/60 bg-amber-950/30 p-4">
            <KeyRound className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-amber-200 font-medium">Your session expired</div>
              <p className="text-sm text-amber-100/70 mt-1">
                Everything below is still saved on this device. Sign in again and synchronization resumes
                automatically from where it stopped — nothing has to be re-entered or re-uploaded.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/login', { state: { from: { pathname: '/sync' } } })}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm"
            >
              Sign in
            </button>
          </div>
        )}

        {blockReason === SYNC_BLOCK.STORAGE && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-700/60 bg-red-950/30 p-4">
            <ShieldAlert className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
            <div>
              <div className="text-red-200 font-medium">This device is out of space</div>
              <p className="text-sm text-red-100/70 mt-1">
                Sync could not record its progress. Clear synced records below, or free space on the device,
                then retry.
              </p>
            </div>
          </div>
        )}

        {/* Storage headroom, shown before it becomes a problem. */}
        {storage?.supported && (
          <div
            className={`mb-6 rounded-xl border p-4 ${
              storageLow ? 'border-red-700/60 bg-red-950/20' : 'border-slate-700 bg-[#0f1f2b]'
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <HardDrive className="w-4 h-4" />
                Device storage
                {storage.persisted && (
                  <span className="text-[11px] uppercase tracking-wide text-emerald-400/80 border border-emerald-800/60 rounded px-1.5 py-0.5">
                    Protected from eviction
                  </span>
                )}
              </div>
              <div className="text-slate-400">
                {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
                {queuedBytes > 0 && <span className="text-slate-500"> • {formatBytes(queuedBytes)} pending here</span>}
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full ${storageLow ? 'bg-red-500' : 'bg-cyan-500'}`}
                style={{ width: `${Math.min(100, Math.round((storage.ratio || 0) * 100))}%` }}
              />
            </div>
            {storageLow && (
              <p className="text-xs text-red-300 mt-2">
                Over {Math.round(STORAGE_WARN_RATIO * 100)}% full — new uploads may be refused. Sync or clear
                synced records to free space.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            ['Pending', counts.queued, 'text-amber-300'],
            ['Syncing', counts.uploading, 'text-cyan-300'],
            ['Synced', counts.synced, 'text-emerald-300'],
            ['Needs attention', counts.failed, 'text-red-300'],
            ['Total', counts.total, 'text-white'],
          ].map(([label, value, cls]) => (
            <div key={label} className="bg-[#0f1f2b] border border-slate-700 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
              <div className={`text-2xl font-semibold mt-1 ${cls}`}>{value}</div>
            </div>
          ))}
        </div>

        <div className="bg-[#0f1f2b] border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white font-medium">
              <StatusIcon
                status={
                  counts.uploading
                    ? QUEUE_STATUS.UPLOADING
                    : counts.failed
                      ? QUEUE_STATUS.FAILED
                      : counts.queued
                        ? QUEUE_STATUS.QUEUED
                        : QUEUE_STATUS.SYNCED
                }
              />
              {headline}
            </div>
            <div className="flex items-center gap-2">
              {counts.synced > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearSynced}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50 text-sm"
                  title="Remove synced records from this device (they are already on the server)"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear synced
                </button>
              )}
              {counts.failed > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={retryFailed}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                  Retry all
                </button>
              )}
            </div>
          </div>

          {all.length === 0 ? (
            <div className="p-10 text-center text-slate-500">No local sync records.</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {[...all]
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .map((item) => {
                  const badge = item.lastErrorKind ? KIND_BADGE[item.lastErrorKind] : null;
                  const showProgress =
                    item.status === QUEUE_STATUS.UPLOADING &&
                    progress?.localId === item.localId &&
                    progress.total > 0;

                  return (
                    <div key={`${itemKind(item, expeditionIds)}-${item.localId}`} className="px-5 py-4 flex items-start gap-4">
                      <div
                        className={`shrink-0 mt-0.5 ${
                          item.status === QUEUE_STATUS.SYNCED
                            ? 'text-emerald-400'
                            : item.status === QUEUE_STATUS.FAILED
                              ? 'text-red-400'
                              : item.status === QUEUE_STATUS.UPLOADING
                                ? 'text-cyan-400'
                                : 'text-amber-400'
                        }`}
                      >
                        <StatusIcon status={item.status} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white truncate">{itemLabel(item)}</span>
                          <span className="text-[11px] uppercase tracking-wide text-slate-500">
                            {itemKind(item, expeditionIds)}
                          </span>
                          {(item.file?.size || item.fileSize) && (
                            <span className="text-[11px] text-slate-600">
                              {formatBytes(item.file?.size ?? item.fileSize)}
                            </span>
                          )}
                          {badge && item.status !== QUEUE_STATUS.SYNCED && (
                            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-500 mt-1">{itemDetail(item, progress)}</div>

                        {showProgress && (
                          <div className="mt-2 h-1 w-full max-w-sm rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-cyan-500 transition-all"
                              style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }}
                            />
                          </div>
                        )}

                        {/* A conflict is the one failure the researcher must
                            resolve with knowledge we don't have, so show what
                            the server holds rather than guessing a winner. */}
                        {item.lastErrorKind === ERROR_KIND.CONFLICT && item.conflict && (
                          <div className="mt-2 text-xs rounded-lg border border-fuchsia-900/60 bg-fuchsia-950/20 p-3 text-fuchsia-100/80">
                            <div className="font-medium text-fuchsia-200 mb-1">Server copy changed</div>
                            <p>
                              Someone else updated this record while your change was queued. Retrying will send
                              your version again; open the record on the server first if you need to merge the
                              two by hand.
                            </p>
                            {item.conflict.updatedAt && (
                              <p className="mt-1 text-fuchsia-300/70">
                                Server version saved {new Date(item.conflict.updatedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {item.status === QUEUE_STATUS.FAILED && (
                        <button
                          type="button"
                          onClick={() => retryItem(item)}
                          className="shrink-0 p-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-cyan-500"
                          title="Retry this item"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="mt-6 bg-[#0f1f2b] border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between gap-3">
            <div>
              <div className="text-white font-medium">Multipart dataset uploads</div>
              <p className="text-xs text-slate-500 mt-1">
                Scientific dataset uploads use a separate metadata-only resume store. File bytes are never copied here.
              </p>
            </div>
            {datasetUploads.length > 0 && (
              <span className="text-xs px-2 py-1 rounded-full border border-slate-700 text-slate-400">
                {datasetUploads.length}
              </span>
            )}
          </div>

          {datasetUploadsLoading ? (
            <div className="p-6 text-sm text-slate-500">Loading multipart upload state…</div>
          ) : datasetUploads.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No local multipart dataset upload records.</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {datasetUploads.map((upload) => {
                const view = datasetUploadView(upload.status);
                const total = Math.max(0, Number(upload.fileSize || 0));
                const uploaded = Math.min(total || Infinity, Math.max(0, Number(upload.uploadedBytes || 0)));
                const percent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;

                return (
                  <div key={upload.sessionId} className="px-5 py-4 flex items-start gap-4">
                    <div className={`shrink-0 mt-0.5 ${view.tone}`}>
                      <DatasetUploadIcon status={upload.status} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white truncate">{upload.fileName || 'Scientific dataset'}</span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">MinIO dataset</span>
                        {total > 0 && <span className="text-[11px] text-slate-600">{formatBytes(total)}</span>}
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${view.badge}`}>
                          {view.label}
                        </span>
                        {upload.checksumAlgorithm === 'SHA256' && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-500">
                            SHA-256
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 mt-1">{datasetUploadDetail(upload)}</div>

                      {total > 0 && upload.status !== 'completed' && (
                        <div className="mt-2 h-1 w-full max-w-sm rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all ${upload.status === 'integrity-error' ? 'bg-red-500' : 'bg-cyan-500'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {isDatasetUploadResumable(upload.status) && (
                      <button
                        type="button"
                        onClick={() => navigate('/upload')}
                        className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-cyan-500 text-sm"
                        title={upload.status === 'completed' ? 'Open Upload to finish metadata attachment' : 'Open Upload and reselect the same file to resume'}
                      >
                        <RefreshCw className="w-4 h-4" />
                        {upload.status === 'completed' ? 'Finalize' : 'Open Upload'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {counts.failed > 0 && (
          <div className="mt-4 flex gap-2 items-start text-xs text-slate-500">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            Failed items keep their file and their data on this device. Retrying never deletes anything, and a
            retry after a lost response will not create a duplicate on the server.
          </div>
        )}
      </div>
    </div>
  );
}
