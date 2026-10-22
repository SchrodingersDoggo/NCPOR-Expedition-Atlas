import React, { useCallback, useEffect, useState } from 'react';
import { fetchReviewQueue, setContentStatus } from '../api/content.js';
import { fetchMetadataQueue, reviewDatasetMetadata } from '../api/datasetMetadata.js';
import { CheckCircle, XCircle, Clock, FlaskConical, MessageSquareWarning, PlayCircle, Archive, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import DatasetDownloadButton from '../components/DatasetDownloadButton.jsx';

const TYPE_LABEL = {
  report: 'Report',
  publication: 'Publication',
  photo: 'Photo',
  video: 'Video',
  dataset: 'Dataset',
};

function ReviewCard({ item, onDecide, busy }) {
  return (
    <div className="brass-plate rounded-lg p-5 mb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-block px-2 py-0.5 mb-2 rounded text-xs font-medium bg-cyan-900/50 text-cyan-300 border border-cyan-800">
            {TYPE_LABEL[item.type] || item.type}
          </span>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--ice)' }}>{item.title}</h3>
          {item.description && (
            <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--ice-dim)' }}>{item.description}</p>
          )}
          <div className="text-xs mt-2 flex gap-4" style={{ color: 'var(--ice-dim)', opacity: 0.8 }}>
            <span>Expedition: {item.expedition?.name || 'Unattached'}</span>
            <span>Uploaded by: {item.uploader?.name || 'Unknown'}</span>
            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(item.id, 'published')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" /> Publish
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(item.id, 'archived')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#f87171';
              e.currentTarget.style.color = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--brass-dim)';
              e.currentTarget.style.color = 'var(--ice-dim)';
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border disabled:opacity-50 text-sm font-medium transition-colors"
            style={{ background: 'rgba(7,22,32,0.5)', borderColor: 'var(--brass-dim)', color: 'var(--ice-dim)' }}
          >
            <XCircle className="w-4 h-4" /> Reject
          </button>
        </div>
      </div>

      {item.type === 'dataset' ? (
        <DatasetDownloadButton
          itemId={item.id}
          label="View file"
          showIcon={false}
          className="inline-block mt-3 text-xs hover:underline disabled:opacity-60"
          style={{ color: 'var(--brass-bright)' }}
        />
      ) : item.fileUrl && (
        <a
          href={item.fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-3 text-xs hover:underline"
          style={{ color: 'var(--brass-bright)' }}
        >
          View file
        </a>
      )}
    </div>
  );
}

const METADATA_STATUS_STYLE = {
  submitted: 'bg-cyan-900/40 text-cyan-300 border-cyan-800',
  under_review: 'bg-amber-900/40 text-amber-300 border-amber-700',
  changes_requested: 'bg-red-900/40 text-red-300 border-red-700',
  approved: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  published: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
};

