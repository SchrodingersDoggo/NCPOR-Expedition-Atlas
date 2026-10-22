import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, Film, FileSpreadsheet, Sparkles, Download, Share2,
  Trash2, Play, Loader2, RefreshCw, Copy, Check,
  WandSparkles, Clock3, Database, Video, X, ChevronRight, Image as ImageIcon, Languages,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  uploadStudioAsset, listStudioProjects, createStudioProject, generateStudioProject,
  getStudioProject, updateStudioProject, deleteStudioGenerated, deleteStudioProject,
  listVoiceoverLanguages,
} from '../api/studio.js';

const DATA_ACCEPT = '.csv,.tsv,.json,.pdf,.xlsx,.xls,.doc,.docx,text/csv,application/json,application/pdf';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const READY_STATES = ['ready', 'failed'];

function bytes(size = 0) {
  if (!size) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(size); let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function StatusPill({ status }) {
  const tone = status === 'ready' ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
    : status === 'failed' ? 'text-red-300 border-red-400/30 bg-red-400/10'
      : 'text-cyan-200 border-cyan-400/30 bg-cyan-400/10';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${tone}`}>{status || 'draft'}</span>;
}

function UploadBox({ icon: Icon, title, subtitle, accept, multiple, onFiles, disabled }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles([...e.dataTransfer.files]); }}
      className={`w-full rounded-2xl border border-dashed p-5 text-left transition ${drag ? 'border-cyan-300 bg-cyan-400/10' : 'border-cyan-500/35 bg-[#0d2a33] hover:border-cyan-400/60'} disabled:opacity-50`}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => onFiles([...e.target.files])} />
      <div className="flex items-start gap-3">
        <span className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2.5"><Icon className="h-5 w-5 text-cyan-300" /></span>
        <div>
          <p className="text-sm font-bold tracking-wide text-cyan-100">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function AssetRow({ asset, type, onRemove, disabled }) {
  const Icon = type === 'video' ? Video : type === 'image' ? ImageIcon : Database;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-[#0a222b] p-3">
      <span className="rounded-lg bg-cyan-400/10 p-2"><Icon className="h-4 w-4 text-cyan-300" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-100">{asset.name}</p>
        <p className="text-[11px] text-slate-500">{bytes(asset.size)} {asset.uploading ? '• uploading…' : asset.error ? `• ${asset.error}` : '• ready'}</p>
      </div>
      {!disabled && <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-400/10 hover:text-red-300"><X className="h-4 w-4" /></button>}
    </div>
  );
}

export default function StudioPage() {
  const [videos, setVideos] = useState([]);
  const [dataFiles, setDataFiles] = useState([]);
  const [images, setImages] = useState([]);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [notes, setNotes] = useState('');
  const [languages, setLanguages] = useState([]);
  const [voiceoverLanguage, setVoiceoverLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingText, setSavingText] = useState(false);

  const isProcessing = active && !READY_STATES.includes(active.status) && active.status !== 'draft';

  useEffect(() => {
    listStudioProjects().then((items) => {
      setProjects(items);
      if (items[0]) setActive(items[0]);
    }).catch((err) => toast.error(err.response?.data?.error || 'Could not load Studio projects'));
  }, []);

  useEffect(() => {
    listVoiceoverLanguages().then(setLanguages).catch(() => {
      // Non-fatal — the picker just shows English-only if this fails.
      setLanguages([{ code: 'en', label: 'English' }]);
    });
  }, []);

  useEffect(() => {
    if (!active?.id || READY_STATES.includes(active.status) || active.status === 'draft') return undefined;
    const timer = setInterval(async () => {
      try {
        const fresh = await getStudioProject(active.id);
        setActive(fresh);
        setProjects((p) => p.map((item) => item.id === fresh.id ? fresh : item));
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, [active?.id, active?.status]);

  const duration = useMemo(() => {
    const segments = active?.editPlan?.segments || [];
    return Math.min(45, segments.reduce((sum, s) => sum + Number(s.duration || 0), 0));
  }, [active?.editPlan]);

  async function uploadFiles(files, kind) {
    const valid = files.filter((file) => {
      if (kind === 'video') return file.type.startsWith('video/');
      if (kind === 'image') return file.type.startsWith('image/');
      return !file.type.startsWith('video/') && !file.type.startsWith('image/');
    });
    if (!valid.length) return toast.error(kind === 'video' ? 'Choose a video file.' : kind === 'image' ? 'Choose an image file.' : 'Choose a data/document file.');
    const setter = kind === 'video' ? setVideos : kind === 'image' ? setImages : setDataFiles;
    const temp = valid.map((file) => ({ name: file.name, size: file.size, uploading: true, localKey: crypto.randomUUID() }));
    setter((prev) => [...prev, ...temp]);
    await Promise.all(valid.map(async (file, i) => {
      const key = temp[i].localKey;
      try {
        const uploaded = await uploadStudioAsset(file);
        setter((prev) => prev.map((a) => a.localKey === key ? { ...uploaded, localKey: key } : a));
      } catch (err) {
        setter((prev) => prev.map((a) => a.localKey === key ? { ...a, uploading: false, error: err.response?.data?.error || 'upload failed' } : a));
      }
    }));
  }

  function removeAsset(kind, key) {
    const setter = kind === 'video' ? setVideos : kind === 'image' ? setImages : setDataFiles;
    setter((prev) => prev.filter((a) => a.localKey !== key));
  }

  async function synthesize() {
    const goodVideos = videos.filter((v) => v.url && !v.uploading && !v.error);
    const goodDataFiles = dataFiles.filter((v) => v.url && !v.uploading && !v.error);
    const goodImages = images.filter((v) => v.url && !v.uploading && !v.error);
    if (!goodVideos.length && !goodDataFiles.length && !goodImages.length) return toast.error('Upload a video, a photo, or a report/dataset first.');
    if (videos.some((v) => v.uploading) || dataFiles.some((v) => v.uploading) || images.some((v) => v.uploading)) return toast.error('Wait for uploads to finish.');
    setBusy(true);
    try {
      const titleSource = goodVideos[0]?.name || goodImages[0]?.name || goodDataFiles[0]?.name || 'Untitled Studio Post';
      const created = await createStudioProject({
        title: titleSource.replace(/\.[^.]+$/, ''),
        notes,
        videos: goodVideos.map(({ name, url, mimeType, size, thumbnailUrl }) => ({ name, url, mimeType, size, thumbnailUrl })),
        dataFiles: goodDataFiles.map(({ name, url, mimeType, size }) => ({ name, url, mimeType, size })),
        images: goodImages.map(({ name, url, mimeType, size }) => ({ name, url, mimeType, size })),
        voiceover_language: voiceoverLanguage,
      });
      setActive(created);
      setProjects((p) => [created, ...p]);
      toast.success(goodVideos.length ? 'AI is analyzing the footage and building your 9:16 reel.' : 'AI is writing your post and preparing an image.');
      const generated = await generateStudioProject(created.id);
      setActive(generated);
      setProjects((p) => p.map((item) => item.id === generated.id ? generated : item));
      toast.success('Generation started. Studio will update automatically as it finishes.');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Studio generation failed');
      if (active?.id) {
        try { setActive(await getStudioProject(active.id)); } catch {}
      }
    } finally { setBusy(false); }
  }

  async function saveText() {
    if (!active?.id) return;
    setSavingText(true);
    try {
      const updated = await updateStudioProject(active.id, { caption: active.caption || '', aiSummary: active.aiSummary || '' });
      setActive(updated);
      toast.success('Caption and summary saved.');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSavingText(false); }
  }

  async function deleteGenerated() {
    if (!active?.id || !confirm('Delete the generated reel, caption and summary from this Studio project?')) return;
    try {
      const updated = await deleteStudioGenerated(active.id);
      setActive(updated);
      setProjects((p) => p.map((item) => item.id === updated.id ? updated : item));
      toast.success('Generated media cleared.');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not delete generated media'); }
  }

  async function deleteProjectAll() {
    if (!active?.id || !confirm('Delete this Studio project record? Uploaded source files may remain in media storage.')) return;
    try {
      await deleteStudioProject(active.id);
      const next = projects.filter((p) => p.id !== active.id);
      setProjects(next); setActive(next[0] || null);
      toast.success('Studio project deleted.');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not delete project'); }
  }

  function downloadReel() {
    const mediaUrl = active?.reelUrl || active?.postImageUrl;
    if (!mediaUrl) return;
    const ext = active?.reelUrl ? 'mp4' : 'jpg';
    const a = document.createElement('a'); a.href = mediaUrl; a.download = `${active.title || 'ncpor-reel'}.${ext}`; a.target = '_blank'; a.rel = 'noreferrer'; a.click();
  }

  async function shareFile(platform) {
    const mediaUrl = active?.reelUrl || active?.postImageUrl;
    if (!mediaUrl) return toast.error('Nothing ready to share yet.');
    if (platform === 'youtube' && !active?.reelUrl) return toast.error('YouTube needs a video — this is an image post.');
    const isVideo = Boolean(active?.reelUrl);

    const isMobile =
      navigator.userAgentData?.mobile === true ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

    // On phones/tablets, native share can hand the actual file directly to
    // an installed social app. Desktop browsers cannot pre-attach a file to
    // YouTube/Instagram/X for security reasons, so desktop goes straight to
    // the platform's upload/composer page after downloading the file and
    // copying the caption.
    if (isMobile && navigator.share) {
      try {
        const response = await fetch(mediaUrl);
        const blob = await response.blob();
        const file = new File([blob], isVideo ? 'ncpor-reel.mp4' : 'ncpor-post.jpg', {
          type: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        });

        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: active.title || 'NCPOR Reel',
            text: active.caption || '',
            files: [file],
          });
          return;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }

    const urls = {
      youtube: 'https://www.youtube.com/upload',
      instagram: 'https://www.instagram.com/create/select/',
      twitter: 'https://x.com/compose/post',
    };

    // Open the destination immediately from the click event so popup blockers
    // do not stop it after the async clipboard/download work below.
    window.open(urls[platform], '_blank', 'noopener,noreferrer');

    try {
      await navigator.clipboard.writeText(active.caption || '');
    } catch {}

    downloadReel();


    toast.success(`Upload page opened. ${isVideo ? 'Reel' : 'Image'} downloaded and caption copied.`);
  }

  async function copyCaption() {
    await navigator.clipboard.writeText(active?.caption || '');
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="min-h-full bg-[#071820] px-5 py-5 text-slate-100">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-3"><span className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 p-2"><Film className="h-5 w-5 text-cyan-300" /></span><h1 className="text-xl font-extrabold tracking-tight">Studio <span className="text-cyan-300">• Research Reel Composer</span></h1></div>
            <p className="mt-1 text-xs text-slate-400">Researcher-only workspace • 9:16 reel • max 45s • AI-selected cuts • English AI voiceover</p>
          </div>
          <div className="flex items-center gap-2"><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">30 FPS • 1080×1920</span>{active && <StatusPill status={active.status} />}</div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[330px_minmax(380px,1fr)_390px]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#0a2029] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-cyan-200"><UploadCloud className="h-4 w-4" /> SOURCE UPLOAD</h2>
              <div className="space-y-3">
                <UploadBox icon={Film} title="UPLOAD FOOTAGE" subtitle="MP4, WEBM or MOV. Upload multiple clips; AI will choose the strongest moments." accept={VIDEO_ACCEPT} multiple onFiles={(f) => uploadFiles(f, 'video')} disabled={busy} />
                <UploadBox icon={ImageIcon} title="UPLOAD PHOTOS" subtitle="No video? Add a photo and AI will turn it into a social-ready post image." accept={IMAGE_ACCEPT} multiple onFiles={(f) => uploadFiles(f, 'image')} disabled={busy} />
                <UploadBox icon={FileSpreadsheet} title="UPLOAD DATA / CONTEXT" subtitle="Optional CSV, JSON, PDF, XLSX or document to keep the reel scientifically grounded." accept={DATA_ACCEPT} multiple onFiles={(f) => uploadFiles(f, 'data')} disabled={busy} />
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional researcher notes: mission, finding, location, context…" className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-[#061820] p-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/40" />

                {/* Voiceover language — only matters for a reel (needs a
                    video); shown always so the choice is already made by
                    the time a video is added. */}
                <div className="rounded-xl border border-white/10 bg-[#061820] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold text-cyan-200">
                    <Languages className="h-3.5 w-3.5" /> VOICEOVER LANGUAGE
                  </div>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {(languages.length ? languages : [{ code: 'en', label: 'English' }]).map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => setVoiceoverLanguage(lang.code)}
                        disabled={busy}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          voiceoverLanguage === lang.code
                            ? 'border-transparent bg-gradient-to-r from-cyan-500 to-teal-400 text-[#06202a]'
                            : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-400/40 hover:text-white'
                        }`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0a2029] p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-cyan-200">ASSET DRAWER</h2><span className="text-[11px] text-slate-500">{videos.length + images.length + dataFiles.length} items</span></div>
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {!videos.length && !images.length && !dataFiles.length && <p className="rounded-xl border border-white/5 bg-black/10 p-4 text-center text-xs text-slate-600">Uploaded assets appear here.</p>}
                {videos.map((a) => <AssetRow key={a.localKey} asset={a} type="video" disabled={busy} onRemove={() => removeAsset('video', a.localKey)} />)}
                {images.map((a) => <AssetRow key={a.localKey} asset={a} type="image" disabled={busy} onRemove={() => removeAsset('image', a.localKey)} />)}
                {dataFiles.map((a) => <AssetRow key={a.localKey} asset={a} type="data" disabled={busy} onRemove={() => removeAsset('data', a.localKey)} />)}
              </div>
              <button onClick={synthesize} disabled={busy || (!videos.some((v) => v.url) && !images.some((v) => v.url) && !dataFiles.some((v) => v.url))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 px-4 py-3 text-sm font-extrabold text-[#06202a] shadow-lg shadow-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />} {busy ? (videos.some((v) => v.url) ? 'Analyzing + composing…' : 'Writing post…') : (videos.some((v) => v.url) ? 'Synthesize AI Reel' : 'Generate AI Post (no video)')}
              </button>
            </section>

            {projects.length > 0 && <section className="rounded-2xl border border-white/10 bg-[#0a2029] p-4"><h2 className="mb-3 text-sm font-bold text-cyan-200">RECENT STUDIO PROJECTS</h2><div className="space-y-2">{projects.slice(0, 5).map((p) => <button key={p.id} onClick={() => setActive(p)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${active?.id === p.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/5 bg-black/10 hover:bg-white/5'}`}><span className="min-w-0"><span className="block truncate text-xs font-semibold">{p.title}</span><span className="text-[10px] text-slate-500">{p.status}</span></span><ChevronRight className="h-4 w-4 text-slate-600" /></button>)}</div></section>}
          </aside>

          <main className="rounded-2xl border border-white/10 bg-[#0a2029] p-4">
            <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold text-cyan-300">REEL PREVIEW</p><p className="text-[11px] text-slate-500">9:16 • AI-selected cuts • English AI voiceover + field audio</p></div>{active && <span className="flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" /> {duration ? `${duration.toFixed(1)}s` : '≤45s'}</span>}</div>
            <div className="mx-auto flex min-h-[650px] max-w-[390px] items-center justify-center overflow-hidden rounded-[28px] border border-cyan-500/25 bg-[#031016] shadow-2xl shadow-black/40">
              {active?.reelUrl ? <video key={active.reelUrl} src={active.reelUrl} controls playsInline className="aspect-[9/16] h-full max-h-[690px] w-full object-cover" /> : active?.postImageUrl ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
                  <img key={active.postImageUrl} src={active.postImageUrl} alt="" className="max-h-[560px] w-full rounded-2xl object-cover" />
                  <p className="text-center text-xs text-slate-500">Post image — no video was included, so there's no reel render, just this image plus the caption/summary on the right.</p>
                </div>
              ) : (
                <div className="px-8 text-center">
                  {isProcessing || busy ? <><Loader2 className="mx-auto h-11 w-11 animate-spin text-cyan-300" /><p className="mt-4 text-sm font-semibold text-cyan-100">{active?.status === 'rendering' ? 'Rendering your reel…' : 'AI is reviewing footage…'}</p><p className="mt-2 text-xs leading-5 text-slate-500">The finished reel will appear here automatically. You can leave this page and return later.</p></> : active?.status === 'ready' ? <><Sparkles className="mx-auto h-12 w-12 text-cyan-400/50" /><p className="mt-4 text-sm font-semibold text-slate-200">Post ready — no image or video attached</p><p className="mt-2 text-xs leading-5 text-slate-500">Just the caption and summary on the right. Copy the caption, or add a video/photo and generate again.</p></> : <><Play className="mx-auto h-12 w-12 text-cyan-400/30" /><p className="mt-4 text-sm font-semibold text-slate-300">Your vertical reel preview</p><p className="mt-2 text-xs leading-5 text-slate-600">Upload expedition footage, then synthesize a natural short-form edit with AI-selected cuts and text.</p></>}
                  {active?.status === 'failed' && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-300">{active.errorMessage || 'Generation failed.'}</p>}
                </div>
              )}
            </div>
            {active?.editPlan?.segments?.length > 0 && <div className="mx-auto mt-4 max-w-[520px]"><div className="flex gap-1">{active.editPlan.segments.map((s, i) => <div key={i} title={`${Number(s.start).toFixed(1)}s → ${Number(s.duration).toFixed(1)}s`} className="h-2 rounded-full bg-cyan-400/50" style={{ flex: Math.max(1, s.duration) }} />)}</div><div className="mt-2 flex items-center justify-between text-[10px] text-slate-600"><span>AI cut timeline</span><span>{active.editPlan.segments.length} cuts</span></div></div>}
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-[#0a2029] p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-bold text-cyan-200"><Sparkles className="h-4 w-4" /> AI STORY ENGINE</h2>{active?.editPlan && <span className="text-[10px] text-emerald-300">PLAN READY</span>}</div>
              <div className="space-y-3">
                <div className="rounded-xl border border-white/8 bg-[#071a22] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400">AI reel summary</p><textarea value={active?.aiSummary || ''} onChange={(e) => setActive((p) => ({ ...p, aiSummary: e.target.value }))} placeholder="AI summary appears here…" className="min-h-28 w-full resize-none bg-transparent text-xs leading-5 text-slate-300 outline-none" /></div>
                <div className="rounded-xl border border-white/8 bg-[#071a22] p-3"><div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">English AI voiceover</p><span className={`text-[10px] ${active?.voiceoverUrl ? 'text-emerald-300' : 'text-slate-600'}`}>{active?.voiceoverUrl ? 'READY' : 'AUTO'}</span></div><p className="text-xs leading-5 text-slate-300">{active?.voiceoverScript || active?.editPlan?.voiceoverScript || 'A natural English narration will be generated automatically when ElevenLabs is configured.'}</p>{active?.voiceoverUrl && <audio src={active.voiceoverUrl} controls className="mt-2 w-full" />}</div>
                <div className="rounded-xl border border-white/8 bg-[#071a22] p-3"><div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Catchy caption</p><button onClick={copyCaption} disabled={!active?.caption} className="text-slate-500 hover:text-cyan-300">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div><textarea value={active?.caption || ''} onChange={(e) => setActive((p) => ({ ...p, caption: e.target.value }))} placeholder="Generated caption appears here…" className="min-h-32 w-full resize-none bg-transparent text-xs leading-5 text-slate-300 outline-none" /></div>
                {active && <button onClick={saveText} disabled={savingText} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15">{savingText ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Save edits</button>}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0a2029] p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-cyan-200"><Share2 className="h-4 w-4" /> DISSEMINATION HUB</h2><p className="mb-3 text-[11px] leading-4 text-slate-500">On mobile, the file can be shared directly. On desktop, it downloads, the caption is copied, and the selected platform upload page opens directly.</p>
              <div className="space-y-2">
                <button onClick={downloadReel} disabled={!active?.reelUrl && !active?.postImageUrl} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 px-4 py-3 text-xs font-extrabold text-[#06202a] disabled:opacity-30"><Download className="h-4 w-4" /> Download {active?.reelUrl ? 'Reel (.mp4)' : 'Image (.jpg)'}</button>
                <button onClick={() => shareFile('youtube')} disabled={!active?.reelUrl} className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-[#071a22] px-3 py-2.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-30"><Video className="h-4 w-4 text-red-400" /> YouTube Shorts <span className="ml-auto text-[10px] text-slate-500">{active?.postImageUrl && !active?.reelUrl ? 'needs a video' : 'open uploader'}</span></button>
                <button onClick={() => shareFile('instagram')} disabled={!active?.reelUrl && !active?.postImageUrl} className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-[#071a22] px-3 py-2.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-30"><Share2 className="h-4 w-4 text-pink-400" /> {active?.reelUrl ? 'Instagram Reels' : 'Instagram Post'} <span className="ml-auto text-[10px] text-slate-500">open uploader</span></button>
                <button onClick={() => shareFile('twitter')} disabled={!active?.reelUrl && !active?.postImageUrl} className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-[#071a22] px-3 py-2.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-30"><Share2 className="h-4 w-4 text-slate-300" /> X / Twitter <span className="ml-auto text-[10px] text-slate-500">open composer</span></button>
              </div>
            </section>

            {active && <section className="rounded-2xl border border-red-400/15 bg-red-950/10 p-4"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-red-300">Delete / reset</h2><div className="grid grid-cols-2 gap-2"><button onClick={deleteGenerated} className="flex items-center justify-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10"><Trash2 className="h-3.5 w-3.5" /> Reel + caption</button><button onClick={deleteProjectAll} className="flex items-center justify-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10"><Trash2 className="h-3.5 w-3.5" /> Project</button></div></section>}
          </aside>
        </div>
      </div>
    </div>
  );
}
