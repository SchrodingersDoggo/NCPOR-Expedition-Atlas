import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, MessageSquare, Newspaper, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { addComment, deleteComment, deletePost, fetchPost, voteComment, votePost } from '../../api/communities.js';
import VoteButtons from '../../components/communities/VoteButtons.jsx';
import MediaGallery from '../../components/communities/MediaGallery.jsx';
import TagChip from '../../components/communities/TagChip.jsx';
import Avatar from '../../components/communities/Avatar.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import { sharePost } from '../../components/communities/PostCard.jsx';
import { formatCount, pushRecentCommunity, timeAgo } from '../../components/communities/utils.js';

function CommentComposer({ onSubmit, placeholder = 'Join the conversation', autoFocus, onCancel, disabled }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(Boolean(autoFocus));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(text.trim()); setText(''); setFocused(false); onCancel?.(); } finally { setBusy(false); }
  }

  return (
    <div className={`rounded-2xl border ${focused ? 'border-cyan-300/50' : 'border-white/15'} bg-black/20`}>
      <textarea
        autoFocus={autoFocus}
        disabled={disabled}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        rows={focused ? 4 : 1}
        placeholder={disabled ? 'Comments are unavailable' : placeholder}
        className="w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
      />
      {focused && (
        <div className="flex justify-end gap-2 px-3 pb-3">
          <button type="button" onClick={() => { setText(''); setFocused(false); onCancel?.(); }} className="rounded-full px-4 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10">Cancel</button>
          <button type="button" disabled={!text.trim() || busy} onClick={submit} className="rounded-full bg-cyan-300 px-4 py-1.5 text-xs font-bold text-[#06202a] disabled:opacity-40">{busy ? 'Posting…' : 'Comment'}</button>
        </div>
      )}
    </div>
  );
}

function Comment({ node, depth, ctx }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const c = node.comment;
  const canDelete = !c.deleted && user && (user.id === c.user?.id || ctx.isModerator);

  return (
    <div id={`comment-${c.id}`} className={depth ? 'ml-3 border-l border-white/10 pl-3 md:ml-5 md:pl-4' : ''}>
      <div className={`rounded-xl py-2 ${ctx.highlight === c.id ? 'bg-cyan-300/[0.07] px-2' : ''}`}>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={() => setCollapsed((v) => !v)} className="text-slate-500 hover:text-white" aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '⊕' : '⊖'}</button>
          {c.user ? (
            <Link to={`/communities/u/${c.user.id}`} className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:underline"><Avatar user={c.user} size={22} /> {c.user.name}</Link>
          ) : <span className="text-slate-500">[deleted]</span>}
          {c.user?.id === ctx.postAuthorId && <span className="rounded bg-cyan-300/15 px-1.5 text-[10px] font-bold text-cyan-200">OP</span>}
          <span className="text-slate-500">· {timeAgo(c.createdAt)}</span>
          {collapsed && <span className="text-slate-500">({node.children.length} {node.children.length === 1 ? 'reply' : 'replies'})</span>}
        </div>
        {!collapsed && (
          <>
            <p className={`mt-1.5 whitespace-pre-line text-sm leading-6 ${c.deleted ? 'italic text-slate-500' : 'text-slate-200'}`}>{c.body}</p>
            <div className="mt-1.5 flex items-center gap-1">
              {!c.deleted && <VoteButtons size="sm" score={c.score} myVote={c.myVote} onVote={(v) => voteComment(c.id, v)} />}
              {!c.deleted && ctx.canComment && (
                <button type="button" onClick={() => setReplying((r) => !r)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-slate-400 hover:bg-white/5 hover:text-white">
                  <MessageSquare className="h-3.5 w-3.5" /> Reply
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => ctx.onDelete(c.id)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-slate-500 hover:bg-white/5 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
              )}
            </div>
            {replying && (
              <div className="mt-2">
                <CommentComposer autoFocus placeholder={`Reply to ${c.user?.name || 'comment'}`} onCancel={() => setReplying(false)} onSubmit={(text) => ctx.onReply(text, c.id)} />
              </div>
            )}
          </>
        )}
      </div>
      {!collapsed && node.children.map((child) => <Comment key={child.comment.id} node={child} depth={depth + 1} ctx={ctx} />)}
    </div>
  );
}

