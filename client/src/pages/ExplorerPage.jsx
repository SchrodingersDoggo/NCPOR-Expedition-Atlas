import React, { useCallback, useState } from 'react';
import { Compass } from 'lucide-react';
import ExplorerSearch from '../components/explorer/ExplorerSearch.jsx';
import ExplorerStats from '../components/explorer/ExplorerStats.jsx';
import ExplorerRegionGrid from '../components/explorer/ExplorerRegionGrid.jsx';
import ExplorerExpeditionBrowser from '../components/explorer/ExplorerExpeditionBrowser.jsx';
import ExplorerTimeline from '../components/explorer/ExplorerTimeline.jsx';
import ExplorerStationsPanel from '../components/explorer/ExplorerStationsPanel.jsx';
import ResearcherExplorer from '../components/explorer/ResearcherExplorer.jsx';
import VisualExplorer from '../components/explorer/VisualExplorer.jsx';
import { useExplorerData } from '../components/explorer/useExplorerData.js';
import '../components/explorer/Explorer.css';

export default function ExplorerPage() {
  const data = useExplorerData();
  const [selected, setSelected] = useState(null);
  const [activeRegion, setActiveRegion] = useState(null);
  const [view, setView] = useState('expeditions');

  // Used both by ExplorerSearch (picking a result) and by the region/
  // station cards below — one selection handler, one detail panel.
  const handleSelect = useCallback((item) => {
    setSelected(item);
    setView('expeditions');
    requestAnimationFrame(() => {
      document.getElementById('explorer-browser')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleSelectRegion = useCallback((region) => {
    setActiveRegion(region);
    setSelected(null);
  }, []);

  const handleViewMore = useCallback(() => {
    setView('gallery');
    requestAnimationFrame(() => {
      document.getElementById('explorer-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const regionsActive = new Set(data.expeditions.map((exp) => exp.region).filter(Boolean)).size;

  return (
    <div id="explorer-top" className="explorer-page chart-backdrop">
      <header className="explorer-header">
        <div className="explorer-header-inner">
          <p className="explorer-eyebrow">
            <Compass className="w-3.5 h-3.5" aria-hidden="true" /> NCPOR Expedition Atlas
          </p>
          <h1 className="explorer-title plate-label">Every expedition, charted.</h1>
          <p className="explorer-subtitle">
            Browse polar and high-altitude research by region, year, and the people running it.
            Search across expeditions, researchers, datasets, and regions in one place.
          </p>
        </div>
      </header>

      <ExplorerSearch onExpeditionSelect={handleSelect} />

      <main className="explorer-main">
        <ExplorerStats
          status={data.status}
          expeditionsTotal={data.expeditionsTotal}
          researchersCount={data.researchersCount}
          datasetsCount={data.datasetsCount}
          photosCount={data.photosCount}
          regionsActive={regionsActive}
        />

        <ExplorerRegionGrid
          expeditions={data.expeditions}
          activeRegion={activeRegion}
          onSelectRegion={handleSelectRegion}
        />

        <div className="explorer-view-switch">
          <button
            type="button"
            onClick={() => setView('expeditions')}
            className={`explorer-view-tab${view === 'expeditions' ? ' active' : ''}`}
          >
            Expeditions
          </button>
          <button
            type="button"
            onClick={() => setView('gallery')}
            className={`explorer-view-tab${view === 'gallery' ? ' active' : ''}`}
          >
            Gallery
          </button>
        </div>

        {view === 'gallery' ? (
          <VisualExplorer />
        ) : (
          <div id="explorer-browser">
            <ExplorerExpeditionBrowser
              expeditions={data.expeditions}
              status={data.status}
              activeRegion={activeRegion}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        )}

        <ExplorerTimeline expeditions={data.expeditions} status={data.status} />

        <ExplorerStationsPanel stations={data.stations} onSelect={handleSelect} />
      </main>

      <section className="explorer-sections">
        <ResearcherExplorer />
        <VisualExplorer compact onViewMore={handleViewMore} />
      </section>
    </div>
  );
}
