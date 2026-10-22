import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function MobileVizDrawer({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <>
    <button className="viz-mobile-drawer-backdrop" onClick={onClose} aria-label={`Close ${title}`} />
    <div className="viz-mobile-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--viz-border)', background: 'var(--viz-panel)' }}>
        <div className="viz-panel-title">{title}</div>
        <button onClick={onClose} className="viz-collapse-button" aria-label={`Close ${title}`}><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </>;
}