function buildTree(comments, sort) {
  const nodes = new Map(comments.map((c) => [c.id, { comment: c, children: [] }]));
  const roots = [];
  for (const c of comments) {
    const node = nodes.get(c.id);
    if (c.parentId && nodes.has(c.parentId)) nodes.get(c.parentId).children.push(node);
    else roots.push(node);
  }
  const cmp = sort === 'new'
    ? (a, b) => new Date(b.comment.createdAt) - new Date(a.comment.createdAt)
    : sort === 'old'
      ? (a, b) => new Date(a.comment.createdAt) - new Date(b.comment.createdAt)
      : (a, b) => b.comment.score - a.comment.score || new Date(b.comment.createdAt) - new Date(a.comment.createdAt);
  const sortRec = (list) => { list.sort(cmp); list.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

export default function PostDetailPage() {
  const { id } = useParams();
  const { user, isAuthenticated } = useAuth();
  const { isOffline } = useNetwork();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('best');
  const highlight = location.hash.startsWith('#comment-') ? location.hash.slice(9) : null;

  useEffect(() => {
    setData(null);
    fetchPost(id)
      .then((d) => { setData(d); if (d.post.circle) pushRecentCommunity(d.post.circle); })
      .catch((err) => setError(err.response?.data?.error || 'Could not load this post.'));
  }, [id]);

  useEffect(() => {
    if (data && highlight) document.getElementById(`comment-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [data, highlight]);

  const tree = useMemo(() => (data ? buildTree(data.comments, sort) : []), [data, sort]);

  if (error) return <div className="py-20 text-center text-slate-400">{error}</div>;
  if (!data) return <div className="py-20 text-center text-sm text-slate-500">Loading post…</div>;

  const { post, permissions } = data;
  const isNews = post.postType === 'news';
  const canDelete = user && (user.id === post.creator?.id || permissions.isModerator);

  async function reply(text, parentId) {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: location.pathname } } }); return; }
    try {
      const comment = await addComment(post.id, text, parentId);
      setData((d) => ({ ...d, comments: [...d.comments, comment], post: { ...d.post, commentCount: d.post.commentCount + 1 } }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not post comment');
      throw err;
    }
  }

  async function removeComment(commentId) {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await deleteComment(commentId);
      setData((d) => ({ ...d, comments: d.comments.map((c) => (c.id === commentId ? { ...c, deleted: true, body: '[deleted]', user: null } : c)) }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete comment');
    }
  }

  async function removePost() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      await deletePost(post.id);
      toast.success('Post deleted');
      navigate(post.circle ? `/communities/c/${post.circle.slug}` : '/communities/news');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete post');
    }
  }

  const ctx = {
    canComment: permissions.canComment && !isOffline,
    isModerator: permissions.isModerator,
    postAuthorId: post.creator?.id,
    highlight,
    onReply: reply,
    onDelete: removeComment,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <button type="button" onClick={() => navigate(-1)} className="rounded-full bg-white/[0.06] p-2 hover:bg-white/10" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        {isNews ? (
          <Link to="/communities/news" className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:underline"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ffb000] text-[#1a1a1b]"><Newspaper className="h-4 w-4" /></span> News</Link>
        ) : post.circle && (
          <Link to={`/communities/c/${post.circle.slug}`} className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:underline"><CommunityIcon community={post.circle} size={28} /> c/{post.circle.slug}</Link>
        )}
        <span>• {timeAgo(post.createdAt)}</span>
        {post.verified && <span className="inline-flex items-center gap-1 text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Reviewed</span>}
      </div>
      <Link to={`/communities/u/${post.creator?.id}`} className="ml-11 mt-0.5 block text-xs text-slate-400 hover:underline">u/{post.creator?.name}{post.creator?.organization ? ` · ${post.creator.organization}` : ''}</Link>

      <h1 className="mt-3 text-2xl font-bold leading-snug text-white">{post.title}</h1>
      {post.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{post.tags.map((t) => <TagChip key={t} tag={t} />)}</div>}

      {post.linkUrl && (
        <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-cyan-300 hover:bg-white/[0.06]">
          <ExternalLink className="h-4 w-4 shrink-0" /> <span className="truncate">{post.linkUrl}</span>
        </a>
      )}
      <MediaGallery media={post.media} />
      {post.body && <p className="mt-4 whitespace-pre-line text-[15px] leading-7 text-slate-200">{post.body}</p>}
      {post.expedition && <Link to={`/expeditions/${post.expedition.id}`} className="mt-3 inline-block text-sm text-cyan-300 hover:underline">Linked expedition: {post.expedition.name}</Link>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <VoteButtons score={post.score} myVote={post.myVote} onVote={(v) => votePost(post.id, v)} />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-slate-200"><MessageSquare className="h-4 w-4" /> {formatCount(post.commentCount)}</span>
        <button type="button" onClick={() => sharePost(post)} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/10"><Share2 className="h-4 w-4" /> Share</button>
        {canDelete && <button type="button" onClick={removePost} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-red-300"><Trash2 className="h-4 w-4" /> Delete</button>}
      </div>

      <div className="mt-6">
        {isAuthenticated ? (
          permissions.canComment
            ? <CommentComposer disabled={isOffline} onSubmit={(text) => reply(text, null)} />
            : <p className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-400">Join c/{post.circle?.slug} to comment.</p>
        ) : (
          <button type="button" onClick={() => navigate('/login', { state: { from: { pathname: location.pathname } } })} className="w-full rounded-2xl border border-white/15 px-4 py-3 text-left text-sm text-slate-500 hover:border-white/30">Log in to join the conversation</button>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
        Sort by:
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-full border border-white/10 bg-[#0f2530] px-3 py-1 text-xs text-slate-200 outline-none">
          <option value="best">Best</option><option value="new">New</option><option value="old">Old</option>
        </select>
      </div>

      <div className="mt-3 pb-16">
        {tree.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No comments yet. Be the first to share what you think.</p>}
        {tree.map((node) => <Comment key={node.comment.id} node={node} depth={0} ctx={ctx} />)}
      </div>
    </div>
  );
}