function MetadataReviewCard({ record, onAction, busy }) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');

  const submitRequestChanges = () => {
    if (!comment.trim()) return; // button below is also disabled on empty, this is just a safety net
    onAction(record.id, 'request_changes', comment.trim());
    setCommentOpen(false);
    setComment('');
  };

  // The most recent reviewer comment, if this record has ever had one —
  // shown so staff don't have to open the full history to see what was
  // already said last time (e.g. before it comes back around after a
  // researcher's resubmit).
  const lastComment = [...(record.reviewHistory || [])].reverse().find((h) => h.comment);

  return (
    <div className="brass-plate rounded-lg p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-cyan-900/50 text-cyan-300 border border-cyan-800">
              Dataset
            </span>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${METADATA_STATUS_STYLE[record.status] || ''}`}>
              {record.status.replace('_', ' ')}
            </span>
          </div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--ice)' }}>{record.title}</h3>
          {record.description && (
            <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--ice-dim)' }}>{record.description}</p>
          )}
          <div className="text-xs mt-2 flex gap-4 flex-wrap" style={{ color: 'var(--ice-dim)', opacity: 0.8 }}>
            <span>PI: {record.pi?.name || 'Not set'}</span>
            <span>Submitted by: {record.creator?.name || 'Unknown'}</span>
            <span>Region: {record.region || 'Not recorded'}</span>
            <span>Files: {record.files?.length || 0}</span>
          </div>
          {lastComment && (
            <div className="mt-3 flex items-start gap-1.5 text-xs max-w-xl" style={{ color: 'var(--ice-dim)' }}>
              <MessageSquareWarning className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--brass-bright)' }} />
              <span><span style={{ color: 'var(--brass-bright)' }}>{lastComment.reviewer?.name || 'A reviewer'}:</span> "{lastComment.comment}"</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {record.status === 'submitted' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(record.id, 'start_review')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--brass)' }}
            >
              <PlayCircle className="w-4 h-4" /> Start review
            </button>
          )}

          {record.status === 'under_review' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(record.id, 'approve')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CheckCircle className="w-4 h-4" /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCommentOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border disabled:opacity-50 text-sm font-medium transition-colors"
                style={{ background: 'rgba(7,22,32,0.5)', borderColor: 'rgba(248,113,113,0.4)', color: '#fca5a5' }}
              >
                <MessageSquareWarning className="w-4 h-4" /> Request changes
              </button>
            </>
          )}

          {record.status === 'approved' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(record.id, 'publish')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CheckCircle className="w-4 h-4" /> Publish
            </button>
          )}

          {record.status === 'published' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(record.id, 'archive')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border disabled:opacity-50 text-sm font-medium transition-colors"
              style={{ background: 'rgba(7,22,32,0.5)', borderColor: 'var(--brass-dim)', color: 'var(--ice-dim)' }}
            >
              <Archive className="w-4 h-4" /> Archive
            </button>
          )}

          {record.status === 'changes_requested' && (
            <span className="text-xs italic" style={{ color: 'var(--ice-dim)' }}>Waiting for the researcher to resubmit</span>
          )}
        </div>
      </div>

      {commentOpen && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--brass-dim)' }}>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--ice-dim)' }}>
            What needs to change? <span style={{ color: '#fca5a5' }}>(required &mdash; the researcher will see this)</span>
          </label>
          <div className="flex gap-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="flex-1 px-3 py-2 rounded text-sm text-white resize-none focus:outline-none"
              style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
              placeholder="e.g., Observation dates are missing -- please add them and resubmit."
            />
            <button
              type="button"
              disabled={busy || !comment.trim()}
              onClick={submitRequestChanges}
              className="px-4 rounded text-sm font-medium text-white disabled:opacity-40 transition-colors shrink-0"
              style={{ background: '#b3413a' }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewQueuePage() {
  const [activeTab, setActiveTab] = useState('content'); // 'content' | 'metadata'

  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [busyId, setBusyId] = useState(null);

  const [metadataItems, setMetadataItems] = useState([]);
  const [metadataStatus, setMetadataStatus] = useState('loading');
  const [metadataBusyId, setMetadataBusyId] = useState(null);

  const load = useCallback(() => {
    setStatus('loading');
    fetchReviewQueue()
      .then((data) => {
        setItems(data);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load review queue', err);
        setStatus('error');
      });
  }, []);

  const loadMetadata = useCallback(() => {
    setMetadataStatus('loading');
    fetchMetadataQueue()
      .then((data) => {
        setMetadataItems(data);
        setMetadataStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load metadata review queue', err);
        setMetadataStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
    loadMetadata();
  }, [load, loadMetadata]);

  const handleDecide = async (id, nextStatus) => {
    setBusyId(id);
    try {
      await setContentStatus(id, nextStatus);
      // Item is no longer in_review either way -- drop it from the queue
      // instead of refetching the whole list.
      setItems((list) => list.filter((it) => it.id !== id));
    } catch (err) {
      console.error('Failed to update content status', err);
      toast.error('Could not update that item. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMetadataAction = async (id, action, comment) => {
    setMetadataBusyId(id);
    try {
      const updated = await reviewDatasetMetadata(id, action, comment);
      // 'archive' is the only action here that leaves the queue's default
      // status set entirely (submitted/under_review/changes_requested/
      // approved/published) -- every other action just moves the record to
      // a different status that's still in that set, so update it in
      // place rather than dropping it, and the card re-renders with its
      // new action buttons.
      if (action === 'archive') {
        setMetadataItems((list) => list.filter((it) => it.id !== id));
      } else {
        setMetadataItems((list) => list.map((it) => (it.id === id ? updated : it)));
      }
      const toastMessage = {
        start_review: 'Review started.',
        request_changes: 'Changes requested -- the researcher can now see your comment.',
        approve: 'Approved.',
        publish: 'Published.',
        archive: 'Archived.',
      }[action];
      if (toastMessage) toast.success(toastMessage);
    } catch (err) {
      console.error('Failed to update metadata status', err);
      toast.error(err.response?.data?.error || 'Could not update that record. Please try again.');
    } finally {
      setMetadataBusyId(null);
    }
  };

  return (
    <div className="chart-backdrop min-h-screen px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--brass-bright)' }}>
          <Clock className="w-4 h-4" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">STAFF REVIEW</span>
        </div>
        <h1 className="text-2xl italic mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Review Queue
        </h1>
        <p className="mb-6" style={{ color: 'var(--ice-dim)' }}>
          Content and scientific metadata submitted by researchers wait here until they're published or sent back.
        </p>

        <div className="flex gap-1 mb-7 p-1 rounded-lg w-fit" style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('content')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={activeTab === 'content' ? { background: 'var(--brass)', color: '#071620' } : { color: 'var(--ice-dim)' }}
          >
            Content {status === 'ready' && items.length > 0 && `(${items.length})`}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('metadata')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={activeTab === 'metadata' ? { background: 'var(--brass)', color: '#071620' } : { color: 'var(--ice-dim)' }}
          >
            <FlaskConical className="w-3.5 h-3.5" /> Scientific Metadata {metadataStatus === 'ready' && metadataItems.length > 0 && `(${metadataItems.length})`}
          </button>
        </div>

        {activeTab === 'content' && (
          <>
            {status === 'loading' && <p style={{ color: 'var(--ice-dim)' }}>Loading&hellip;</p>}
            {status === 'error' && (
              <p className="text-red-400">Couldn't load the review queue. Try refreshing.</p>
            )}
            {status === 'ready' && items.length === 0 && (
              <p style={{ color: 'var(--ice-dim)' }}>Nothing waiting on review right now.</p>
            )}
            {status === 'ready' &&
              items.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onDecide={handleDecide}
                />
              ))}
          </>
        )}

        {activeTab === 'metadata' && (
          <>
            {metadataStatus === 'loading' && <p style={{ color: 'var(--ice-dim)' }}>Loading&hellip;</p>}
            {metadataStatus === 'error' && (
              <p className="text-red-400">Couldn't load the metadata review queue. Try refreshing.</p>
            )}
            {metadataStatus === 'ready' && metadataItems.length === 0 && (
              <p style={{ color: 'var(--ice-dim)' }}>No scientific metadata waiting on review right now.</p>
            )}
            {metadataStatus === 'ready' &&
              metadataItems.map((record) => (
                <MetadataReviewCard
                  key={record.id}
                  record={record}
                  busy={metadataBusyId === record.id}
                  onAction={handleMetadataAction}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

export default ReviewQueuePage;
