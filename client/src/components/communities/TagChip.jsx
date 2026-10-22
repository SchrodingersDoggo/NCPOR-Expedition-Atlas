import React from 'react';
import { tagColor } from './utils.js';

// Reddit "flair" style tag.
export default function TagChip({ tag, onRemove, onClick }) {
  const color = tagColor(tag);
  return (
    <span
      onClick={onClick}
      style={{ background: `${color}26`, color, borderColor: `${color}55` }}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${onClick ? 'cursor-pointer' : ''}`}
    >
      {tag}
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(tag); }} className="ml-0.5 opacity-70 hover:opacity-100">×</button>}
    </span>
  );
}
