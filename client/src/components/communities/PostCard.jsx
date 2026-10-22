import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, MessageSquare, Newspaper, Share2, Trash2, Ellipsis, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext.jsx';
import { votePost, deletePost } from '../../api/communities.js';
import CommunityIcon from './CommunityIcon.jsx';
import VoteButtons from './VoteButtons.jsx';
import MediaGallery from './MediaGallery.jsx';
import TagChip from './TagChip.jsx';
import Avatar from './Avatar.jsx';
import { formatCount, timeAgo } from './utils.js';

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function sharePost(post) {
  const url = `${window.location.origin}/communities/post/${post.id}`;
  navigator.clipboard?.writeText(url).then(() => toast.success('Link copied')).catch(() => toast(url));
}

// A post in a feed (Home / Popular / News / c/ / u/ / search).
export default function PostCard({ post, onDeleted, hideCommunity = false, canModerate = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isNews = post.postType === 'news';
  const canDelete = user && (user.id === post.creator?.id || canModerate || ['admin', 'comms_officer'].includes(user.role));
  const open = () => navigate(`/communities/post/${post.id}`);

  async function remove(e) {
    e.stopPropagation();
    setMenuOpen(false);
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      await deletePost(post.id);
      toast.success('Post deleted');
      onDeleted?.(post.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete post');
    }
  }

  return (
    <article onClick={open} className="cursor-pointer rounded-2xl border border-transparent px-3 py-3 transition hover:border-white/5 hover:bg-white/[0.035] md:px-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {isNews ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ffb000] text-[#1a1a1b]"><Newspaper className="h-3.5 w-3.5" /></span> News</span>
        ) : !hideCommunity && post.circle ? (
          <Link to={`/communities/c/${post.circle.slug}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:underline">
            <CommunityIcon community={post.circle} size={24} /> c/{post.circle.slug}
          </Link>
        ) : (
          <Link to={`/communities/u/${post.creator?.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:underline">
            <Avatar user={post.creator} size={24} /> u/{post.creator?.name}
          </Link>
        )}
        <span>•</span>
        <span>{timeAgo(post.createdAt)}</span>
        {(isNews || (!hideCommunity && post.circle)) && post.creator && (
          <>
            <span className="hidden sm:inline">•</span>
            <Link to={`/communities/u/${post.creator.id}`} onClick={(e) => e.stopPropagation()} className="hidden truncate hover:underline sm:inline">u/{post.creator.name}</Link>
          </>
        )}
        {post.verified && <span title="Reviewed by NCPOR staff" className="text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /></span>}

        {canDelete && (
          <div className="relative ml-auto" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setMenuOpen((o) => !o)} className="rounded-full p-1 hover:bg-white/10" aria-label="Post options"><Ellipsis className="h-4 w-4" /></button>
            {menuOpen && (
              <>
                <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-40 mt-1 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#11262f] py-1 shadow-2xl">
                  <button type="button" onClick={remove} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-white/5"><Trash2 className="h-4 w-4" /> Delete</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <h3 className="mt-2 text-lg font-semibold leading-snug text-slate-100">{post.title}</h3>
      {post.tags?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{post.tags.map((t) => <TagChip key={t} tag={t} />)}</div>}

      {post.linkUrl && (
        <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-cyan-300 hover:bg-white/[0.06]">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{hostname(post.linkUrl)}</span>
        </a>
      )}

      {post.body && !post.media?.length && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-400">{post.body}</p>}
      <MediaGallery media={post.media} compact />
      {post.expedition && (
        <Link to={`/expeditions/${post.expedition.id}`} onClick={(e) => e.stopPropagation()} className="mt-2 inline-block text-xs text-cyan-300 hover:underline">Expedition: {post.expedition.name}</Link>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VoteButtons score={post.score} myVote={post.myVote} onVote={(v) => votePost(post.id, v)} />
        <button type="button" onClick={(e) => { e.stopPropagation(); open(); }} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
          <MessageSquare className="h-4 w-4" /> {formatCount(post.commentCount)}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); sharePost(post); }} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
          <Share2 className="h-4 w-4" /> Share
        </button>
      </div>
    </article>
  );
}
