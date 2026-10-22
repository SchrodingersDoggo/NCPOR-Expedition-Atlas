import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CircleDot, CloudOff, Gauge, HardDriveDownload, Wifi, Zap } from 'lucide-react';

const ICONS = { Offline: CloudOff, 'Low Bandwidth': Gauge, Online: Wifi, 'Saved Offline': HardDriveDownload, 'Fast Cache': Zap };

function Chip({ item }) {
  const Icon = ICONS[item.label] || CircleDot;
  return <span className="viz-status-chip" data-tone={item.tone} title={item.title || item.label}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</span>;
}

export default function WorkbenchHeader({ expeditionName, backHref, statuses = [], mobileActions = null }) {
  return <header className="viz-header">
    <Link to={backHref} className="viz-btn viz-btn-sm" aria-label="Back to expedition"><ArrowLeft className="h-4 w-4" /> Expedition</Link>
    <div className="min-w-0 flex-1 border-l pl-3" style={{ borderColor: 'var(--viz-border)' }}>
      <div className="viz-header-eyebrow">Scientific Data Visualizer</div>
      <h1 className="viz-header-title truncate">{expeditionName || 'Expedition'}</h1>
    </div>
    <div className="flex flex-wrap items-center justify-end gap-1.5" aria-label="Connection and data status">{statuses.map((item, index) => <Chip key={`${item.label}-${index}`} item={item} />)}</div>
    {mobileActions && <div className="viz-mobile-actions w-full items-center justify-end gap-2 border-t pt-2" style={{ borderColor: 'var(--viz-border)' }}>{mobileActions}</div>}
  </header>;
}
