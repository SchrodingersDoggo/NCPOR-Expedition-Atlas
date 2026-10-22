import React from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Database,
  BookOpen,
  Image as ImageIcon,
  Video,
  Landmark,
  MapPin,
  CalendarDays,
  Users,
  Eye,
  Inbox,
  CheckCircle2,
  Clock,
  RefreshCw,
  Compass,
  Trash2,
} from 'lucide-react';

export const TYPE_LABEL = {
  report: 'Report',
  dataset: 'Dataset',
  publication: 'Publication',
  photo: 'Photo',
  video: 'Video',
  activity: 'Activity',
};

export const TYPE_ICON = {
  report: FileText,
  dataset: Database,
  publication: BookOpen,
  photo: ImageIcon,
  video: Video,
  activity: Landmark,
};

export const REGION_LABEL = {
  Arctic: 'Arctic',
  Antarctic: 'Antarctic',
  Himalaya: 'Himalaya',
  Southern_Ocean: 'Southern Ocean',
  Other: 'Other',
};

export const DOMAIN_LABEL = {
  climate_science: 'Climate Science',
  glaciology: 'Glaciology',
  oceanography: 'Oceanography',
  atmospheric_science: 'Atmospheric Science',
  geology: 'Geology',
  biology_ecology: 'Biology / Ecology',
  other: 'Other',
};

// Per-file role within a dataset's metadata record (raw/processed/
// documentation/calibration/derived/other) — NPDC distinguishes actual vs.
// processed datasets; this extends that to the full file lifecycle a
// scientific observation can have. Deliberately distinct colors so a
// researcher scanning a list of files doesn't have to open each one to
// tell what kind of file it is.
export const FILE_ROLE_LABEL = {
  raw: 'Raw',
  processed: 'Processed',
  documentation: 'Documentation',
  calibration: 'Calibration',
  derived: 'Derived',
  other: 'Other',
};

export const FILE_ROLE_STYLE = {
  raw: 'bg-orange-900/40 text-orange-300 border-orange-700',
  processed: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  documentation: 'bg-slate-700/50 text-slate-300 border-slate-600',
  calibration: 'bg-sky-900/40 text-sky-300 border-sky-700',
  derived: 'bg-violet-900/40 text-violet-300 border-violet-700',
  other: 'bg-slate-700/50 text-slate-300 border-slate-600',
};

// Shows nothing when role is null/undefined — most non-dataset items, and
// any dataset uploaded before this field existed, so callers can render it
// unconditionally without an extra guard at each call site.
export function FileRoleBadge({ role }) {
  if (!role || !FILE_ROLE_LABEL[role]) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${FILE_ROLE_STYLE[role]}`}>
      {FILE_ROLE_LABEL[role]}
    </span>
  );
}

// draft -> Pending, in_review -> Under Review, published -> Approved,
// archived -> Archived (mirrors ARCHIVE_STAGE_LABEL on the server).
export const STAGE_STYLE = {
  Pending: 'bg-slate-700/50 text-slate-300 border-slate-600',
  'Under Review': 'bg-amber-900/40 text-amber-300 border-amber-700',
  Approved: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  Archived: 'bg-cyan-900/40 text-cyan-300 border-cyan-700',
};

export function StagePill({ stage }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STAGE_STYLE[stage] || STAGE_STYLE.Pending}`}>
      {stage}
    </span>
  );
}

export function TypeBadge({ type }) {
  const Icon = TYPE_ICON[type] || FileText;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-cyan-900/40 text-cyan-300 border border-cyan-800">
      <Icon className="w-3.5 h-3.5" />
      {TYPE_LABEL[type] || type}
    </span>
  );
}

