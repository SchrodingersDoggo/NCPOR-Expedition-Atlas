import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client';
import { parseDatasetFull, inferColumnType } from '../utils/parseDataset';
import { buildOceanSection } from '../utils/oceanSection.js';
import OceanSection3D from '../components/OceanSection3D.jsx';
import TempSalinityDepth3D from '../components/TempSalinityDepth3D.jsx';
import { fetchExpeditionsList, createExpedition } from '../api/expeditions.js';
import { generateSummary, editSummary } from '../api/ai.js';
import { createMultipartUploadControl, uploadDatasetMultipart } from '../api/datasetUpload.js';
import {
  createDatasetMetadata,
  fetchMyDatasetMetadata,
  addFileToMetadata,
} from '../api/datasetMetadata.js';
import { enqueueContent, enqueueExpedition, generateLocalId } from '../offline/queue.js';
import {
  findMatchingDatasetUpload,
  listResumableDatasetUploads,
  removeDatasetUploadSession,
  updateDatasetUploadSession,
} from '../offline/datasetUploads.js';
import {
  DATASET_ACCEPT,
  DATASET_PREVIEW_MAX_BYTES,
  canQueueDatasetOffline,
  getDatasetUploadRoute,
  shouldPreviewDatasetFile,
  validateDatasetFile,
  validateFile,
} from '../offline/fileRules.js';
import { OfflineStorageError } from '../offline/storage.js';
import toast from 'react-hot-toast';
import DatasetPreviewCard from '../components/DatasetPreviewCard.jsx';
import RichTextEditor from '../components/RichTextEditor.jsx';
import {
  Plus,
  Trash2,
  Sparkles,
  Database,
  FileText,
  BookOpen,
  Image as ImageIcon,
  Video,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  UploadCloud,
  Pause,
  Play,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Check,
  ClipboardList,
  Ship,
} from 'lucide-react';

const TYPE_OPTIONS = [
  { value: 'dataset', label: 'Dataset' },
  { value: 'report', label: 'Report' },
  { value: 'publication', label: 'Publication' },
  { value: 'photo', label: 'Photo' },
  { value: 'video', label: 'Video' },
];

// Icon + accent used on each item card's header so a stack of items is
// scannable at a glance instead of reading as identical grey boxes.
const TYPE_META = {
  dataset: { icon: Database, accent: 'text-cyan-400' },
  report: { icon: FileText, accent: 'text-amber-400' },
  publication: { icon: BookOpen, accent: 'text-violet-400' },
  photo: { icon: ImageIcon, accent: 'text-emerald-400' },
  video: { icon: Video, accent: 'text-rose-400' },
};

const REGION_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'Arctic', label: 'Arctic' },
  { value: 'Antarctic', label: 'Antarctic' },
  { value: 'Himalaya', label: 'Himalaya' },
  { value: 'Southern_Ocean', label: 'Southern Ocean' },
  { value: 'Other', label: 'Other' },
];

// Same values/labels as DOMAIN_LABEL in components/archive/ArchiveUI.jsx —
// kept as a literal list here rather than importing that map, since this
// page shouldn't depend on the archive UI module just for option labels.
const DISCIPLINE_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'climate_science', label: 'Climate Science' },
  { value: 'glaciology', label: 'Glaciology' },
  { value: 'oceanography', label: 'Oceanography' },
  { value: 'atmospheric_science', label: 'Atmospheric Science' },
  { value: 'geology', label: 'Geology' },
  { value: 'biology_ecology', label: 'Biology / Ecology' },
  { value: 'other', label: 'Other' },
];

const PROCESSING_LEVEL_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'raw', label: 'Raw' },
  { value: 'processed', label: 'Processed' },
  { value: 'calibrated', label: 'Calibrated' },
  { value: 'derived', label: 'Derived' },
];

// The role of the specific FILE being attached — distinct from the
// metadata record's own overall "Processing Level" field above. One
// metadata record can hold several files with different roles (a raw
// sensor dump AND its processed version AND a calibration PDF), so this
// is picked per file-attach action, not once for the whole record.
const FILE_ROLE_OPTIONS = [
  { value: 'raw', label: 'Raw / Actual data' },
  { value: 'processed', label: 'Processed data' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'calibration', label: 'Calibration information' },
  { value: 'derived', label: 'Derived product' },
  { value: 'other', label: 'Other' },
];

// Blank scientific-metadata form for a dataset item — matches the NPDC
// metadata form fields (title/description live on the item itself already).
function makeBlankSciMeta() {
  return {
    principal_investigator: '', // '' = defaults to the submitting researcher
    institution: 'NCPOR',
    region: '',
    exact_location: '',
    latitude: '',
    longitude: '',
    observation_start: '',
    observation_end: '',
    discipline: '',
    keywords: '',
    parameters: '',
    instrument_method: '',
    processing_level: '',
    access_conditions: '',
    citation: '',
    file_format: '',
    units: '',
  };
}

const PREVIEW_ROWS = 8;

// Content types where a full write-up (body) and AI summary make sense.
// Photos/videos/datasets get a short caption only — the article is what
// reports and publications are for.
const ARTICLE_TYPES = ['report', 'publication'];

// --- Shared style tokens ------------------------------------------------
// One place for the recurring input/label/button treatments so every field
// on this page looks consistent instead of drifting className by className.
const FIELD_LABEL = 'block text-sm text-slate-300 mb-1.5';
const FIELD_HELP = 'mt-1.5 text-xs text-slate-500';
const FIELD_ERROR = 'mt-1.5 text-xs text-red-400 flex items-center gap-1';
const INPUT_BASE =
  'w-full px-3.5 py-2.5 rounded-lg bg-slate-900/70 border text-white placeholder:text-slate-600 transition-colors focus:outline-none focus:ring-1';
const inputClass = (hasError) =>
  `${INPUT_BASE} ${
    hasError
      ? 'border-red-500/70 focus:border-red-400 focus:ring-red-400'
      : 'border-slate-700 focus:border-cyan-400 focus:ring-cyan-400'
  }`;
const SECONDARY_BTN =
  'px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/70 hover:border-cyan-500 hover:text-cyan-300 text-xs text-slate-300 transition-colors disabled:opacity-40 disabled:pointer-events-none';

// Strips HTML tags so the AI summarizer gets plain text, not markup.
function htmlToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').trim();
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Pure helpers (no React state involved) ---------------------------

function generateCSVFromTable(table) {
  const { columns = [], rows = [] } = table;
  if (!columns.length) return '';
  const escapeCell = (val) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [];
  lines.push(columns.map(escapeCell).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return lines.join('\n');
}

function buildFileFromManualTable(table, title) {
  const csv = generateCSVFromTable(table);
  const safeName = (title || 'dataset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dataset';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  return new File([blob], safeName + '.csv', { type: 'text/csv' });
}

function parseManualTableMeta(table) {
  const { columns = [], rows = [] } = table;
  if (!columns.length) throw new Error('Table needs at least one column.');
  return {
    row_count: rows.length,
    columns: columns.map((name, idx) => {
      const colName = String(name ?? `column_${idx + 1}`).trim() || `column_${idx + 1}`;
      return {
        name: colName,
        type: inferColumnType(rows.map((r) => r[idx])),
      };
    }),
    preview_rows: rows
      .slice(0, PREVIEW_ROWS)
      .map((r) => r.map((v) => (v === undefined || v === null ? '' : String(v)))),
  };
}

function makeBlankItem(key) {
  return {
    key,
    type: 'dataset',
    title: '',
    description: '',
    body: '',
    summary: '',
    // AI summary state: 'idle' | 'generating' | 'success' | 'error'.
    // aiGeneration holds { id, aiOutput } for the saved AiGeneration row
    // once one exists, so an edited description can be persisted as an
    // audit trail via PATCH /api/ai/:id/edit on submit.
    aiStatus: 'idle',
    aiGeneration: null,
    file: null,
    parseStatus: 'idle', // 'idle' | 'parsing' | 'success' | 'skipped' | 'error'
    // Phase 0 routing marker. `multipart` files must never fall through to
    // the legacy Multer/Cloudinary endpoint or the IndexedDB Blob queue.
    datasetUploadRoute: null, // null | 'legacy' | 'multipart'
    datasetUploadProgress: null, // Phase 5/6 direct-to-MinIO transfer progress
    datasetResumeSession: null, // Phase 6 metadata-only IndexedDB resume record
    datasetMeta: null,
    oceanSection: null,
    manualTable: { columns: [], rows: [] },

    // --- Dataset scientific metadata (metadata-first / NPDC parity) ------
    // 'new' = fill in the fields below and create a fresh metadata record
    // (optionally with the file, if one's picked). 'existing' = this item
    // is attaching a file to a metadata record the researcher already
    // submitted (Priya's "two weeks later" step, or adding a second/third
    // file to a record that already has one) — sciMeta is unused then.
    metadataMode: 'new', // 'new' | 'existing'
    existingMetadataId: '',
    sciMeta: makeBlankSciMeta(),
    // What kind of file is being attached this time — one metadata record
    // can hold several files with different roles, so this travels with
    // the file, not with sciMeta.
    fileRole: 'raw',
  };
}

// Labels items by type + running count within that type ("Dataset 1",
// "Photo 2", "Report 3"...) instead of a generic, non-descriptive index —
// makes a stack of mixed-type items scannable at a glance.
function computeItemLabels(items) {
  const counts = {};
  return items.map((it) => {
    counts[it.type] = (counts[it.type] || 0) + 1;
    const typeLabel = TYPE_OPTIONS.find((t) => t.value === it.type)?.label || 'Item';
    return `${typeLabel} ${counts[it.type]}`;
  });
}

// --- Drag-and-drop file picker ------------------------------------------
// Shared by both the dataset file field and the generic (photo/video/report)
// file field. Shows a real drop target instead of a bare <input type=file>,
// plus an inline preview once a file is chosen (thumbnail for images/video,
// name+type+size otherwise).
function FileDropZone({ accept, file, onFileChange, previewKind = 'none', helperText, hasError }) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const previewUrl = useMemo(() => {
    if (!file || previewKind === 'none') return null;
    return URL.createObjectURL(file);
  }, [file, previewKind]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFileChange(dropped);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors ${
          isDragOver
            ? 'border-cyan-400 bg-cyan-950/20'
            : hasError
              ? 'border-red-500/60 bg-slate-900/40'
              : 'border-slate-700 hover:border-slate-500 bg-slate-900/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) onFileChange(selected);
          }}
        />

        {!file ? (
          <div className="flex flex-col items-center justify-center py-4 text-center gap-1.5">
            <UploadCloud className="w-6 h-6 text-slate-500" />
            <p className="text-sm text-slate-300">
              Drop a file here, or <span className="text-cyan-400 font-medium">browse</span>
            </p>
            {helperText && <p className="text-xs text-slate-500">{helperText}</p>}
          </div>
        ) : previewKind === 'image' && previewUrl ? (
          <div className="flex items-center gap-3">
            <img src={previewUrl} alt="" className="w-16 h-16 object-cover rounded-md border border-slate-700 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)} · click to replace</p>
            </div>
          </div>
        ) : previewKind === 'video' && previewUrl ? (
          <div className="flex items-center gap-3">
            <video src={previewUrl} className="w-24 h-16 object-cover rounded-md border border-slate-700 shrink-0" muted />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)} · click to replace</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-slate-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-xs text-slate-500">
                {file.type || 'Unknown type'} · {formatBytes(file.size)} · click to replace
              </p>
            </div>
          </div>
        )}
      </div>
      {hasError && (
        <p className={FIELD_ERROR}>
          <AlertCircle className="w-3.5 h-3.5" /> {hasError}
        </p>
      )}
    </div>
  );
}

function UploadPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // --- Expedition: attach to an existing one, or log a new one ---------
  const [expeditionMode, setExpeditionMode] = useState('new'); // 'existing' | 'new'
  const [expeditionsList, setExpeditionsList] = useState([]);
  const [expeditionsStatus, setExpeditionsStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [selectedExpeditionId, setSelectedExpeditionId] = useState('');
  const [newExpedition, setNewExpedition] = useState({
    name: '',
    region: '',
    description: '',
    start_date: '',
    end_date: '',
    latitude: '',
    longitude: '',
    // Voyage identity (NPDC's "Scientific Voyage Details" distinguishes a
    // voyage by ship name + voyage/cruise code — e.g. ship "ORV Sagar
    // Kanya", voyage "ISOE-14" — separate from this expedition's own name).
    ship_name: '',
    voyage_name: '',
    cruise_name: '',
    cruise_number: '',
    route_area: '',
    stations_visited: '',
  });
  // Collapsed by default — most expeditions logged here are land-based
  // field seasons, not ship voyages, and shouldn't be confronted with
  // voyage-only fields.
  const [showVoyageFields, setShowVoyageFields] = useState(false);

  useEffect(() => {
    fetchExpeditionsList()
      .then((list) => {
        setExpeditionsList(list);
        setExpeditionsStatus('ready');
        // If expeditions already exist, default to attaching to one rather
        // than nudging the researcher toward creating a duplicate.
        if (list.length > 0) {
          setExpeditionMode('existing');
          setSelectedExpeditionId(list[0].id);
        }
      })
      .catch((err) => {
        console.error('Failed to load expeditions', err);
        setExpeditionsStatus('error');
      });
  }, []);

  // --- The researcher's own dataset metadata records ---------------------
  // Two views of the same underlying data, fetched separately:
  //   - myUnlinkedMetadata: records with ZERO files at all — NPDC's "Saved
  //     and Incomplete Metadata" reminder. Shown as the amber panel.
  //   - myMetadataRecords: EVERY one of the researcher's own records,
  //     including ones that already have files — because a record with a
  //     raw file can still receive a processed file, a documentation PDF,
  //     etc. This is what the "attach file to existing record" dropdown
  //     uses, since limiting it to unlinked-only would make it impossible
  //     to add a second/third file to something already started.
  // Both are refetched after a successful submit so a record just
  // created/added-to updates immediately.
  const [myUnlinkedMetadata, setMyUnlinkedMetadata] = useState([]);
  const [myMetadataRecords, setMyMetadataRecords] = useState([]);
  const [unlinkedStatus, setUnlinkedStatus] = useState('loading'); // 'loading' | 'ready' | 'error'

  const loadUnlinkedMetadata = useCallback(() => {
    if (!isAuthenticated) return;
    setUnlinkedStatus('loading');
    Promise.all([
      fetchMyDatasetMetadata({ unlinked: true }),
      fetchMyDatasetMetadata(),
    ])
      .then(([unlinked, all]) => {
        setMyUnlinkedMetadata(unlinked);
        setMyMetadataRecords(all);
        setUnlinkedStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load dataset metadata', err);
        setUnlinkedStatus('error');
      });
  }, [isAuthenticated]);

  useEffect(() => {
    loadUnlinkedMetadata();
  }, [loadUnlinkedMetadata]);

  // --- Content items: one expedition can carry many uploads at once -----
  const nextKeyRef = useRef(1);
  const [items, setItems] = useState(() => [makeBlankItem(0)]);
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  // Validation errors only surface after a submit attempt, so the form
  // doesn't greet a researcher with a wall of red on first load.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Phase 6 multipart state. Controls are intentionally in-memory (they own
  // the current XHR pause/resume switch); durable upload state lives in the
  // metadata-only IndexedDB store and never contains the multi-GB File/Blob.
  const multipartControlsRef = useRef(new Map());
  const [resumableUploads, setResumableUploads] = useState([]);

  const refreshResumableUploads = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setResumableUploads([]);
      return;
    }
    try {
      setResumableUploads(await listResumableDatasetUploads(user.id));
    } catch (error) {
      console.warn('Could not read resumable dataset upload state:', error);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    refreshResumableUploads();
  }, [refreshResumableUploads]);

  const from = location.state?.from?.pathname || '/';

  const itemLabels = useMemo(() => computeItemLabels(items), [items]);

  // Used by the Scientific Metadata section's Principal Investigator
  // picker — if attaching to an existing expedition that already has a PI
  // on record, offer crediting that person instead of always defaulting to
  // whoever is filling in the form (a comms_officer cataloguing someone
  // else's voyage, for instance).
  const selectedExpeditionPI = useMemo(() => {
    if (expeditionMode !== 'existing' || !selectedExpeditionId) return null;
    return expeditionsList.find((e) => e.id === selectedExpeditionId)?.pi || null;
  }, [expeditionMode, selectedExpeditionId, expeditionsList]);

  const updateItem = useCallback((key, patch) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const addItem = useCallback(() => {
    const key = nextKeyRef.current++;
    setItems((list) => [...list, makeBlankItem(key)]);
  }, []);

  const removeItem = useCallback((key) => {
    setItems((list) => (list.length <= 1 ? list : list.filter((it) => it.key !== key)));
    setCollapsedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback((key) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Switching an item's type clears whatever file/dataset state belonged to
  // its previous type, so e.g. a parsed CSV doesn't silently ride along
  // after switching that item from Dataset to Photo.
  const handleItemTypeChange = (key, type) => {
    updateItem(key, {
      type,
      file: null,
      parseStatus: 'idle',
      datasetUploadRoute: null,
      datasetUploadProgress: null,
      datasetResumeSession: null,
      datasetMeta: null,
      oceanSection: null,
      metadataMode: 'new',
      existingMetadataId: '',
      sciMeta: makeBlankSciMeta(),
    });
  };

  // Switching between "create new metadata" and "attach file to existing
  // metadata" for a dataset item. Picking an existing record also drops
  // whatever was typed into the sciMeta fields — that record's own fields
  // are what will actually be used, so stale local edits shouldn't linger.
  const handleMetadataModeChange = (key, mode) => {
    updateItem(key, {
      metadataMode: mode,
      existingMetadataId: '',
      ...(mode === 'new' ? { sciMeta: makeBlankSciMeta() } : {}),
    });
  };

  const updateSciMeta = (key, patch) => {
    setItems((list) =>
      list.map((it) => (it.key === key ? { ...it, sciMeta: { ...it.sciMeta, ...patch } } : it))
    );
  };

  // Phase 0 dataset selection. Dataset files deliberately use their own
  // validator instead of validateFile(), because the normal media/document
  // path must keep its existing 100 MiB Multer/Cloudinary limit unchanged.
  //
  // Only small CSV/TSV/Excel tables are read for the current preview/3D
  // viewer. Large tables and binary scientific formats (.nc/.nc4/.h5/.grib/.zip)
  // are never read into browser memory here; they are marked for the future
  // direct multipart path instead.
  const handleDatasetFileChange = async (key, selectedFile) => {
    if (!selectedFile) return;

    const check = validateDatasetFile(selectedFile);
    if (!check.ok) {
      toast.error(check.error, { duration: 8000 });
      return;
    }

    const datasetUploadRoute = getDatasetUploadRoute(selectedFile);
    const canPreview = shouldPreviewDatasetFile(selectedFile);

    // Phase 6: after a page/browser restart the File object itself is gone,
    // but the metadata-only multipart session remains. Reuse it only when
    // the researcher reselects the exact same local file identity.
    let datasetResumeSession = null;
    if (datasetUploadRoute === 'multipart' && user?.id) {
      try {
        datasetResumeSession = await findMatchingDatasetUpload(selectedFile, user.id);
      } catch (error) {
        console.warn('Could not check resumable dataset uploads:', error);
      }
    }
    const resumeProgress = datasetResumeSession
      ? {
          status: datasetResumeSession.status === 'completed' ? 'completed' : 'resumable',
          uploadedBytes: Number(datasetResumeSession.uploadedBytes || 0),
          totalBytes: selectedFile.size,
          percent: selectedFile.size
            ? Math.round((Number(datasetResumeSession.uploadedBytes || 0) / selectedFile.size) * 100)
            : 0,
          partNumber: 0,
          totalParts: Number(datasetResumeSession.totalParts || 0),
          resumed: true,
        }
      : null;

    if (!canPreview) {
      updateItem(key, {
        file: selectedFile,
        parseStatus: 'skipped',
        datasetUploadRoute,
        datasetUploadProgress: resumeProgress,
        datasetResumeSession,
        datasetMeta: null,
        oceanSection: null,
      });
      if (datasetResumeSession) {
        toast.success(
          datasetResumeSession.status === 'completed'
            ? `Upload already completed for ${selectedFile.name}. Submit to finish the metadata attachment.`
            : `Found interrupted upload for ${selectedFile.name}. Submit to resume missing parts.`
        );
      }
      return;
    }

    updateItem(key, {
      file: selectedFile,
      parseStatus: 'parsing',
      datasetUploadRoute,
      datasetUploadProgress: resumeProgress,
      datasetResumeSession,
      datasetMeta: null,
      oceanSection: null,
    });
    try {
      const { meta, headers, rows } = await parseDatasetFull(selectedFile);
      // CNV now has a real V1 scientific reader. Do not feed it into the old
      // heuristic 3D preview; V2/V3's capability engine will decide which
      // scientifically valid view a cast can support.
      const oceanSection = /\.cnv$/i.test(selectedFile.name) ? null : buildOceanSection(headers, rows);
      updateItem(key, { datasetMeta: meta, oceanSection, parseStatus: 'success' });
    } catch (err) {
      console.error('Dataset parse error:', err);
      updateItem(key, { parseStatus: 'error' });
    }
  };

  const pauseMultipartUpload = (key) => {
    const control = multipartControlsRef.current.get(key);
    if (!control) return;
    control.pause();
    setItems((list) =>
      list.map((it) =>
        it.key === key && it.datasetUploadProgress
          ? { ...it, datasetUploadProgress: { ...it.datasetUploadProgress, status: 'paused' } }
          : it
      )
    );
  };

  const resumeMultipartUpload = (key) => {
    const control = multipartControlsRef.current.get(key);
    if (!control) return;
    control.resume();
    setItems((list) =>
      list.map((it) =>
        it.key === key && it.datasetUploadProgress
          ? { ...it, datasetUploadProgress: { ...it.datasetUploadProgress, status: 'uploading' } }
          : it
      )
    );
  };

  // Any other type — any file, no parsing, straight to Cloudinary on submit.
  const handleGenericFileChange = (key, selectedFile) => {
    if (!selectedFile) return;

    const check = validateFile(selectedFile);
    if (!check.ok) {
      toast.error(check.error, { duration: 8000 });
      return;
    }
    if (check.warning) toast(check.warning, { duration: 8000 });

    updateItem(key, { file: selectedFile });
  };

  // AI summary: takes the plain text of the article body, asks the backend
  // for a ~100-150 word web summary, and puts it in its own Summary field
  // (kept separate from the hand-written Description above it — generating
  // one shouldn't overwrite the other). Still editable afterwards; the edit
  // gets persisted on submit, see handleSubmit.
  const handleGenerateSummary = async (key, item) => {
    const plainText = htmlToPlainText(item.body);
    if (!plainText) {
      toast.error("Write the article body first — there's nothing to summarize yet.");
      return;
    }
    updateItem(key, { aiStatus: 'generating' });
    try {
      const result = await generateSummary(plainText, { type: 'web_summary' });
      updateItem(key, {
        aiStatus: 'success',
        summary: result.aiOutput,
        aiGeneration: { id: result.id, aiOutput: result.aiOutput },
      });
    } catch (err) {
      console.error('AI summary generation failed:', err);
      updateItem(key, { aiStatus: 'error' });
    }
  };

  // --- Manual table builder, scoped to a single item --------------------
  const addManualRow = (key) => {
    setItems((list) =>
      list.map((it) =>
        it.key === key
          ? { ...it, manualTable: { columns: it.manualTable.columns, rows: [...it.manualTable.rows, Array(it.manualTable.columns.length).fill('')] } }
          : it
      )
    );
  };

  const removeManualRow = (key) => {
    setItems((list) =>
      list.map((it) =>
        it.key === key
          ? { ...it, manualTable: { columns: it.manualTable.columns, rows: it.manualTable.rows.slice(0, -1) } }
          : it
      )
    );
  };

  const addManualColumn = (key) => {
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key) return it;
        return {
          ...it,
          manualTable: {
            columns: [...it.manualTable.columns, `Column ${it.manualTable.columns.length + 1}`],
            rows: it.manualTable.rows.map((row) => [...row, '']),
          },
        };
      })
    );
  };

  const removeManualColumn = (key) => {
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key) return it;
        if (it.manualTable.columns.length <= 1) return it;
        return {
          ...it,
          manualTable: {
            columns: it.manualTable.columns.slice(0, -1),
            rows: it.manualTable.rows.map((row) => row.slice(0, -1)),
          },
        };
      })
    );
  };

  const setManualCell = (key, rowIdx, colIdx, value) => {
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key) return it;
        const newRows = it.manualTable.rows.map((r) => [...r]);
        newRows[rowIdx][colIdx] = value;
        return { ...it, manualTable: { columns: it.manualTable.columns, rows: newRows } };
      })
    );
  };

  const parseManualForItem = (key, item) => {
    if (!item.manualTable.columns.length) {
      toast.error('Table needs at least one column.');
      return;
    }
    try {
      const result = parseManualTableMeta(item.manualTable);
      const oceanSection = buildOceanSection(item.manualTable.columns, item.manualTable.rows);
      updateItem(key, { datasetMeta: result, oceanSection, parseStatus: 'success' });
    } catch (err) {
      console.error('Manual table parse error:', err);
      updateItem(key, { parseStatus: 'error' });
    }
  };

  // --- Validation ----------------------------------------------------
  // Computed on every render (cheap — a handful of items at most) and only
  // displayed inline once submitAttempted flips true, so errors show up
  // next to the field that caused them instead of an alert() dialog.
  const validate = useCallback(() => {
    const errs = { expedition: null, items: {} };
    if (expeditionMode === 'existing' && !selectedExpeditionId) {
      errs.expedition = 'Choose an expedition to attach this content to.';
    }
    if (expeditionMode === 'new' && !newExpedition.name.trim()) {
      errs.expedition = 'Give the new expedition a name.';
    }
    for (const item of items) {
      const itemErrors = {};
      if (!item.title.trim()) itemErrors.title = 'Title is required.';

      if (item.type === 'dataset') {
        // Metadata-first: a dataset item is valid with just a title —
        // the file (and thus datasetMeta) is optional when creating a new
        // metadata record. Attaching to an *existing* record is the one
        // dataset case where a file is required, since that's the whole
        // point of that action.
        if (item.metadataMode === 'existing') {
          if (!item.existingMetadataId) {
            itemErrors.file = 'Choose which metadata record to attach a file to.';
          } else if (!item.file) {
            itemErrors.file = 'Choose the file to attach.';
          }
        }

      } else if (!item.file) {
        itemErrors.file = 'Choose a file.';
      }

      if (Object.keys(itemErrors).length) errs.items[item.key] = itemErrors;
    }
    return errs;
  }, [expeditionMode, selectedExpeditionId, newExpedition, items]);

  const errors = validate();
  const hasBlockingErrors = Boolean(errors.expedition) || Object.keys(errors.items).length > 0;

  // Submits one item live: uploads its file (if any) then creates the
  // content record, attached to a real expeditionId. Throws on any
  // network/server failure so the caller can decide to queue it instead.
  // Extracted out of handleSubmit so both the "try now" path and (later,
  // Phase C) a queue-draining sync manager can reuse the exact same logic
  // rather than it living duplicated inline.
  const submitItemNow = async (item, fileToUpload, expeditionId, clientRequestId) => {
    let fileResult = null;
    if (fileToUpload) {
      const uploadForm = new FormData();
      uploadForm.append('file', fileToUpload);
      const uploadRes = await api.post('/upload', uploadForm, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      fileResult = uploadRes.data;
    }

    const payload = {
      expedition_id: expeditionId,
      type: item.type,
      title: item.title,
      description: item.description,
      body: ARTICLE_TYPES.includes(item.type) ? item.body : undefined,
      summary: ARTICLE_TYPES.includes(item.type) ? item.summary : undefined,
      file_url: fileResult?.file_url || null,
      thumbnail_url: fileResult?.thumbnail_url || null,
      mime_type: fileResult?.mime_type || fileToUpload?.type || null,
      file_size_bytes: fileResult?.file_size_bytes || fileToUpload?.size || null,
      client_request_id: clientRequestId,
    };
    if (item.type === 'dataset' && item.datasetMeta) {
      payload.datasetMeta = item.datasetMeta;
    }

    const { data: created } = await api.post('/content', payload);

    // If the AI summary was edited further before submitting, persist that
    // edit against the AiGeneration record as an audit trail (ai_output
    // untouched, edited_output set). Best-effort — a failure here shouldn't
    // block the content item itself.
    if (item.aiGeneration && item.summary !== item.aiGeneration.aiOutput) {
      try {
        await editSummary(item.aiGeneration.id, item.summary);
      } catch (err) {
        console.error('Failed to save AI summary edit:', err);
      }
    }

    return created;
  };

  // Uploads every scientific dataset file through the direct browser -> MinIO
  // multipart uploader. Small CSV/TSV/Excel files may still be parsed locally
  // for preview above, but storage is MinIO regardless of size. Then route the
  // resulting file reference to the
  // existing dataset-metadata endpoint:
  //   - metadataMode 'existing' -> add the file to a metadata record the
  //     researcher already submitted (addFileToMetadata) — this record may
  //     already have other files; this just adds one more, tagged with
  //     item.fileRole.
  //   - metadataMode 'new'      -> create the metadata record now, with the
  //     file (and its role) linked in the same call if one was chosen, or
  //     with no file at all (a pure "describe it now, upload later"
  //     submission).
  // Mirrors submitItemNow's shape (same file-upload step, same return
  // convention) so both can be called interchangeably from handleSubmit.
  const submitDatasetItemNow = async (item, fileToUpload, expeditionId, clientRequestId) => {
    let content;
    if (fileToUpload) {
      // Final Phase 8 policy: every scientific dataset uses MinIO. Recompute
      // the route from the actual file at submit time rather than trusting UI
      // state; non-dataset uploads still use the unchanged Cloudinary route.
      if (getDatasetUploadRoute(fileToUpload) !== 'multipart') {
        throw new Error('Unsupported scientific dataset file.');
      }

      let control = multipartControlsRef.current.get(item.key);
      if (!control) {
        control = createMultipartUploadControl();
        multipartControlsRef.current.set(item.key, control);
      }

      let completed;
      try {
        completed = await uploadDatasetMultipart(fileToUpload, {
          ownerId: user?.id,
          resumeSession: item.datasetResumeSession,
          control,
          onProgress: (progress) => updateItem(item.key, { datasetUploadProgress: progress }),
        });
      } finally {
        multipartControlsRef.current.delete(item.key);
      }

      content = {
        file_url: null,
        thumbnail_url: null,
        mime_type: completed?.mimeType || fileToUpload?.type || 'application/octet-stream',
        file_size_bytes: completed?.fileSize || fileToUpload?.size || null,
        dataset_meta: item.datasetMeta || undefined,
        storage_provider: 'minio',
        object_key: completed?.objectKey,
        original_file_name: completed?.fileName || fileToUpload.name,
        checksum_sha256: completed?.checksumSHA256 || null,
        upload_status: completed?.uploadStatus || 'completed',
        upload_session_id: completed?.sessionId,
      };
    }

    let saved;
    try {
      if (item.metadataMode === 'existing') {
        saved = await addFileToMetadata(item.existingMetadataId, { role: item.fileRole || 'raw', ...content });
      } else {
        const sci = item.sciMeta;
        saved = await createDatasetMetadata({
          title: item.title,
          description: item.description,
          expedition_id: expeditionId,
          principal_investigator: sci.principal_investigator || undefined,
          institution: sci.institution,
          region: sci.region || undefined,
          exact_location: sci.exact_location,
          latitude: sci.latitude !== '' ? parseFloat(sci.latitude) : undefined,
          longitude: sci.longitude !== '' ? parseFloat(sci.longitude) : undefined,
          observation_start: sci.observation_start || undefined,
          observation_end: sci.observation_end || undefined,
          discipline: sci.discipline || undefined,
          keywords: sci.keywords,
          parameters: sci.parameters,
          instrument_method: sci.instrument_method,
          processing_level: sci.processing_level || undefined,
          access_conditions: sci.access_conditions,
          citation: sci.citation,
          file_format: sci.file_format || fileToUpload?.name?.split('.').pop() || undefined,
          units: sci.units,
          client_request_id: clientRequestId,
          role: content ? (item.fileRole || 'raw') : undefined,
          content,
        });
      }
    } catch (error) {
      if (content?.upload_session_id) {
        const detail = error?.response?.data?.error || error?.message || 'Final metadata attachment failed.';
        try {
          await updateDatasetUploadSession(content.upload_session_id, {
            status: 'completed',
            lastError: `MinIO upload completed, but final metadata attachment is still pending: ${detail}`,
            lastErrorCode: 'DATASET_FINALIZATION_PENDING',
          });
          refreshResumableUploads();
        } catch (stateError) {
          console.warn('Could not record pending dataset finalization state:', stateError);
        }
      }
      throw error;
    }

    // Keep a completed multipart session until the metadata/content record is
    // successfully attached. If that final API call fails, a retry can reuse
    // the already-completed MinIO object instead of uploading it again.
    if (content?.upload_session_id) {
      try {
        await removeDatasetUploadSession(content.upload_session_id);
        refreshResumableUploads();
      } catch (error) {
        console.warn('Could not clear completed multipart resume state:', error);
      }
    }
    return saved;
  };

  // --- Submit: create/attach the expedition, then upload every item ------
  //
  // Offline-aware (Phase B): tries the live path first when the browser
  // reports it's online. If that's not the case — or a live attempt fails
  // partway through, e.g. a connection that *looked* up but drops mid
  // request — the item is saved into the local queue (Phase A's IndexedDB
  // store) instead of being lost. Nothing here automatically retries a
  // queued item later or watches for reconnection; draining the queue once
  // connectivity returns is Phase C, deliberately not built yet.
  const handleSubmit = useCallback(async () => {
    setSubmitAttempted(true);
    const validationErrors = validate();
    if (validationErrors.expedition || Object.keys(validationErrors.items).length > 0) {
      toast.error('Please fix the highlighted fields before submitting.');
      // Expand any collapsed item that's missing something, so the
      // researcher isn't hunting for which card has the problem.
      setCollapsedKeys((prev) => {
        const next = new Set(prev);
        for (const key of Object.keys(validationErrors.items)) next.delete(Number(key));
        return next;
      });
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: resolve the expedition this content belongs to. If we're
      // creating a new one and can't reach the server for it, it gets
      // queued too — every content item below then attaches to that queued
      // expedition via localExpeditionId instead of a real expeditionId,
      // since one doesn't exist yet.
      let expeditionId = selectedExpeditionId;
      let localExpeditionId = null;

      if (expeditionMode === 'new') {
        const expeditionFields = {
          name: newExpedition.name.trim(),
          region: newExpedition.region || undefined,
          description: newExpedition.description || undefined,
          start_date: newExpedition.start_date || undefined,
          end_date: newExpedition.end_date || undefined,
          latitude: newExpedition.latitude !== '' ? parseFloat(newExpedition.latitude) : undefined,
          longitude: newExpedition.longitude !== '' ? parseFloat(newExpedition.longitude) : undefined,
          ship_name: newExpedition.ship_name || undefined,
          voyage_name: newExpedition.voyage_name || undefined,
          cruise_name: newExpedition.cruise_name || undefined,
          cruise_number: newExpedition.cruise_number || undefined,
          route_area: newExpedition.route_area || undefined,
          stations_visited: newExpedition.stations_visited || undefined,
          principal_investigator: user?.id,
        };

        const localExpeditionIdForRequest = generateLocalId();
        let createdLive = false;
        if (navigator.onLine) {
          try {
            const created = await createExpedition({
              ...expeditionFields,
              client_request_id: localExpeditionIdForRequest,
            });
            expeditionId = created.id;
            createdLive = true;
          } catch (err) {
            console.warn('Live expedition creation failed, queuing instead:', err);
          }
        }
        if (!createdLive) {
          const queued = await enqueueExpedition({
            ...expeditionFields,
            localId: localExpeditionIdForRequest,
          });
          localExpeditionId = queued.localId;
        }
      }

      // Step 2: every content item — try live if we have a real
      // expeditionId to attach to and the browser looks online; queue it
      // otherwise (including when the live attempt itself throws).
      let queuedCount = 0;
      for (const item of items) {
        let fileToUpload = item.file;
        if (item.type === 'dataset' && !item.file && item.manualTable.columns.length > 0 && item.datasetMeta) {
          fileToUpload = buildFileFromManualTable(item.manualTable, item.title);
        }

        const clientRequestId = generateLocalId();
        const canAttemptLive = navigator.onLine && !localExpeditionId;
        const isDatasetFile = item.type === 'dataset' && Boolean(fileToUpload);
        const datasetCanQueueOffline = isDatasetFile && canQueueDatasetOffline(fileToUpload);
        let succeededLive = false;

        // Every dataset targets MinIO while online. Preserve the existing
        // offline Blob queue only for small datasets that fit its established
        // safety boundary; large/multi-GB datasets must never be copied into
        // IndexedDB and therefore still require a live direct upload.
        if (isDatasetFile && !canAttemptLive && !datasetCanQueueOffline) {
          throw new Error('Large scientific datasets require an online connection for direct MinIO upload.');
        }

        if (canAttemptLive) {
          try {
            if (item.type === 'dataset') {
              await submitDatasetItemNow(item, fileToUpload, expeditionId, clientRequestId);
            } else {
              await submitItemNow(item, fileToUpload, expeditionId, clientRequestId);
            }
            succeededLive = true;
          } catch (err) {
            if (isDatasetFile) {
              const looksLikeNetworkFailure =
                navigator.onLine === false
                || err?.code === 'ERR_NETWORK'
                || err?.code === 'ECONNABORTED'
                || (err?.request && !err?.response);

              // If MinIO already has the complete object, never fall back
              // to the Blob queue just because the final metadata request lost
              // connectivity. Keep the completed session for Sync Center
              // finalization instead of uploading the same bytes again later.
              if (looksLikeNetworkFailure && user?.id) {
                const completedSession = await findMatchingDatasetUpload(fileToUpload, user.id);
                if (completedSession?.status === 'completed') {
                  throw new Error(
                    'Dataset upload is safely completed in MinIO, but the final metadata attachment is pending. ' +
                    'Use Sync Center → Finalize when the connection is available.'
                  );
                }
              }

              // Small datasets may fall back to the existing offline Blob
              // queue only for connectivity loss before MinIO completion.
              // Integrity/auth/session failures stay visible and terminal.
              if (!datasetCanQueueOffline || !looksLikeNetworkFailure) throw err;
            }
            console.warn(`Live submit failed for "${item.title}", queuing instead:`, err);
          }
        }

        // The existing offline queue remains available for small dataset
        // Blobs. Its sync manager uploads dataset bytes through MinIO when
        // connectivity returns; non-dataset queued content keeps Cloudinary.
        if (!succeededLive) {
          await enqueueContent({
            expeditionId: localExpeditionId ? undefined : expeditionId,
            localExpeditionId: localExpeditionId || undefined,
            type: item.type,
            title: item.title,
            description: item.description,
            body: ARTICLE_TYPES.includes(item.type) ? item.body : undefined,
            summary: ARTICLE_TYPES.includes(item.type) ? item.summary : undefined,
            datasetMeta: item.type === 'dataset' ? item.datasetMeta : undefined,
            file: fileToUpload || null,
            fileName: fileToUpload?.name || null,
            localId: clientRequestId,
          });
          queuedCount += 1;
        }
      }

      if (queuedCount > 0) {
        toast.success(
          `Saved ${queuedCount} item${queuedCount > 1 ? 's' : ''} on this device — they'll be ready to submit once you're back online.`,
          { duration: 6000 }
        );
      }

      loadUnlinkedMetadata();
      navigate(from, { replace: true });
    } catch (err) {
      console.error('Submission error:', err);

      // Phase 7: a full device is the one failure where the researcher has to
      // act immediately, so it gets its own message rather than being folded
      // into a generic "submission failed" that implies everything is lost.
      if (err instanceof OfflineStorageError) {
        toast.error(
          `${err.message}${queuedCount > 0 ? ` ${queuedCount} item${queuedCount > 1 ? 's were' : ' was'} saved before space ran out.` : ''}`,
          { duration: 12000 }
        );
      } else {
        toast.error('Submission failed: ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setSubmitting(false);
    }
  }, [expeditionMode, selectedExpeditionId, newExpedition, items, user, navigate, from, validate, loadUnlinkedMetadata]);

  // How far along the researcher is, just for the progress dots in the
  // header — the form itself still scrolls as one page, this is only a
  // lightweight sense of "where am I" (expedition chosen → adding content).
  const headerStep = expeditionMode === 'existing' && !selectedExpeditionId ? 1
    : expeditionMode === 'new' && !newExpedition.name.trim() ? 1
    : 2;

  return (
    <div className="chart-backdrop min-h-screen">
      {/* Page header ------------------------------------------------------
          A proper hero instead of a bare title bar: breadcrumb-style back
          link, an icon badge to anchor the eye, a one-line explainer of what
          this page is for, and a tiny progress cue so the form doesn't feel
          like a single undifferentiated wall of fields. */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--hull-light), var(--hull) 55%, var(--abyss))', borderBottom: '1px solid rgba(195,154,94,0.2)' }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
        <div
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl"
          style={{ background: 'rgba(232,198,136,0.10)' }}
          aria-hidden="true"
        />

        <div className="relative max-w-3xl mx-auto px-6 pt-7 pb-8">
          <button
            type="button"
            onClick={() => navigate(from, { replace: true })}
            className="group inline-flex items-center gap-1.5 -ml-1.5 px-1.5 py-1 rounded-md text-sm transition-colors mb-5"
            style={{ color: 'var(--ice-dim)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--brass-bright)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ice-dim)')}
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Back
          </button>

          <div className="flex items-start gap-4">
            <div
              className="hidden sm:flex w-12 h-12 shrink-0 items-center justify-center rounded-xl"
              style={{ border: '1px solid rgba(232,198,136,0.25)', background: 'rgba(232,198,136,0.10)' }}
            >
              <UploadCloud className="w-6 h-6" style={{ color: 'var(--brass-bright)' }} />
            </div>
            <div className="min-w-0">
              <h1
                className="text-2xl sm:text-3xl italic tracking-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}
              >
                Upload Expedition Content
              </h1>
              <p className="mt-1.5 text-sm max-w-xl leading-relaxed" style={{ color: 'var(--ice-dim)' }}>
                Attach datasets, reports, photos, or videos to an expedition record — everything
                you add here becomes part of the public Expedition Atlas.
              </p>
            </div>
          </div>

          {isAuthenticated && (
            <div className="mt-7 flex items-center gap-2.5 text-xs font-medium">
              <span className="flex items-center gap-1.5" style={{ color: headerStep >= 1 ? 'var(--brass-bright)' : 'var(--ice-dim)' }}>
                <span
                  className="flex w-5 h-5 items-center justify-center rounded-full text-[10px]"
                  style={
                    headerStep > 1
                      ? { background: 'var(--brass-bright)', color: '#0e2432' }
                      : { border: '1px solid var(--brass-dim)', color: 'var(--brass-bright)' }
                  }
                >
                  {headerStep > 1 ? <Check className="w-3 h-3" strokeWidth={3} /> : '1'}
                </span>
                Expedition
              </span>
              <span className="h-px w-8" style={{ background: headerStep > 1 ? 'var(--brass-dim)' : 'rgba(143,179,184,0.3)' }} />
              <span className="flex items-center gap-1.5" style={{ color: headerStep >= 2 ? 'var(--brass-bright)' : 'var(--ice-dim)' }}>
                <span
                  className="flex w-5 h-5 items-center justify-center rounded-full text-[10px]"
                  style={headerStep >= 2 ? { border: '1px solid var(--brass-dim)', color: 'var(--brass-bright)' } : { border: '1px solid rgba(143,179,184,0.3)', color: 'var(--ice-dim)' }}
                >
                  2
                </span>
                Content
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pb-6 pt-8">
        {!isAuthenticated ? (
          <p className="mb-6 max-w-3xl mx-auto" style={{ color: 'var(--ice-dim)' }}>
            Sign in to access the upload form.
          </p>
        ) : (
          <div className="brass-plate rounded-2xl p-6 md:p-8 max-w-3xl mx-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              {resumableUploads.length > 0 && (
                <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                  <div className="flex items-start gap-3">
                    <UploadCloud className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-200">
                        {resumableUploads.every((upload) => upload.status === 'completed')
                          ? 'Completed dataset upload pending finalization'
                          : resumableUploads.some((upload) => upload.status === 'completed')
                            ? 'Dataset upload recovery available'
                            : 'Interrupted dataset upload available'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        {resumableUploads.every((upload) => upload.status === 'completed')
                          ? 'The MinIO upload is complete. Reselect the same local file in a Dataset item and submit to finish the metadata/content attachment.'
                          : 'Reselect the same local file in a Dataset item. The portal will verify the file and ask MinIO which parts already exist before continuing.'}
                      </p>
                      <div className="mt-2 space-y-1">
                        {resumableUploads.slice(0, 3).map((upload) => (
                          <p key={upload.sessionId} className="truncate text-xs text-slate-300">
                            {upload.fileName} · {formatBytes(upload.uploadedBytes || 0)} of {formatBytes(upload.fileSize)} · {upload.status === 'completed'
                              ? 'upload complete — finalization pending'
                              : upload.status === 'paused'
                                ? 'paused — resumable'
                                : upload.status === 'waiting-network'
                                  ? 'waiting for network — resumable'
                                  : upload.status === 'storage-unavailable'
                                    ? 'storage temporarily unavailable — resumable'
                                    : 'interrupted — resumable'}
                          </p>
                        ))}
                        {resumableUploads.length > 3 && (
                          <p className="text-xs text-slate-500">+{resumableUploads.length - 3} more saved upload(s)</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Expedition section */}
              <div className="mb-8 pb-8 border-b border-slate-700">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300 text-xs font-bold">
                    1
                  </span>
                  <h2 className="text-lg font-semibold text-white">Expedition</h2>
                </div>
                <p className="text-sm text-slate-400 mb-4 ml-[34px]">
                  Everything you upload below gets attached to this expedition.
                </p>

                {expeditionsStatus === 'ready' && expeditionsList.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-3 mb-5">
                    <button
                      type="button"
                      onClick={() => setExpeditionMode('existing')}
                      className={`relative text-left rounded-xl border p-4 transition-all ${
                        expeditionMode === 'existing'
                          ? 'border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-950/30'
                          : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                      }`}
                    >
                      {expeditionMode === 'existing' && (
                        <span className="absolute top-3 right-3 flex w-4 h-4 items-center justify-center rounded-full bg-cyan-500 text-[#0e2432]">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                      <div className="flex items-center gap-2 mb-1">
                        <FolderOpen className={`w-4 h-4 ${expeditionMode === 'existing' ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <span className="font-medium text-white text-sm">Attach to existing expedition</span>
                      </div>
                      <p className="text-xs text-slate-500 pr-4">Add this content to an expedition that's already logged.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpeditionMode('new')}
                      className={`relative text-left rounded-xl border p-4 transition-all ${
                        expeditionMode === 'new'
                          ? 'border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-950/30'
                          : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                      }`}
                    >
                      {expeditionMode === 'new' && (
                        <span className="absolute top-3 right-3 flex w-4 h-4 items-center justify-center rounded-full bg-cyan-500 text-[#0e2432]">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                      <div className="flex items-center gap-2 mb-1">
                        <FolderPlus className={`w-4 h-4 ${expeditionMode === 'new' ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <span className="font-medium text-white text-sm">Log a new expedition</span>
                      </div>
                      <p className="text-xs text-slate-500 pr-4">Start a fresh expedition record and attach this content to it.</p>
                    </button>
                  </div>
                )}

                {expeditionMode === 'existing' && (
                  <div>
                    {expeditionsStatus === 'loading' && (
                      <p className="text-sm text-slate-400">Loading expeditions…</p>
                    )}
                    {expeditionsStatus === 'error' && (
                      <p className="text-sm text-red-400">Couldn't load expeditions. Try logging a new one instead.</p>
                    )}
                    {expeditionsStatus === 'ready' && (
                      <>
                        <select
                          value={selectedExpeditionId}
                          onChange={(e) => setSelectedExpeditionId(e.target.value)}
                          className={inputClass(submitAttempted && errors.expedition)}
                        >
                          {expeditionsList.map((exp) => (
                            <option key={exp.id} value={exp.id}>
                              {exp.name}
                              {exp.region ? ` — ${exp.region.replace('_', ' ')}` : ''}
                              {exp.startDate ? ` (${new Date(exp.startDate).getFullYear()})` : ''}
                            </option>
                          ))}
                        </select>
                        {submitAttempted && errors.expedition && (
                          <p className={FIELD_ERROR}>
                            <AlertCircle className="w-3.5 h-3.5" /> {errors.expedition}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {expeditionMode === 'new' && (
                  <div className="space-y-4">
                    <div>
                      <label className={FIELD_LABEL}>Expedition Name</label>
                      <input
                        value={newExpedition.name}
                        onChange={(e) => setNewExpedition((f) => ({ ...f, name: e.target.value }))}
                        className={inputClass(submitAttempted && errors.expedition)}
                        placeholder="e.g., Ny-Ålesund Monitoring 2026"
                      />
                      {submitAttempted && errors.expedition ? (
                        <p className={FIELD_ERROR}>
                          <AlertCircle className="w-3.5 h-3.5" /> {errors.expedition}
                        </p>
                      ) : (
                        <p className={FIELD_HELP}>This becomes the expedition's public name on the atlas.</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={FIELD_LABEL}>Region</label>
                        <select
                          value={newExpedition.region}
                          onChange={(e) => setNewExpedition((f) => ({ ...f, region: e.target.value }))}
                          className={inputClass(false)}
                        >
                          {REGION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div />
                    </div>

                    {/* Voyage/cruise fields (NPDC parity) — optional and
                        collapsed by default, so a land expedition (e.g.
                        Maitri/Bharati field seasons) never has to look at
                        fields that only make sense for a sea voyage. */}
                    <div className="border border-slate-700/70 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowVoyageFields((v) => !v)}
                        className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-900/40 text-sm text-slate-300 hover:text-white"
                      >
                        <span className="flex items-center gap-2">
                          <Ship className="w-4 h-4 text-slate-500" />
                          Voyage / Cruise Details <span className="text-slate-500 font-normal">(optional — for sea voyages)</span>
                        </span>
                        {showVoyageFields ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {showVoyageFields && (
                        <div className="p-3 space-y-4 border-t border-slate-700/70">
                          <p className={`${FIELD_HELP} mt-0`}>
                            Leave these blank for a land expedition — they only apply to ship voyages
                            (matches NPDC's Scientific Voyage Details and Cruise Report sections).
                          </p>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className={FIELD_LABEL}>Ship Name</label>
                              <input
                                value={newExpedition.ship_name}
                                onChange={(e) => setNewExpedition((f) => ({ ...f, ship_name: e.target.value }))}
                                className={inputClass(false)}
                                placeholder="e.g., ORV Sagar Kanya"
                              />
                            </div>
                            <div>
                              <label className={FIELD_LABEL}>Voyage Name</label>
                              <input
                                value={newExpedition.voyage_name}
                                onChange={(e) => setNewExpedition((f) => ({ ...f, voyage_name: e.target.value }))}
                                className={inputClass(false)}
                                placeholder="e.g., ISOE-14"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className={FIELD_LABEL}>Cruise Name</label>
                              <input
                                value={newExpedition.cruise_name}
                                onChange={(e) => setNewExpedition((f) => ({ ...f, cruise_name: e.target.value }))}
                                className={inputClass(false)}
                                placeholder="e.g., Indian Southern Ocean Expedition (ISOE)"
                              />
                            </div>
                            <div>
                              <label className={FIELD_LABEL}>Cruise / Expedition Number</label>
                              <input
                                value={newExpedition.cruise_number}
                                onChange={(e) => setNewExpedition((f) => ({ ...f, cruise_number: e.target.value }))}
                                className={inputClass(false)}
                                placeholder="e.g., SK-367"
                              />
                            </div>
                          </div>
                          <div>
                            <label className={FIELD_LABEL}>Route / Area</label>
                            <input
                              value={newExpedition.route_area}
                              onChange={(e) => setNewExpedition((f) => ({ ...f, route_area: e.target.value }))}
                              className={inputClass(false)}
                              placeholder="e.g., Arabian Sea, west coast of India"
                            />
                          </div>
                          <div>
                            <label className={FIELD_LABEL}>Stations Visited</label>
                            <input
                              value={newExpedition.stations_visited}
                              onChange={(e) => setNewExpedition((f) => ({ ...f, stations_visited: e.target.value }))}
                              className={inputClass(false)}
                              placeholder="comma-separated, e.g. Maitri, Bharati"
                            />
                          </div>
                          <p className={FIELD_HELP}>
                            Departure and return dates use the Start Date / End Date fields below —
                            no separate voyage dates needed.
                          </p>
                        </div>
                      )}
                    </div>


                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={FIELD_LABEL}>Start Date</label>
                        <input
                          type="date"
                          value={newExpedition.start_date}
                          onChange={(e) => setNewExpedition((f) => ({ ...f, start_date: e.target.value }))}
                          className={inputClass(false)}
                        />
                      </div>
                      <div>
                        <label className={FIELD_LABEL}>End Date</label>
                        <input
                          type="date"
                          value={newExpedition.end_date}
                          onChange={(e) => setNewExpedition((f) => ({ ...f, end_date: e.target.value }))}
                          className={inputClass(false)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={FIELD_LABEL}>Latitude (optional)</label>
                        <input
                          type="number"
                          step="any"
                          value={newExpedition.latitude}
                          onChange={(e) => setNewExpedition((f) => ({ ...f, latitude: e.target.value }))}
                          className={inputClass(false)}
                          placeholder="e.g., 78.9243"
                        />
                      </div>
                      <div>
                        <label className={FIELD_LABEL}>Longitude (optional)</label>
                        <input
                          type="number"
                          step="any"
                          value={newExpedition.longitude}
                          onChange={(e) => setNewExpedition((f) => ({ ...f, longitude: e.target.value }))}
                          className={inputClass(false)}
                          placeholder="e.g., 11.9312"
                        />
                      </div>
                    </div>
                    <p className={FIELD_HELP}>
                      Coordinates place the expedition as a pin on the globe — leave blank if you're not sure yet.
                    </p>

                    <div>
                      <label className={FIELD_LABEL}>Expedition Description</label>
                      <textarea
                        value={newExpedition.description}
                        onChange={(e) => setNewExpedition((f) => ({ ...f, description: e.target.value }))}
                        rows={2}
                        className={`${inputClass(false)} resize-none`}
                        placeholder="Brief summary of the expedition itself..."
                      ></textarea>
                    </div>
                  </div>
                )}
              </div>

              {/* Content items */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300 text-xs font-bold">
                    2
                  </span>
                  <h2 className="text-lg font-semibold text-white">Content</h2>
                  <span className="px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 text-[11px] font-medium">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Add every report, photo, video, or dataset from this expedition below.
                </span>
              </div>

              {/* Saved-but-unlinked dataset metadata — NPDC's "Saved and
                  Incomplete Metadata" list, folded into this page rather
                  than a separate dashboard. Informational only; use a
                  dataset item's "Attach file to existing record" picker
                  above to actually attach a file to one of these. */}
              {unlinkedStatus === 'ready' && myUnlinkedMetadata.length > 0 && (
                <div className="mb-6 rounded-xl border border-amber-700/40 bg-amber-950/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ClipboardList className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-amber-200">
                      Your saved metadata awaiting a file ({myUnlinkedMetadata.length})
                    </h3>
                  </div>
                  <ul className="space-y-1.5">
                    {myUnlinkedMetadata.map((m) => (
                      <li key={m.id} className="text-xs text-amber-100/80 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 shrink-0" />
                        <span className="truncate">{m.title}</span>
                        <span className="text-amber-100/40">· {m.status}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-xs text-amber-100/60">
                    Add a Dataset item below, switch it to "Add file to existing record," and pick
                    one of these once the actual data is ready.
                  </p>
                </div>
              )}

              {items.map((item, idx) => {
                const meta = TYPE_META[item.type] || TYPE_META.dataset;
                const TypeIcon = meta.icon;
                const isCollapsed = collapsedKeys.has(item.key);
                const itemErrors = submitAttempted ? errors.items[item.key] : undefined;
                const isComplete =
                  item.title.trim() &&
                  (item.type === 'dataset'
                    ? item.metadataMode === 'existing'
                      ? Boolean(item.existingMetadataId) && Boolean(item.file)
                      : true // metadata-only is a complete, valid submission
                    : Boolean(item.file));

                return (
                  <div key={item.key} className="mb-5 rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
                    {/* Card header — always visible, doubles as collapse toggle */}
                    <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/90">
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(item.key)}
                        className="flex items-center gap-2.5 min-w-0 text-left"
                      >
                        <TypeIcon className={`w-4 h-4 shrink-0 ${meta.accent}`} />
                        <span className="text-sm font-semibold text-white shrink-0">{itemLabels[idx]}</span>
                        {item.title.trim() && (
                          <span className="text-sm text-slate-400 truncate">— {item.title}</span>
                        )}
                        {itemErrors ? (
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : isComplete ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : null}
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.key)}
                            className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(item.key)}
                          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
                          aria-label={isCollapsed ? 'Expand item' : 'Collapse item'}
                        >
                          {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="p-5 pt-4">
                        {/* Type selector */}
                        <div className="mb-4">
                          <label className={FIELD_LABEL}>Content Type</label>
                          <select
                            value={item.type}
                            onChange={(e) => handleItemTypeChange(item.key, e.target.value)}
                            className={inputClass(false)}
                          >
                            {TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Title */}
                        <div className="mb-4">
                          <label className={FIELD_LABEL}>Title</label>
                          <input
                            value={item.title}
                            onChange={(e) => updateItem(item.key, { title: e.target.value })}
                            className={inputClass(itemErrors?.title)}
                            placeholder="e.g., Arctic Ice Core Data"
                          />
                          {itemErrors?.title ? (
                            <p className={FIELD_ERROR}>
                              <AlertCircle className="w-3.5 h-3.5" /> {itemErrors.title}
                            </p>
                          ) : (
                            <p className={FIELD_HELP}>Use a short, searchable title.</p>
                          )}
                        </div>

                        {/* Description */}
                        <div className="mb-4">
                          <label className={FIELD_LABEL}>Description</label>
                          <textarea
                            value={item.description}
                            onChange={(e) => updateItem(item.key, { description: e.target.value })}
                            rows={2}
                            className={`${inputClass(false)} resize-none`}
                            placeholder="Brief description of this item..."
                          ></textarea>
                        </div>

                        {/* Full article body — reports & publications only. AI can
                            summarize this into its own Summary field below. */}
                        {ARTICLE_TYPES.includes(item.type) && (
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="block text-sm text-slate-300">Full Article</label>
                              <button
                                type="button"
                                onClick={() => handleGenerateSummary(item.key, item)}
                                disabled={item.aiStatus === 'generating'}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-900/40 border border-cyan-700 hover:border-cyan-400 disabled:opacity-50 text-xs text-cyan-300 hover:text-cyan-200 transition-colors"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                {item.aiStatus === 'generating' ? 'Summarizing…' : 'Generate AI Summary'}
                              </button>
                            </div>
                            <RichTextEditor
                              value={item.body}
                              onChange={(html) => updateItem(item.key, { body: html })}
                              placeholder="Write the full research article here…"
                            />
                            {item.aiStatus === 'error' && (
                              <p className="mt-2 text-xs text-red-400">Couldn't generate a summary. Try again, or write one by hand.</p>
                            )}

                            {(item.summary || item.aiStatus === 'generating') && (
                              <div className="mt-3">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                                  <label className="block text-sm text-slate-300">AI Summary</label>
                                </div>
                                <textarea
                                  value={item.summary}
                                  onChange={(e) => updateItem(item.key, { summary: e.target.value })}
                                  rows={3}
                                  placeholder={item.aiStatus === 'generating' ? 'Generating…' : ''}
                                  disabled={item.aiStatus === 'generating'}
                                  className={`${inputClass(false)} border-cyan-800/70 resize-none disabled:opacity-50`}
                                ></textarea>
                                <p className={FIELD_HELP}>
                                  AI-generated from the article above — edit freely before submitting.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Generic file picker - non-dataset types */}
                        {item.type !== 'dataset' && (
                          <div className="mb-2">
                            <label className={FIELD_LABEL}>File</label>
                            <FileDropZone
                              key={`${item.key}-${item.type}`}
                              accept={item.type === 'photo' ? 'image/*' : item.type === 'video' ? 'video/*' : undefined}
                              file={item.file}
                              onFileChange={(f) => handleGenericFileChange(item.key, f)}
                              previewKind={item.type === 'photo' ? 'image' : item.type === 'video' ? 'video' : 'none'}
                              helperText={
                                item.type === 'photo'
                                  ? 'PNG, JPG, or similar image files'
                                  : item.type === 'video'
                                    ? 'MP4 or similar video files'
                                    : 'PDF, DOCX, or similar document files'
                              }
                              hasError={itemErrors?.file}
                            />
                          </div>
                        )}

                        {/* Scientific Metadata (NPDC parity, metadata-first) --
                            A researcher can either create a new metadata
                            record now (file optional — it can be attached
                            later) or attach today's file to a metadata
                            record they already submitted. */}
                        {item.type === 'dataset' && (
                          <div className="mb-5 pb-5 border-b border-slate-700/70">
                            <div className="flex items-center gap-2 mb-1">
                              <ClipboardList className="w-4 h-4 text-cyan-400" />
                              <label className="block text-sm font-medium text-slate-200">
                                Scientific Metadata
                              </label>
                            </div>
                            <p className={`${FIELD_HELP} mt-0 mb-3`}>
                              Describes the dataset itself — where and when it was collected, by
                              whom, and how. This can be submitted without a file: attach the
                              actual data now, or come back and attach it later.
                            </p>

                            {myMetadataRecords.length > 0 && (
                              <div className="mb-4">
                                <div className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-900/60">
                                  <button
                                    type="button"
                                    onClick={() => handleMetadataModeChange(item.key, 'new')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                      item.metadataMode === 'new'
                                        ? 'bg-cyan-600 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    New metadata record
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMetadataModeChange(item.key, 'existing')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                      item.metadataMode === 'existing'
                                        ? 'bg-cyan-600 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    Add file to existing record
                                  </button>
                                </div>
                              </div>
                            )}

                            {item.metadataMode === 'existing' ? (
                              <div>
                                <label className={FIELD_LABEL}>Metadata record</label>
                                <select
                                  value={item.existingMetadataId}
                                  onChange={(e) => updateItem(item.key, { existingMetadataId: e.target.value })}
                                  className={inputClass(submitAttempted && itemErrors?.file && !item.existingMetadataId)}
                                >
                                  <option value="">Select a saved metadata record…</option>
                                  {myMetadataRecords.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.title}
                                      {m.region ? ` — ${REGION_OPTIONS.find((r) => r.value === m.region)?.label || m.region}` : ''}
                                      {' '}({m.files?.length || 0} file{m.files?.length === 1 ? '' : 's'} so far)
                                    </option>
                                  ))}
                                </select>
                                <p className={FIELD_HELP}>
                                  Its title, region, and other scientific fields are already saved —
                                  you're just adding a file to it. A record can hold several files
                                  (raw, processed, documentation…), so records that already have one
                                  are still listed here.
                                </p>
                                <div className="mt-3">
                                  <label className={FIELD_LABEL}>Role of this file</label>
                                  <select
                                    value={item.fileRole}
                                    onChange={(e) => updateItem(item.key, { fileRole: e.target.value })}
                                    className={inputClass(false)}
                                  >
                                    {FILE_ROLE_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Principal Investigator</label>
                                    <select
                                      value={item.sciMeta.principal_investigator}
                                      onChange={(e) => updateSciMeta(item.key, { principal_investigator: e.target.value })}
                                      className={inputClass(false)}
                                    >
                                      <option value="">{user?.name ? `${user.name} (you)` : 'You'}</option>
                                      {selectedExpeditionPI && selectedExpeditionPI.id !== user?.id && (
                                        <option value={selectedExpeditionPI.id}>
                                          {selectedExpeditionPI.name} (expedition PI)
                                        </option>
                                      )}
                                    </select>
                                    <p className={FIELD_HELP}>
                                      Who this dataset is credited to — defaults to you.
                                    </p>
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Region</label>
                                    <select
                                      value={item.sciMeta.region}
                                      onChange={(e) => updateSciMeta(item.key, { region: e.target.value })}
                                      className={inputClass(false)}
                                    >
                                      {REGION_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Institution</label>
                                    <input
                                      value={item.sciMeta.institution}
                                      onChange={(e) => updateSciMeta(item.key, { institution: e.target.value })}
                                      className={inputClass(false)}
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Scientific Discipline</label>
                                    <select
                                      value={item.sciMeta.discipline}
                                      onChange={(e) => updateSciMeta(item.key, { discipline: e.target.value })}
                                      className={inputClass(false)}
                                    >
                                      {DISCIPLINE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div>
                                  <label className={FIELD_LABEL}>Exact Location</label>
                                  <input
                                    value={item.sciMeta.exact_location}
                                    onChange={(e) => updateSciMeta(item.key, { exact_location: e.target.value })}
                                    className={inputClass(false)}
                                    placeholder="e.g., Maitri, Schirmacher Oasis"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Latitude</label>
                                    <input
                                      type="number"
                                      step="any"
                                      value={item.sciMeta.latitude}
                                      onChange={(e) => updateSciMeta(item.key, { latitude: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="e.g., -70.7500"
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Longitude</label>
                                    <input
                                      type="number"
                                      step="any"
                                      value={item.sciMeta.longitude}
                                      onChange={(e) => updateSciMeta(item.key, { longitude: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="e.g., 11.7500"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Observation Start</label>
                                    <input
                                      type="date"
                                      value={item.sciMeta.observation_start}
                                      onChange={(e) => updateSciMeta(item.key, { observation_start: e.target.value })}
                                      className={inputClass(false)}
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Observation End</label>
                                    <input
                                      type="date"
                                      value={item.sciMeta.observation_end}
                                      onChange={(e) => updateSciMeta(item.key, { observation_end: e.target.value })}
                                      className={inputClass(false)}
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Scientific Keywords</label>
                                    <input
                                      value={item.sciMeta.keywords}
                                      onChange={(e) => updateSciMeta(item.key, { keywords: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="comma-separated, e.g. CTD, salinity"
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Measured Parameters</label>
                                    <input
                                      value={item.sciMeta.parameters}
                                      onChange={(e) => updateSciMeta(item.key, { parameters: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="comma-separated, e.g. temperature, depth"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Instrument / Method</label>
                                    <input
                                      value={item.sciMeta.instrument_method}
                                      onChange={(e) => updateSciMeta(item.key, { instrument_method: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="e.g., Sea-Bird SBE 911plus CTD"
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>Processing Level</label>
                                    <select
                                      value={item.sciMeta.processing_level}
                                      onChange={(e) => updateSciMeta(item.key, { processing_level: e.target.value })}
                                      className={inputClass(false)}
                                    >
                                      {PROCESSING_LEVEL_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={FIELD_LABEL}>Units</label>
                                    <input
                                      value={item.sciMeta.units}
                                      onChange={(e) => updateSciMeta(item.key, { units: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="e.g., temperature: °C, depth: m"
                                    />
                                  </div>
                                  <div>
                                    <label className={FIELD_LABEL}>File Format</label>
                                    <input
                                      value={item.sciMeta.file_format}
                                      onChange={(e) => updateSciMeta(item.key, { file_format: e.target.value })}
                                      className={inputClass(false)}
                                      placeholder="auto-filled from file if left blank"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className={FIELD_LABEL}>Access Conditions</label>
                                  <input
                                    value={item.sciMeta.access_conditions}
                                    onChange={(e) => updateSciMeta(item.key, { access_conditions: e.target.value })}
                                    className={inputClass(false)}
                                    placeholder="e.g., Open access, or Request required"
                                  />
                                </div>

                                <div>
                                  <label className={FIELD_LABEL}>Source / Citation</label>
                                  <textarea
                                    value={item.sciMeta.citation}
                                    onChange={(e) => updateSciMeta(item.key, { citation: e.target.value })}
                                    rows={2}
                                    className={`${inputClass(false)} resize-none`}
                                    placeholder="How this dataset should be cited…"
                                  ></textarea>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Dataset-specific: CSV/Excel picker */}
                        {item.type === 'dataset' && (
                          <div className="mb-4">
                            <label className={FIELD_LABEL}>
                              Dataset File
                              {item.metadataMode === 'new' && (
                                <span className="text-slate-500 font-normal"> (optional — attach now, or later once the file is ready)</span>
                              )}
                            </label>
                            <FileDropZone
                              key={`${item.key}-${item.type}`}
                              accept={DATASET_ACCEPT}
                              file={item.file}
                              onFileChange={(f) => handleDatasetFileChange(item.key, f)}
                              previewKind="none"
                              helperText="CSV, TSV, XLS/XLSX, JSON, NetCDF v3/v4, HDF5, GRIB, or ZIP scientific datasets"
                              hasError={item.parseStatus !== 'error' ? itemErrors?.file : undefined}
                            />
                            {item.metadataMode === 'new' && item.file && (
                              <div className="mt-3">
                                <label className={FIELD_LABEL}>Role of this file</label>
                                <select
                                  value={item.fileRole}
                                  onChange={(e) => updateItem(item.key, { fileRole: e.target.value })}
                                  className={inputClass(false)}
                                >
                                  {FILE_ROLE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                                <p className={FIELD_HELP}>
                                  Usually "Raw / Actual data" for a first file — you can add the
                                  processed version, documentation, or a calibration file later from
                                  the same metadata record.
                                </p>
                              </div>
                            )}
                            {item.parseStatus === 'parsing' && (
                              <p className="mt-2 text-sm text-slate-400">Parsing file…</p>
                            )}
                            {item.parseStatus === 'skipped' && (
                              <p className="mt-2 text-sm text-slate-400">
                                Preview skipped — this file is binary or larger than {formatBytes(DATASET_PREVIEW_MAX_BYTES)},
                                so it was not read into browser memory.
                              </p>
                            )}
                            {item.parseStatus === 'success' && (
                              <p className="mt-2 text-sm text-cyan-400 flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" />
                                Parsed {item.datasetMeta?.row_count} rows, {item.datasetMeta?.columns.length} columns
                              </p>
                            )}
                            {item.parseStatus === 'error' && (
                              <p className={FIELD_ERROR}>
                                <AlertCircle className="w-3.5 h-3.5" /> Failed to parse file.
                              </p>
                            )}
                            {item.file && item.datasetUploadRoute === 'multipart' && (
                              <div className="mt-3 rounded-lg border border-cyan-900/60 bg-cyan-950/20 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <span className="text-cyan-300">
                                    Direct multipart dataset upload · browser → MinIO
                                  </span>
                                  {item.datasetUploadProgress && (
                                    <span className="text-slate-300 tabular-nums">
                                      {item.datasetUploadProgress.percent}%
                                    </span>
                                  )}
                                </div>
                                {item.datasetUploadProgress ? (
                                  <>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                                      <div
                                        className="h-full rounded-full bg-cyan-400 transition-[width] duration-150"
                                        style={{ width: `${item.datasetUploadProgress.percent}%` }}
                                      />
                                    </div>
                                    <div className="mt-1.5 flex items-center justify-between gap-3">
                                      <p className="text-[11px] text-slate-400">
                                        {item.datasetUploadProgress.status === 'finalizing'
                                          ? 'Finalizing multipart upload…'
                                          : item.datasetUploadProgress.status === 'completed'
                                            ? 'Upload completed.'
                                            : item.datasetUploadProgress.status === 'paused'
                                              ? `Paused · ${formatBytes(item.datasetUploadProgress.uploadedBytes)} safely committed.`
                                              : item.datasetUploadProgress.status === 'waiting-network'
                                                ? `Connection unavailable · ${formatBytes(item.datasetUploadProgress.uploadedBytes)} safely committed. Resume is automatic when connectivity returns.`
                                                : item.datasetUploadProgress.status === 'resumable'
                                                  ? `${formatBytes(item.datasetUploadProgress.uploadedBytes)} already stored in MinIO. Submit to resume only the missing parts.`
                                                  : `Part ${Math.max(1, item.datasetUploadProgress.partNumber)} of ${item.datasetUploadProgress.totalParts} · ${formatBytes(item.datasetUploadProgress.uploadedBytes)} of ${formatBytes(item.datasetUploadProgress.totalBytes)}`}
                                      </p>

                                      {(item.datasetUploadProgress.status === 'uploading' || item.datasetUploadProgress.status === 'waiting-network') && multipartControlsRef.current.has(item.key) && (
                                        <button
                                          type="button"
                                          onClick={() => pauseMultipartUpload(item.key)}
                                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-500/60 hover:text-cyan-200"
                                        >
                                          <Pause className="h-3 w-3" /> Pause
                                        </button>
                                      )}
                                      {item.datasetUploadProgress.status === 'paused' && multipartControlsRef.current.has(item.key) && (
                                        <button
                                          type="button"
                                          onClick={() => resumeMultipartUpload(item.key)}
                                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-600/60 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-950/40"
                                        >
                                          <Play className="h-3 w-3" /> Resume
                                        </button>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    This file bypasses Node/Multer/Cloudinary and uploads in exact 5 MiB-or-larger parts when you submit.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Dataset-specific: Manual Table Builder */}
                        {item.type === 'dataset' && (
                          <div className="mb-4 pt-4 border-t border-slate-700/70">
                            <label className={FIELD_LABEL}>Manual Table Builder</label>
                            <p className={`${FIELD_HELP} mt-0 mb-3`}>
                              Build a table manually if you don't have a file. Each column gets
                              an inferred type (number/date/text) based on the values entered.
                            </p>

                            <div className="flex gap-2 mb-3">
                              <button type="button" onClick={() => addManualColumn(item.key)} className={SECONDARY_BTN}>
                                + Column
                              </button>
                              <button
                                type="button"
                                onClick={() => removeManualColumn(item.key)}
                                disabled={item.manualTable.columns.length <= 1}
                                className={SECONDARY_BTN}
                              >
                                - Column
                              </button>
                              <button type="button" onClick={() => addManualRow(item.key)} className={SECONDARY_BTN}>
                                + Row
                              </button>
                              <button
                                type="button"
                                onClick={() => removeManualRow(item.key)}
                                disabled={item.manualTable.rows.length === 0}
                                className={SECONDARY_BTN}
                              >
                                - Row
                              </button>
                            </div>

                            {item.manualTable.columns.length > 0 && item.manualTable.rows.length > 0 && (
                              <div className="rounded-lg border border-slate-700/70 overflow-hidden mb-3">
                                <div className="max-h-[280px] overflow-y-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-slate-900/70 sticky top-0">
                                      <tr>
                                        {item.manualTable.columns.map((name, i) => (
                                          <th
                                            key={i}
                                            className="p-2.5 text-left font-semibold tracking-wider uppercase text-[10px] text-slate-400 border-b border-slate-700"
                                          >
                                            {name}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                      {item.manualTable.rows.map((row, rIdx) => (
                                        <tr key={rIdx} className="even:bg-slate-800/40">
                                          {row.map((cell, cIdx) => (
                                            <td key={cIdx} className="p-1.5">
                                              <input
                                                type="text"
                                                value={cell}
                                                onChange={(e) => setManualCell(item.key, rIdx, cIdx, e.target.value)}
                                                className="w-full bg-transparent text-slate-200 text-xs px-1.5 py-1 rounded focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                              />
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => parseManualForItem(item.key, item)}
                                disabled={item.manualTable.columns.length === 0}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium transition-colors"
                              >
                                Parse Table &amp; Preview
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Dataset preview */}
                        {item.type === 'dataset' && item.datasetMeta && (
                          <DatasetPreviewCard
                            columns={item.datasetMeta.columns}
                            previewRows={item.datasetMeta.preview_rows}
                            rowCount={item.datasetMeta.row_count}
                          />
                        )}

                        {/* 3D depth section — only rendered when a depth
                            column plus temperature and/or salinity were
                            detected in the uploaded/typed data. */}
                        {item.type === 'dataset' && item.oceanSection && (
                          <>
                            <OceanSection3D section={item.oceanSection} />
                            <TempSalinityDepth3D section={item.oceanSection} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addItem}
                className="w-full mb-8 py-2.5 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:border-cyan-400 hover:text-cyan-400 transition-colors inline-flex items-center justify-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" /> Add Another Item
              </button>

              {/* Submit button — the one action on this page that should read
                  as clearly primary; everything else uses a lighter weight. */}
              <button
                type="submit"
                disabled={!isAuthenticated || submitting}
                className="w-full py-3.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold shadow-lg shadow-cyan-950/40 transition-colors"
              >
                {submitting ? 'Submitting…' : 'Submit Expedition Content'}
              </button>

              {hasBlockingErrors && submitAttempted && !submitting && (
                <p className={`${FIELD_ERROR} justify-center mt-3`}>
                  <AlertCircle className="w-3.5 h-3.5" /> Some fields still need your attention above.
                </p>
              )}
              {submitting && (
                <p className="mt-3 text-sm text-slate-400 text-center">Processing your upload…</p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadPage;
