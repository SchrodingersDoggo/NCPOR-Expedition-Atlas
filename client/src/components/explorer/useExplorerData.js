import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { fetchResearchers } from '../../api/researchers.js';
import { fetchResearchStations } from '../../api/stations.js';

const EMPTY = {
  status: 'loading', // 'loading' | 'ready' | 'error'
  expeditions: [],
  expeditionsTotal: 0,
  researchersCount: 0,
  datasetsCount: 0,
  photosCount: 0,
  stations: [],
};

// One fetch, shared by every Explorer panel (stats, region grid, timeline,
// expedition browser). Previously each panel that needed real numbers
// fetched its own copy, or — for the stats/timeline panels — didn't fetch
// anything at all and just showed a locked "coming soon" placeholder. This
// pulls the real numbers once and lets the panels stay simple, presentational
// components that just render whatever they're handed.
export function useExplorerData() {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [expeditionsRes, researchers, datasetsRes, photosRes, stations] = await Promise.all([
          api.get('/expeditions', { params: { limit: 100 } }),
          fetchResearchers().catch(() => []),
          api.get('/content', { params: { type: 'dataset', status: 'published' } }).catch(() => ({ data: [] })),
          api.get('/content', { params: { type: 'photo', status: 'published' } }).catch(() => ({ data: [] })),
          fetchResearchStations().catch(() => []),
        ]);
        if (cancelled) return;

        const expeditions = expeditionsRes.data.expeditions || [];
        setState({
          status: 'ready',
          expeditions,
          expeditionsTotal: expeditionsRes.data.pagination?.total ?? expeditions.length,
          researchersCount: researchers.length,
          datasetsCount: Array.isArray(datasetsRes.data) ? datasetsRes.data.length : 0,
          photosCount: Array.isArray(photosRes.data) ? photosRes.data.length : 0,
          stations: stations || [],
        });
      } catch (err) {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
