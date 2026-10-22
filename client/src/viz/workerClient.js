// Starts the parser worker only to load reader code for later offline use.
// Resolves with the list of warmed extensions; never rejects.
export function warmVisualizationWorker(extensions = [], { hdf5 = false, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./worker/viz.worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve([]);
      return;
    }
    const id = `warm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const done = (loaded) => {
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* already gone */ }
      resolve(loaded);
    };
    const timer = setTimeout(() => done([]), timeoutMs);
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'warmed' && String(message.id) === id) done(message.loaded || []);
    };
    worker.onerror = () => done([]);
    worker.postMessage({ type: 'warm', id, extensions, hdf5 });
  });
}

export function parseDatasetInWorker(source, options = {}, { onProgress = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker/viz.worker.js', import.meta.url), { type: 'module' });
    const id = `viz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      try { worker.postMessage({ type: 'cancel', id }); } catch { /* worker may already be gone */ }
      const error = new DOMException('Visualization parsing cancelled.', 'AbortError');
      finish(reject, error);
    };

    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (String(message.id) !== id) return;
      if (message.type === 'progress') onProgress?.(message.progress || {});
      else if (message.type === 'complete') finish(resolve, message.dataset);
      else if (message.type === 'cancelled') abort();
      else if (message.type === 'error') {
        const error = new Error(message.error || 'Dataset parsing failed.');
        error.code = message.code || null;
        finish(reject, error);
      }
    };
    worker.onerror = (event) => finish(reject, new Error(event.message || 'Visualization worker failed.'));
    worker.postMessage({ type: 'start', id, source, options });
  });
}
