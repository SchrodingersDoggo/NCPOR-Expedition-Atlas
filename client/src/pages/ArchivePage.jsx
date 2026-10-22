import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Archive as ArchiveIcon, ListOrdered, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import {
  searchArchive,
  fetchArchiveYears,
  fetchYearStats,
  fetchArchiveFacets,
  fetchSubmissions,
  fetchSubmissionQueue,
  updateSubmissionStatus,
  updateSubmissionPriority,
} from '../api/archive.js';
import { fetchExpeditionContent } from '../api/content.js';
import { deleteExpedition, fetchExpeditionForOffline } from '../api/expeditions.js';
import { getSavedExpeditions, saveExpeditionOffline } from '../offline/savedExpeditions.js';
import {
  ArchiveResultCard,
  YearTimeline,
  YearStatsBar,
  FilterPanel,
  SubmissionRow,
  QueueRow,
  ArchiveSummaryPanel,
  REGION_LABEL,
} from '../components/archive/ArchiveUI.jsx';

const EMPTY_FILTERS = { year_from: '', year_to: '', region: [], type: [], research_domain: [], expedition_id: '', status: [] };
const STAFF_ROLES = ['admin', 'comms_officer'];

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function Explorer() {
  const { user, isAuthenticated } = useAuth();
  const isStaff = isAuthenticated && STAFF_ROLES.includes(user.role);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 350);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedYear, setSelectedYear] = useState(null);
  const [page, setPage] = useState(1);

  const [years, setYears] = useState([]);
  const [yearStats, setYearStats] = useState(null);
  const [facets, setFacets] = useState(null);
  const [result, setResult] = useState({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [refreshKey, setRefreshKey] = useState(0);
  const [removingExpeditionId, setRemovingExpeditionId] = useState(null);
  const [offlineBusyExpeditionId, setOfflineBusyExpeditionId] = useState(null);
  const [savedExpeditionIds, setSavedExpeditionIds] = useState(() => new Set());
  const isResearcher = isAuthenticated && user.role === 'researcher';

  useEffect(() => {
    fetchArchiveYears().then(setYears).catch(() => setYears([]));
    fetchArchiveFacets().then(setFacets).catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isResearcher) {
      setSavedExpeditionIds(new Set());
      return undefined;
    }
    getSavedExpeditions(user.id)
      .then((records) => {
        if (!cancelled) setSavedExpeditionIds(new Set(records.map((record) => record.expeditionId)));
      })
      .catch((err) => console.error('Failed to read saved offline expeditions', err));
    return () => { cancelled = true; };
  }, [isResearcher, user?.id]);

  useEffect(() => {
    if (selectedYear == null) {
      setYearStats(null);
      return;
    }
    fetchYearStats(selectedYear).then(setYearStats).catch(() => setYearStats(null));
  }, [selectedYear]);

  // Reset to page 1 whenever the search criteria change underneath the user.
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, filters, selectedYear]);

  useEffect(() => {
    setStatus('loading');
    const params = {
      q: debouncedQuery,
      type: filters.type?.join(','),
      region: filters.region?.join(','),
      research_domain: filters.research_domain?.join(','),
      expedition_id: filters.expedition_id,
      status: isStaff ? filters.status?.join(',') : undefined,
      page,
      limit: 12,
    };
    if (selectedYear != null) {
      params.year = selectedYear;
    } else {
      params.year_from = filters.year_from;
      params.year_to = filters.year_to;
    }
    searchArchive(params)
      .then((data) => {
        setResult(data);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Archive search failed', err);
        setStatus('error');
      });
  }, [debouncedQuery, filters, selectedYear, page, isStaff, refreshKey]);

  const handleSaveOffline = async (item) => {
    const expeditionId = item?.expedition?.id;
    if (!isResearcher || !expeditionId || offlineBusyExpeditionId) return;
    setOfflineBusyExpeditionId(expeditionId);
    try {
      const [expedition, content] = await Promise.all([
        fetchExpeditionForOffline(expeditionId),
        fetchExpeditionContent(expeditionId),
      ]);
      const result = await saveExpeditionOffline({ ownerId: user.id, expedition, content });
      setSavedExpeditionIds((prev) => new Set([...prev, expeditionId]));
      if (result.totalFiles > result.savedFiles) {
        toast.success(`Saved offline (${result.savedFiles}/${result.totalFiles} files available)`);
      } else {
        toast.success('Expedition saved for offline viewing');
      }
    } catch (err) {
      console.error('Failed to save archive expedition offline', err);
      toast.error(err?.message || 'Could not save this expedition offline.');
    } finally {
      setOfflineBusyExpeditionId(null);
    }
  };

  const handleRemoveExpedition = async (item) => {
    if (!isStaff || !item?.expedition?.id || removingExpeditionId) return;
    const name = item.expedition.name || 'this expedition';
    const confirmed = window.confirm(
      `Remove “${name}”? This permanently deletes the expedition and ALL linked reports, datasets, publications, photos, videos and generated portal records. This cannot be undone.`
    );
    if (!confirmed) return;

    setRemovingExpeditionId(item.expedition.id);
    try {
      await deleteExpedition(item.expedition.id);
      toast.success('Expedition and linked data removed.');
      setPage(1);
      setRefreshKey((key) => key + 1);
      fetchArchiveYears().then(setYears).catch(() => setYears([]));
      fetchArchiveFacets().then(setFacets).catch(() => setFacets(null));
    } catch (err) {
      console.error('Failed to remove expedition from archive', err);
      toast.error(err?.response?.data?.error || 'Could not remove the expedition.');
    } finally {
      setRemovingExpeditionId(null);
    }
  };

  return (
    <div>
      {/* Search Archive */}
      <div className="relative mb-6">
        <Search className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reports, datasets, publications, media… by title, expedition, author, keyword"
          className="w-full bg-[#0f2129] border border-slate-700 focus:border-cyan-600 rounded-lg pl-12 pr-4 py-3.5 text-white placeholder:text-slate-500 outline-none transition-colors"
        />
      </div>

      {/* Year Timeline */}
      <div className="mb-6">
        <YearTimeline years={years} selectedYear={selectedYear} onSelectYear={setSelectedYear} />
        <YearStatsBar stats={yearStats} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          facets={facets}
          showStatus={isStaff}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setSelectedYear(null);
          }}
        />

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-400">
              {status === 'ready' ? `${result.pagination.total} result${result.pagination.total === 1 ? '' : 's'}` : '\u00A0'}
            </p>
          </div>

          {status === 'loading' && <p className="text-slate-500">Searching the archive…</p>}
          {status === 'error' && <p className="text-red-400">Couldn't load archive results. Try again.</p>}
          {status === 'ready' && result.items.length === 0 && (
            <p className="text-slate-500">No archive material matches your search and filters.</p>
          )}

          {status === 'ready' && result.items.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.items.map((item) => (
                <ArchiveResultCard
                  key={item.id}
                  item={item}
                  canManage={isStaff}
                  removing={removingExpeditionId === item.expedition?.id}
                  onRemoveExpedition={handleRemoveExpedition}
                  showSaveOffline={isResearcher && ['published', 'archived'].includes(item.status) && Boolean(item.expedition?.id)}
                  onSaveOffline={handleSaveOffline}
                  saveBusy={offlineBusyExpeditionId === item.expedition?.id}
                  savedOffline={Boolean(item.expedition?.id && savedExpeditionIds.has(item.expedition.id))}
                />
              ))}
            </div>
          )}

          {status === 'ready' && result.pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-2 rounded border border-slate-700 disabled:opacity-40 text-slate-300 hover:border-cyan-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-400">
                Page {result.pagination.page} of {result.pagination.totalPages}
              </span>
              <button
                disabled={page >= result.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-2 rounded border border-slate-700 disabled:opacity-40 text-slate-300 hover:border-cyan-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Archive overview: the "Total Submitted / Approved / Pending /
// Queued-Syncing" counters plus the Expedition Records table. Pulled in as
// its own piece (rather than folded into Explorer or SubmissionManagement)
// so it doesn't disturb either of those already-completed features — it
// only ever reads from the same submissions endpoint and the existing
// offline-queue hook that SyncCenter already relies on.
function ArchiveOverview() {
  const [sort, setSort] = useState('newest');
  const [items, setItems] = useState([]);
  const [stageCounts, setStageCounts] = useState({ draft: 0, in_review: 0, published: 0, archived: 0 });
  const [status, setStatus] = useState('loading');
  const { counts: syncCounts } = useSyncStatus();

  useEffect(() => {
    setStatus('loading');
    fetchSubmissions('all', 1)
      .then((data) => {
        setItems(data.items || []);
        setStageCounts(data.stageCounts || { draft: 0, in_review: 0, published: 0, archived: 0 });
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load archive overview', err);
        setStatus('error');
      });
  }, []);

  // Local device work that hasn't reached the server yet (IndexedDB queue),
  // read live via useSyncStatus — real-time, not a hard-coded number.
  const queuedSyncing = syncCounts.queued + syncCounts.uploading;
  const approved = stageCounts.published + stageCounts.archived;
  const pending = stageCounts.draft + stageCounts.in_review;
  const totalSubmitted = approved + pending + queuedSyncing;

  const records = useMemo(() => {
    const sorted = [...items].sort((a, b) =>
      sort === 'oldest'
        ? new Date(a.createdAt) - new Date(b.createdAt)
        : new Date(b.createdAt) - new Date(a.createdAt)
    );
    return sorted.slice(0, 8).map((item) => ({
      id: item.id,
      expeditionName: item.expedition?.name || 'Unattached',
      regionLabel: REGION_LABEL[item.expedition?.region || item.region] || 'Unspecified',
      researcher: item.uploader?.name || 'Unknown',
      uploadedLabel: new Date(item.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    }));
  }, [items, sort]);

  return (
    <ArchiveSummaryPanel
      counts={{ totalSubmitted, approved, pending, queuedSyncing }}
      records={records}
      sort={sort}
      onSortChange={setSort}
      status={status}
      visibleTotal={items.length}
    />
  );
}

const STAGE_TABS = [
  { key: 'pending', label: 'Pending', statusFilter: (s) => s === 'draft' },
  { key: 'under_review', label: 'Under Review', statusFilter: (s) => s === 'in_review' },
  { key: 'approved', label: 'Approved', statusFilter: (s) => s === 'published' },
];

function SubmissionManagement() {
  const { user } = useAuth();
  const isStaff = STAFF_ROLES.includes(user.role);

  const [stageTab, setStageTab] = useState('under_review');
  const [showQueue, setShowQueue] = useState(false);
  const [items, setItems] = useState([]);
  const [stageCounts, setStageCounts] = useState({ draft: 0, in_review: 0, published: 0, archived: 0 });
  const [status, setStatus] = useState('loading');
  const [busyId, setBusyId] = useState(null);
  const [offlineBusyId, setOfflineBusyId] = useState(null);
  const [savedExpeditionIds, setSavedExpeditionIds] = useState(() => new Set());

  const [queue, setQueue] = useState([]);
  const [queueSort, setQueueSort] = useState('oldest');
  const [queueStatus, setQueueStatus] = useState('idle');

  const loadSubmissions = useCallback(() => {
    setStatus('loading');
    fetchSubmissions('all', 1)
      .then((data) => {
        setItems(data.items);
        setStageCounts(data.stageCounts);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load submissions', err);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // Researchers can save approved expeditions to this device. Read the
  // existing IndexedDB library so already-saved rows render correctly after
  // refresh/re-login instead of reverting to "Save Offline".
  useEffect(() => {
    let cancelled = false;
    if (user.role !== 'researcher') {
      setSavedExpeditionIds(new Set());
      return undefined;
    }
    getSavedExpeditions(user.id)
      .then((records) => {
        if (!cancelled) setSavedExpeditionIds(new Set(records.map((record) => record.expeditionId)));
      })
      .catch((err) => console.error('Failed to read saved offline expeditions', err));
    return () => { cancelled = true; };
  }, [user.id, user.role]);

  const loadQueue = useCallback((sort) => {
    setQueueStatus('loading');
    fetchSubmissionQueue(sort, 1)
      .then((data) => {
        setQueue(data.queue);
        setQueueStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load submission queue', err);
        setQueueStatus('error');
      });
  }, []);

  useEffect(() => {
    if (showQueue && isStaff) loadQueue(queueSort);
  }, [showQueue, queueSort, isStaff, loadQueue]);

  const handleDecide = async (id, nextStatus) => {
    setBusyId(id);
    try {
      await updateSubmissionStatus(id, nextStatus);
      loadSubmissions();
      if (showQueue) loadQueue(queueSort);
    } catch (err) {
      console.error('Failed to update submission status', err);
      toast.error('Could not update that submission. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveOffline = async (item) => {
    if (user.role !== 'researcher' || item.status !== 'published' || !item.expedition?.id) return;
    setOfflineBusyId(item.id);
    try {
      // Save the whole approved expedition, not only this one submission.
      // This gives the offline library the expedition details plus every
      // currently approved report/photo/video/dataset attached to it.
      const [expedition, content] = await Promise.all([
        fetchExpeditionForOffline(item.expedition.id),
        fetchExpeditionContent(item.expedition.id),
      ]);
      const result = await saveExpeditionOffline({ ownerId: user.id, expedition, content });
      setSavedExpeditionIds((prev) => new Set([...prev, item.expedition.id]));
      if (result.totalFiles > result.savedFiles) {
        toast.success(`Saved offline (${result.savedFiles}/${result.totalFiles} files available)`);
      } else {
        toast.success('Expedition saved for offline viewing');
      }
    } catch (err) {
      console.error('Failed to save approved expedition offline', err);
      toast.error('Could not save this expedition offline.');
    } finally {
      setOfflineBusyId(null);
    }
  };

  const handleReprioritize = async (id, priority) => {
    try {
      await updateSubmissionPriority(id, priority);
      loadSubmissions();
      if (showQueue) loadQueue(queueSort);
    } catch (err) {
      console.error('Failed to update priority', err);
    }
  };

  const visibleItems = useMemo(() => {
    const tab = STAGE_TABS.find((t) => t.key === stageTab);
    return items.filter((it) => tab.statusFilter(it.status));
  }, [items, stageTab]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {STAGE_TABS.map((tab) => {
          const count =
            tab.key === 'pending' ? stageCounts.draft : tab.key === 'under_review' ? stageCounts.in_review : stageCounts.published;
          const active = !showQueue && stageTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setShowQueue(false);
                setStageTab(tab.key);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-[#0f2129] border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label} <span className="opacity-70">({count})</span>
            </button>
          );
        })}
        {isStaff && (
          <button
            onClick={() => setShowQueue(true)}
            className={`ml-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              showQueue ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-[#0f2129] border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListOrdered className="w-4 h-4" /> Submission Queue
          </button>
        )}
      </div>

      {!showQueue && (
        <>
          {status === 'loading' && <p className="text-slate-500">Loading submissions…</p>}
          {status === 'error' && <p className="text-red-400">Couldn't load submissions. Try refreshing.</p>}
          {status === 'ready' && visibleItems.length === 0 && (
            <p className="text-slate-500 flex items-center gap-2"><Inbox className="w-4 h-4" /> Nothing here right now.</p>
          )}
          {status === 'ready' &&
            visibleItems.map((item) => (
              <SubmissionRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onDecide={handleDecide}
                onReprioritize={isStaff ? handleReprioritize : undefined}
                showActions={isStaff}
                showSaveOffline={user.role === 'researcher' && stageTab === 'approved' && item.status === 'published' && Boolean(item.expedition?.id)}
                onSaveOffline={handleSaveOffline}
                saveBusy={offlineBusyId === item.id}
                savedOffline={Boolean(item.expedition?.id && savedExpeditionIds.has(item.expedition.id))}
              />
            ))}
        </>
      )}

      {showQueue && isStaff && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-slate-400">Sort:</label>
            <select
              value={queueSort}
              onChange={(e) => setQueueSort(e.target.value)}
              className="bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
              <option value="priority">Priority</option>
              <option value="type">Content type</option>
              <option value="status">Submission status</option>
            </select>
          </div>
          {queueStatus === 'loading' && <p className="text-slate-500">Loading queue…</p>}
          {queueStatus === 'error' && <p className="text-red-400">Couldn't load the queue. Try refreshing.</p>}
          {queueStatus === 'ready' && queue.length === 0 && <p className="text-slate-500">The queue is empty.</p>}
          {queueStatus === 'ready' && queue.map((entry) => <QueueRow key={entry.id} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

export default function ArchivePage() {
  const { user, isAuthenticated } = useAuth();
  const canTrackSubmissions = isAuthenticated && ['researcher', 'comms_officer', 'admin'].includes(user.role);
  const [tab, setTab] = useState('explorer');

  return (
    <div className="min-h-screen chart-backdrop px-4 md:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <ArchiveIcon className="w-7 h-7" style={{ color: 'var(--brass-bright)' }} />
          <h1 className="text-2xl md:text-3xl font-semibold text-white plate-label">Archive</h1>
        </div>
        <p className="text-slate-400 mb-6 max-w-2xl">
          The centralized historical repository for NCPOR expedition reports, scientific datasets, publications,
          photographs, videos and institutional activities.
        </p>

        {canTrackSubmissions && <ArchiveOverview />}

        {canTrackSubmissions && (
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setTab('explorer')}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                tab === 'explorer' ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-[#0f2129] border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Archive Explorer
            </button>
            <button
              onClick={() => setTab('submissions')}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                tab === 'submissions' ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-[#0f2129] border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Submission Management
            </button>
          </div>
        )}

        {tab === 'explorer' || !canTrackSubmissions ? <Explorer /> : <SubmissionManagement />}
      </div>
    </div>
  );
}