// --- Archive result / related-content card -----------------------------
export function ArchiveResultCard({
  item,
  canManage = false,
  onRemoveExpedition,
  removing = false,
  showSaveOffline = false,
  onSaveOffline,
  saveBusy = false,
  savedOffline = false,
}) {
  return (
    <div className="relative h-full flex flex-col bg-[#0f2129] border border-slate-700 rounded-lg hover:border-cyan-600 transition-colors overflow-hidden">
      <Link to={`/archive/${item.id}`} className="block p-4 flex-1">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TypeBadge type={item.type} />
            {item.type === 'dataset' && <FileRoleBadge role={item.fileRole} />}
          </div>
          <StagePill stage={item.archiveStage} />
        </div>
        <h3 className="text-white font-semibold leading-snug mb-1 line-clamp-2">{item.title}</h3>
        {item.description && (
          <p className="text-sm text-slate-400 line-clamp-2 mb-3">{item.description}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {item.year && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> {item.year}
            </span>
          )}
          {item.region && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {REGION_LABEL[item.region] || item.region}
            </span>
          )}
          {(item.authors || item.uploader?.name) && (
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {item.authors || item.uploader?.name}
            </span>
          )}
          {item.expedition?.name && <span className="truncate max-w-[14rem]">{item.expedition.name}</span>}
          {typeof item.viewCount === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" /> {item.viewCount}
            </span>
          )}
        </div>
      </Link>
      {(canManage || showSaveOffline) && item.expedition?.id && (
        <div className="px-4 pb-4 pt-0 mt-auto flex justify-end gap-2">
          {showSaveOffline && (
            <button
              type="button"
              disabled={saveBusy || savedOffline}
              onClick={() => onSaveOffline?.(item)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-default ${
                savedOffline
                  ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-300'
                  : 'bg-cyan-700 hover:bg-cyan-600 disabled:opacity-60 text-white'
              }`}
            >
              {saveBusy ? 'Saving…' : savedOffline ? 'Saved Offline' : 'Save Offline'}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              disabled={removing}
              onClick={() => onRemoveExpedition?.(item)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-800/80 text-red-300 bg-red-950/20 hover:bg-red-950/40 text-xs font-medium disabled:opacity-50"
              title="Remove this expedition and all linked portal data"
            >
              <Trash2 className="w-3.5 h-3.5" /> {removing ? 'Removing…' : 'Remove expedition'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Year Timeline -------------------------------------------------------
export function YearTimeline({ years, selectedYear, onSelectYear }) {
  if (!years || years.length === 0) {
    return <p className="text-sm text-slate-500">No archived material has a year on record yet.</p>;
  }
  const maxTotal = Math.max(...years.map((y) => y.total), 1);

  return (
    <div className="brass-plate rounded-md px-4 py-4">
      <div className="rivet-tl" />
      <div className="rivet-tr" />
      <div className="rivet-bl" />
      <div className="rivet-br" />
      <h3 className="plate-label text-sm mb-3" style={{ color: 'var(--brass-bright)' }}>
        Year Timeline
      </h3>
      <div className="flex items-end gap-1.5 overflow-x-auto custom-scrollbar pb-2">
        {years.map(({ year, total }) => {
          const active = selectedYear === year;
          const heightPct = 12 + Math.round((total / maxTotal) * 68);
          return (
            <button
              key={year}
              type="button"
              onClick={() => onSelectYear(active ? null : year)}
              className="flex flex-col items-center justify-end shrink-0 w-12 h-28 group"
              title={`${year} — ${total} item${total === 1 ? '' : 's'}`}
            >
              <span className={`gauge-text text-[10px] mb-1 ${active ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}>
                {total}
              </span>
              <div
                className={`w-6 rounded-t transition-colors ${active ? 'bg-[var(--brass-bright)]' : 'bg-[var(--brass-dim)] group-hover:bg-[var(--brass)]'}`}
                style={{ height: `${heightPct}%` }}
              />
              <span className={`gauge-text text-[11px] mt-1.5 ${active ? 'text-white font-semibold' : 'text-slate-400'}`}>
                {year}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function YearStatsBar({ stats }) {
  if (!stats) return null;
  const entries = [
    ['Expeditions', stats.expeditions],
    ['Reports', stats.reports],
    ['Datasets', stats.datasets],
    ['Publications', stats.publications],
    ['Photos', stats.photos],
    ['Videos', stats.videos],
    ['Activities', stats.activities],
  ];
  return (
    <div className="flex flex-wrap gap-3 mt-3">
      {entries.map(([label, value]) => (
        <div key={label} className="brass-plate rounded-md px-3 py-2 text-center min-w-[86px]">
          <div className="gauge-text text-lg" style={{ color: 'var(--brass-bright)' }}>{value}</div>
          <div className="text-[11px] text-slate-400">{label}</div>
        </div>
      ))}
    </div>
  );
}

// --- Archive Overview (counters + Expedition Records) --------------------
// Counters are driven by real Submission Tracking data (stageCounts from
// GET /api/archive/submissions) plus the client's own offline queue
// (useSyncStatus) — nothing here is hard-coded. "Expedition Records" reuses
// the same submissions payload (expedition + uploader already included by
// the API) so no extra endpoint is needed just to render the table.
const SUMMARY_STATS = [
  { key: 'totalSubmitted', label: 'Total Submitted', icon: Inbox, color: 'text-slate-300' },
  { key: 'approved', label: 'Approved', icon: CheckCircle2, color: 'text-emerald-300' },
  { key: 'pending', label: 'Pending', icon: Clock, color: 'text-amber-300' },
  { key: 'queuedSyncing', label: 'Queued / Syncing', icon: RefreshCw, color: 'text-cyan-300' },
];

export function ArchiveSummaryPanel({ counts, records, sort, onSortChange, status, visibleTotal }) {
  return (
    <div className="brass-plate rounded-md px-4 py-4 mb-6">
      <div className="rivet-tl" />
      <div className="rivet-tr" />
      <div className="rivet-bl" />
      <div className="rivet-br" />

      <h3 className="plate-label text-sm mb-4" style={{ color: 'var(--brass-bright)' }}>
        Archive
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {SUMMARY_STATS.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="bg-[#0f2129] border border-slate-700 rounded-lg px-3 py-3 text-center">
            <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
            <div className="gauge-text text-xl text-white">
              {status === 'loading' ? '—' : (counts?.[key] ?? 0)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h4 className="text-white font-semibold text-sm inline-flex items-center gap-2">
          <Compass className="w-4 h-4 text-slate-500" /> Expedition Records
        </h4>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-600"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0f2129] text-slate-400 text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">Expedition</th>
                <th className="text-left px-4 py-2 font-medium">Region</th>
                <th className="text-left px-4 py-2 font-medium">Researcher</th>
                <th className="text-left px-4 py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {status === 'loading' && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    Loading expedition records…
                  </td>
                </tr>
              )}
              {status === 'error' && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-red-400">
                    Couldn't load expedition records.
                  </td>
                </tr>
              )}
              {status === 'ready' && records.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    No expedition records yet.
                  </td>
                </tr>
              )}
              {status === 'ready' &&
                records.map((r) => (
                  <tr key={r.id} className="hover:bg-[#0f2129]/60 transition-colors">
                    <td className="px-4 py-2.5 text-white truncate max-w-[220px]">{r.expeditionName}</td>
                    <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">{r.regionLabel}</td>
                    <td className="px-4 py-2.5 text-slate-300 truncate max-w-[160px]">{r.researcher}</td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{r.uploadedLabel}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {status === 'ready' && visibleTotal > records.length && (
          <div className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800">
            Showing {records.length} most recent of {visibleTotal} — see Submission Management for the full list.
          </div>
        )}
      </div>
    </div>
  );
}

// --- Advanced Filters ----------------------------------------------------
export function FilterPanel({ filters, onChange, facets, showStatus, onClear }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="bg-[#0f2129] border border-slate-700 rounded-lg p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Advanced Filters</h3>
        <button type="button" onClick={onClear} className="text-xs text-cyan-400 hover:underline">
          Clear Filters
        </button>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Year</label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="From"
            value={filters.year_from || ''}
            onChange={(e) => set('year_from', e.target.value)}
            className="w-1/2 bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
          />
          <input
            type="number"
            placeholder="To"
            value={filters.year_to || ''}
            onChange={(e) => set('year_to', e.target.value)}
            className="w-1/2 bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Region</label>
        <select
          multiple
          value={filters.region || []}
          onChange={(e) => set('region', Array.from(e.target.selectedOptions, (o) => o.value))}
          className="w-full bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white h-24"
        >
          {Object.entries(REGION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Content Type</label>
        <select
          multiple
          value={filters.type || []}
          onChange={(e) => set('type', Array.from(e.target.selectedOptions, (o) => o.value))}
          className="w-full bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white h-28"
        >
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Research Domain</label>
        <select
          multiple
          value={filters.research_domain || []}
          onChange={(e) => set('research_domain', Array.from(e.target.selectedOptions, (o) => o.value))}
          className="w-full bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white h-28"
        >
          {Object.entries(DOMAIN_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">Expedition</label>
        <select
          value={filters.expedition_id || ''}
          onChange={(e) => set('expedition_id', e.target.value)}
          className="w-full bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white"
        >
          <option value="">Any expedition</option>
          {(facets?.expeditions || []).map((exp) => (
            <option key={exp.id} value={exp.id}>{exp.name}</option>
          ))}
        </select>
      </div>

      {showStatus && (
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1.5 block">Status</label>
          <select
            multiple
            value={filters.status || []}
            onChange={(e) => set('status', Array.from(e.target.selectedOptions, (o) => o.value))}
            className="w-full bg-[#162933] border border-slate-700 rounded px-2 py-1.5 text-sm text-white h-24"
          >
            <option value="published">Published (Approved)</option>
            <option value="archived">Archived</option>
            <option value="in_review">Under Review</option>
            <option value="draft">Pending</option>
          </select>
        </div>
      )}
    </div>
  );
}

// --- Submission tracking / queue rows -------------------------------------
export function SubmissionRow({ item, onDecide, onReprioritize, busy, showActions, showSaveOffline, onSaveOffline, saveBusy, savedOffline }) {
  return (
    <div className="bg-[#0f2129] border border-slate-700 rounded-lg p-4 mb-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <TypeBadge type={item.type} />
            <StagePill stage={item.archiveStage} />
            <span className="text-[11px] text-slate-500 font-mono">#{item.id.slice(0, 8)}</span>
          </div>
          <h3 className="text-white font-semibold">{item.title}</h3>
          <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <span>Submitted by: {item.uploader?.name || 'Unknown'}</span>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
            {item.region && <span>Region: {REGION_LABEL[item.region] || item.region}</span>}
            {item.expedition?.name && <span>Expedition: {item.expedition.name}</span>}
          </div>
        </div>

        {(showActions || showSaveOffline) && (
          <div className="flex items-center gap-2 shrink-0">
            {showActions && onReprioritize && (
              <input
                type="number"
                title="Queue priority (higher = sooner)"
                defaultValue={item.priority || 0}
                onBlur={(e) => onReprioritize(item.id, e.target.value)}
                className="w-16 bg-[#162933] border border-slate-700 rounded px-2 py-1 text-xs text-white"
              />
            )}
            {showActions && item.status === 'draft' && (
              <button
                disabled={busy}
                onClick={() => onDecide(item.id, 'in_review')}
                className="px-3 py-1.5 rounded bg-amber-700/70 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium"
              >
                Send to Review
              </button>
            )}
            {showActions && item.status === 'in_review' && (
              <button
                disabled={busy}
                onClick={() => onDecide(item.id, 'published')}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium"
              >
                Approve
              </button>
            )}
            {showSaveOffline && (
              <button
                disabled={saveBusy || savedOffline}
                onClick={() => onSaveOffline(item)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:cursor-default ${
                  savedOffline
                    ? 'bg-emerald-950/50 border border-emerald-800 text-emerald-300'
                    : 'bg-cyan-700 hover:bg-cyan-600 disabled:opacity-60 text-white'
                }`}
              >
                {saveBusy ? 'Saving…' : savedOffline ? 'Saved Offline' : 'Save Offline'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function QueueRow({ entry }) {
  return (
    <Link
      to={`/archive/${entry.id}`}
      className="flex items-center gap-4 bg-[#0f2129] border border-slate-700 rounded-lg px-4 py-3 mb-2 hover:border-cyan-600 transition-colors"
    >
      <span className="gauge-text text-cyan-400 text-sm shrink-0 w-10">#{entry.position}</span>
      <TypeBadge type={entry.type} />
      <span className="text-white text-sm font-medium truncate flex-1">{entry.title}</span>
      <StagePill stage={entry.archiveStage} />
    </Link>
  );
}
