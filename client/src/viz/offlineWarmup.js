import { getStoredNetworkMode, NETWORK_MODES } from '../offline/networkPreference.js';
import { canReadDataset, getReaderExtension } from './registry.js';

// After an expedition is saved offline, fetch the visualizer's own code once
// (page chunk, parser worker and the readers its datasets need) so the service
// worker caches it. Then the saved datasets can be visualized later without
// any connection, even if the visualizer was never opened online.
//
// Strictly best effort: never throws, never blocks saving, and does nothing
// in Low Bandwidth mode, with Save-Data, on 2G, or while offline.

const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

function lowBandwidth() {
  try {
    if (getStoredNetworkMode() === NETWORK_MODES.LOW_BANDWIDTH) return true;
  } catch { /* ignore */ }
  const connection = globalThis.navigator?.connection;
  if (connection?.saveData) return true;
  return ['slow-2g', '2g'].includes(String(connection?.effectiveType || ''));
}

async function looksLikeHdf5(blob) {
  try {
    for (const offset of [0, 512]) {
      if (blob.size < offset + 8) break;
      const bytes = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
      if (HDF5_SIGNATURE.every((byte, index) => bytes[index] === byte)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function datasetName(item) {
  return item?.originalFileName || item?.offlineFile?.name || item?.fileName || item?.title || '';
}

let warmingPromise = null;

export function warmVisualizerForOffline(savedContent) {
  if (warmingPromise) return warmingPromise;
  warmingPromise = (async () => {
    try {
      if (typeof window === 'undefined' || typeof Worker === 'undefined') return { skipped: 'unsupported' };
      if (globalThis.navigator && globalThis.navigator.onLine === false) return { skipped: 'offline' };
      if (lowBandwidth()) return { skipped: 'low-bandwidth' };

      const datasets = (savedContent?.data || []).filter((item) => item?.offlineFile?.blob && canReadDataset(datasetName(item)));
      if (!datasets.length) return { skipped: 'no-visualizable-datasets' };

      const extensions = new Set(datasets.map((item) => getReaderExtension(datasetName(item))));
      let hdf5 = ['.nc4', '.h5', '.hdf5'].some((extension) => extensions.has(extension));
      if (!hdf5 && extensions.has('.nc')) {
        for (const item of datasets) {
          if (getReaderExtension(datasetName(item)) === '.nc' && await looksLikeHdf5(item.offlineFile.blob)) { hdf5 = true; break; }
        }
      }

      // The page chunk pulls in the chart and workbench code with it.
      await import('../pages/VizPage.jsx');
      const { warmVisualizationWorker } = await import('./workerClient.js');
      const loaded = await warmVisualizationWorker([...extensions], { hdf5 });
      return { warmed: loaded, hdf5 };
    } catch (error) {
      return { skipped: 'error', error: error?.message || String(error) };
    } finally {
      // Allow a later save (e.g. a different expedition/format) to warm again.
      setTimeout(() => { warmingPromise = null; }, 0);
    }
  })();
  return warmingPromise;
}
