import React from 'react';
import { colorFor } from './utils.js';

// Reddit-style round community icon with the first letter.
export default function CommunityIcon({ community, size = 24, className = '' }) {
  const slug = community?.slug || '';
  const bg = community?.iconColor || colorFor(slug);
  return (
    <span
      style={{ width: size, height: size, background: bg, fontSize: Math.max(10, size * 0.45) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
    >
      {slug ? slug[0].toUpperCase() : 'c/'}
    </span>
  );
}
