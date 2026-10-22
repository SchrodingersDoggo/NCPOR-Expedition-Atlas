import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Image as ImageIcon, Link2, Newspaper, Tag, Trash2, UploadCloud, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { createPost, uploadCommunityMedia } from '../../api/communities.js';
import { fetchExpeditionsForGlobe } from '../../api/expeditions.js';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import TagChip from '../../components/communities/TagChip.jsx';
import { SUGGESTED_TAGS } from '../../components/communities/utils.js';

const MAX_FILES = 4;
const MAX_FILE_MB = 20;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

const TABS = [
  { id: 'text', label: 'Text', icon: FileText },
  { id: 'media', label: 'Images & Video', icon: ImageIcon },
  { id: 'link', label: 'Link', icon: Link2 },
];

// Reddit's "Create post" screen.
export default function CreatePostPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSlow, isOffline } = useNetwork();
  const { mine } = useOutletContext();
  const [params] = useSearchParams();
  const canPostNews = user && ['researcher', 'comms_officer', 'admin'].includes(user.role);

  const [target, setTarget] = useState(params.get('type') === 'news' && canPostNews ? '__news__' : params.get('community') || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [tab, setTab] = useState('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [files, setFiles] = useState([]); // { file, preview }
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tagsOpen, setTagsOpen] = useState(false);
  const [expeditions, setExpeditions] = useState([]);
  const [expeditionId, setExpeditionId] = useState('');
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const isNews = target === '__news__';
  const postable = useMemo(() => mine.filter((c) => c.membership?.status === 'active'), [mine]);
  const selected = postable.find((c) => c.slug === target);
  const filteredPostable = postable.filter((c) => c.slug.toLowerCase().includes(pickerQuery.toLowerCase()));

  useEffect(() => { fetchExpeditionsForGlobe().then(setExpeditions).catch(() => {}); }, []);
  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list) {
    const incoming = Array.from(list || []);
    const accepted = [];
    for (const file of incoming) {
      if (!ACCEPT.split(',').includes(file.type)) { toast.error(`${file.name}: unsupported type`); continue; }
      if (file.size > MAX_FILE_MB * 1024 * 1024) { toast.error(`${file.name}: over ${MAX_FILE_MB}MB`); continue; }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }
    setFiles((prev) => {
      const next = [...prev, ...accepted].slice(0, MAX_FILES);
      if (prev.length + accepted.length > MAX_FILES) toast(`Only ${MAX_FILES} files per post`);
      return next;
    });
  }

  function removeFile(i) {
    setFiles((prev) => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, j) => j !== i); });
  }

  function addTag(raw) {
    const tag = raw.trim().slice(0, 30);
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    if (tags.length >= 5) { toast('Up to 5 tags'); return; }
    setTags([...tags, tag]);
    setTagInput('');
  }

  const totalMB = files.reduce((s, f) => s + f.file.size, 0) / (1024 * 1024);
  const effectiveTab = isNews ? 'news' : tab;
  const ready = title.trim() && target && !isOffline && (
    effectiveTab === 'news' ? linkUrl.trim()
      : effectiveTab === 'link' ? linkUrl.trim()
        : effectiveTab === 'media' ? files.length > 0
          : true);

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      let media = [];
      if (files.length && (effectiveTab === 'media' || effectiveTab === 'news')) {
        setProgress(0);
        media = await uploadCommunityMedia(files.map((f) => f.file), setProgress);
      }
      const post = await createPost({
        communitySlug: isNews ? undefined : target,
        postType: effectiveTab,
        title: title.trim(),
        body: body.trim(),
        linkUrl: ['link', 'news'].includes(effectiveTab) ? linkUrl.trim() : undefined,
        media,
        tags,
        expeditionId: expeditionId || undefined,
      });
      toast.success('Posted!');
      navigate(`/communities/post/${post.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create the post');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Create post</h1>

      {/* Community picker */}
      <div className="relative mt-4 inline-block">
        <button type="button" onClick={() => setPickerOpen((o) => !o)} className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
          {isNews ? <><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ffb000] text-[#1a1a1b]"><Newspaper className="h-3.5 w-3.5" /></span> News</>
            : selected || target ? <><CommunityIcon community={selected || { slug: target }} size={24} /> c/{target}</>
              : <><span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-500 text-xs">c/</span> Select a community</>}
          <ChevronDown className="h-4 w-4" />
        </button>
        {pickerOpen && (
          <>
            <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setPickerOpen(false)} />
            <div className="absolute z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#0f2530] shadow-2xl">
              <input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search your communities" className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white outline-none" />
              <div className="max-h-72 overflow-y-auto py-1">
                {canPostNews && (
                  <button type="button" onClick={() => { setTarget('__news__'); setPickerOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white hover:bg-white/5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ffb000] text-[#1a1a1b]"><Newspaper className="h-4 w-4" /></span>
                    <span><span className="block">News</span><span className="block text-[11px] text-slate-500">Share a headline with its source link</span></span>
                  </button>
                )}
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your communities</p>
                {filteredPostable.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setTarget(c.slug); setPickerOpen(false); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white hover:bg-white/5">
                    <CommunityIcon community={c} size={28} /> <span>c/{c.slug}<span className="block text-[11px] text-slate-500">{c.memberCount} members</span></span>
                  </button>
                ))}
                {postable.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">You can post in communities you've joined. Find some in Explore.</p>}
              </div>
            </div>
          </>
        )}
      </div>

      <form onSubmit={submit} className="mt-4">
        {/* Tabs */}
        {!isNews && (
          <div className="flex gap-1 border-b border-white/10">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === id ? 'border-cyan-300 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <label className="block">
            <div className="flex items-center rounded-2xl border border-white/15 bg-black/20 px-4 focus-within:border-cyan-300/60">
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 300))} placeholder={isNews ? 'Headline*' : 'Title*'} className="w-full bg-transparent py-3.5 text-white outline-none placeholder:text-slate-500" />
            </div>
            <span className="mt-1 block text-right text-[11px] text-slate-500">{title.length}/300</span>
          </label>

          {/* Tags */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((t) => <TagChip key={t} tag={t} onRemove={(x) => setTags(tags.filter((y) => y !== x))} />)}
              <button type="button" onClick={() => setTagsOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                <Tag className="h-3.5 w-3.5" /> Add tags
              </button>
            </div>
            {tagsOpen && (
              <div className="mt-2 rounded-2xl border border-white/10 bg-[#0f2530] p-3">
                <div className="flex gap-2">
                  <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }} placeholder="Type a tag and press Enter" className="w-full rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white outline-none" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => <TagChip key={t} tag={t} onClick={() => addTag(t)} />)}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Up to 5 tags. They help people find your post in search.</p>
              </div>
            )}
          </div>

          {(effectiveTab === 'link' || effectiveTab === 'news') && (
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} type="url" placeholder={isNews ? 'Source link* (https://…)' : 'Link URL*'} className="w-full rounded-2xl border border-white/15 bg-black/20 px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60" />
          )}

          {(effectiveTab === 'media' || effectiveTab === 'news') && (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center ${dragging ? 'border-cyan-300 bg-cyan-300/5' : 'border-white/15'}`}
              >
                <UploadCloud className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm text-slate-300">Drag and drop {isNews ? 'an image (optional)' : 'photos or videos'} or{' '}
                  <button type="button" onClick={() => fileInput.current?.click()} className="font-semibold text-cyan-300 hover:underline">upload</button>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">JPG, PNG, WEBP, GIF, MP4, WEBM, MOV · up to {MAX_FILES} files · {MAX_FILE_MB}MB each</p>
                <input ref={fileInput} type="file" accept={isNews ? 'image/jpeg,image/png,image/webp' : ACCEPT} multiple={!isNews} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {isSlow && files.length > 0 && <p className="mt-2 text-xs text-amber-200">Low-bandwidth connection: {totalMB.toFixed(1)}MB to upload. This may take a while — consider fewer or smaller files.</p>}
              {files.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {files.map((f, i) => (
                    <div key={f.preview} className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black">
                      {f.file.type.startsWith('video/')
                        ? <video src={f.preview} muted className="h-full w-full object-cover" />
                        : <img src={f.preview} alt="" className="h-full w-full object-cover" />}
                      <button type="button" onClick={() => removeFile(i)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-80 hover:opacity-100" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                      {f.file.type.startsWith('video/') && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">video</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={effectiveTab === 'text' ? 9 : 4}
            placeholder={effectiveTab === 'text' ? 'Body text — share an expedition update, ask a question, describe your data…' : 'Body text (optional)'}
            className="w-full resize-y rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />

          {!isNews && expeditions.length > 0 && (
            <label className="block text-xs text-slate-400">Link an expedition (optional)
              <select value={expeditionId} onChange={(e) => setExpeditionId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#102b35] px-3 py-2.5 text-sm text-white outline-none">
                <option value="">None</option>
                {expeditions.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {progress !== null && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-cyan-300" style={{ width: `${progress}%` }} /></div>
            <p className="mt-1 text-xs text-slate-400">Uploading media… {progress}%</p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {isOffline && <span className="mr-auto text-xs text-amber-200">You're offline — posting is unavailable.</span>}
          <button type="button" onClick={() => navigate(-1)} className="rounded-full px-5 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"><X className="mr-1 inline h-4 w-4" />Cancel</button>
          <button type="submit" disabled={!ready || busy} className="rounded-full bg-cyan-300 px-6 py-2 text-sm font-bold text-[#06202a] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Posting…' : 'Post'}</button>
        </div>
      </form>
    </div>
  );
}
