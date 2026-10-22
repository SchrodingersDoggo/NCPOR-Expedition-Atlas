import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, PanelsTopLeft } from 'lucide-react';
import WorkbenchHeader from './WorkbenchHeader.jsx';
import MobileVizDrawer from './MobileVizDrawer.jsx';
import './workbench.css';

export default function VizWorkbench({ expeditionName, backHref, statuses, left, right, viewport, modeBar, controlBar }) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const centerRef = useRef(null);

  useEffect(() => {
    const handler = () => setFullscreen(document.fullscreenElement === centerRef.current);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === centerRef.current) await document.exitFullscreen();
      else await centerRef.current?.requestFullscreen?.();
    } catch {
      setFullscreen((value) => !value);
    }
  }

  const mobileActions = <>
    <button onClick={() => setMobileDrawer('data')} className="viz-btn viz-btn-sm"><PanelsTopLeft className="h-3.5 w-3.5" /> Data &amp; variables</button>
    <button onClick={() => setMobileDrawer('info')} className="viz-btn viz-btn-sm"><Info className="h-3.5 w-3.5" /> Information</button>
  </>;

  return <div className="viz-workbench"><div className="viz-workbench-shell">
    <WorkbenchHeader expeditionName={expeditionName} backHref={backHref} statuses={statuses} mobileActions={mobileActions} />
    <div className="viz-workbench-grid" data-left-collapsed={leftCollapsed} data-right-collapsed={rightCollapsed}>
      <aside className="viz-workbench-left viz-workbench-panel viz-workbench-rail relative" aria-label="Datasets and variables">{leftCollapsed
        ? <button onClick={() => setLeftCollapsed(false)} className="viz-collapse-button viz-collapse-expand" aria-label="Expand datasets panel" title="Expand datasets panel"><ChevronRight className="h-4 w-4" /></button>
        : <><button onClick={() => setLeftCollapsed(true)} className="viz-collapse-button absolute right-2 top-2 z-10" aria-label="Collapse datasets panel" title="Collapse panel"><ChevronLeft className="h-4 w-4" /></button>{left}</>}</aside>
      <main ref={centerRef} className="viz-workbench-center">{React.cloneElement(viewport, { isFullscreen: fullscreen, onToggleFullscreen: toggleFullscreen })}{modeBar}{controlBar}</main>
      <aside className="viz-workbench-right viz-workbench-panel viz-workbench-rail relative" aria-label="Scientific information">{rightCollapsed
        ? <button onClick={() => setRightCollapsed(false)} className="viz-collapse-button viz-collapse-expand" aria-label="Expand scientific information panel" title="Expand information panel"><ChevronLeft className="h-4 w-4" /></button>
        : <><button onClick={() => setRightCollapsed(true)} className="viz-collapse-button absolute right-2 top-2 z-10" aria-label="Collapse scientific information panel" title="Collapse panel"><ChevronRight className="h-4 w-4" /></button>{right}</>}</aside>
    </div>
    <MobileVizDrawer open={mobileDrawer === 'data'} title="Datasets & Variables" onClose={() => setMobileDrawer(null)}>{left}</MobileVizDrawer>
    <MobileVizDrawer open={mobileDrawer === 'info'} title="Scientific Information" onClose={() => setMobileDrawer(null)}>{right}</MobileVizDrawer>
  </div></div>;
}
