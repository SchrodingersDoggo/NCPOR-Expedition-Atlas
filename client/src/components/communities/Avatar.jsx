import React from 'react';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { colorFor, initials } from './utils.js';

// User avatar. In low-bandwidth / offline mode it never requests the image
// and shows initials instead.
export default function Avatar({ user, size = 24, className = '' }) {
  const { policy } = useNetwork();
  const showImage = user?.avatarUrl && policy.externalHeavyAssets;
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4) };
  if (showImage) {
    return <img src={user.avatarUrl} alt="" loading="lazy" style={style} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <span style={{ ...style, background: colorFor(user?.id || user?.name || '') }} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}>
      {initials(user?.name)}
    </span>
  );
}
