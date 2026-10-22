import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Play } from 'lucide-react';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { imageForQuality } from './utils.js';

// Reddit-style media carousel. Bandwidth rules:
//   - fast/medium: images load (sized by Cloudinary), videos show a poster
//     and only download when the viewer presses play (preload="none")
//   - slow: nothing downloads until the viewer taps "Load"
//   - offline: placeholder only
export default function MediaGallery({ media = [], compact = false }) {
  const { policy, isOffline } = useNetwork();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState({});
  if (!media.length) return null;

  const lightweight = policy.imageQuality === 'lightweight' || isOffline;
  const item = media[Math.min(index, media.length - 1)];
  const isRevealed = revealed[index] || !lightweight;
  const go = (delta, e) => { e.stopPropagation(); e.preventDefault(); setIndex((i) => (i + delta + media.length) % media.length); };

  return (
    <div className={`relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black ${compact ? 'max-h-[420px]' : 'max-h-[640px]'}`} onClick={(e) => item.type === 'video' && e.stopPropagation()}>
      {!isRevealed ? (
        <button
          type="button"
          disabled={isOffline}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setRevealed((r) => ({ ...r, [index]: true })); }}
          className="flex h-48 w-full flex-col items-center justify-center gap-2 text-xs text-slate-400 hover:text-white disabled:cursor-not-allowed"
        >
          {item.type === 'video' ? <Play className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
          {isOffline ? 'Media unavailable offline' : `Low-bandwidth mode — tap to load ${item.type}`}
        </button>
      ) : item.type === 'video' ? (
        <video
          key={item.url}
          src={item.url}
          poster={policy.externalHeavyAssets ? item.thumbnailUrl || undefined : undefined}
          controls
          preload="none"
          playsInline
          className={`mx-auto w-full ${compact ? 'max-h-[420px]' : 'max-h-[640px]'} bg-black`}
        />
      ) : (
        <img
          key={item.url}
          src={imageForQuality(item.url, policy.imageQuality)}
          alt=""
          loading="lazy"
          className={`mx-auto block w-auto max-w-full object-contain ${compact ? 'max-h-[420px]' : 'max-h-[640px]'}`}
        />
      )}

      {media.length > 1 && (
        <>
          <button type="button" onClick={(e) => go(-1, e)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80" aria-label="Previous"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={(e) => go(1, e)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80" aria-label="Next"><ChevronRight className="h-5 w-5" /></button>
          <div className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">{index + 1}/{media.length}</div>
        </>
      )}
    </div>
  );
}
