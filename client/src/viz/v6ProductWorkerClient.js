function runWorker(message, { signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker/v6Product.worker.js', import.meta.url), { type: 'module' });
    const id = `v6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      finish(reject, new DOMException('V6 product generation cancelled.', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      const response = event.data || {};
      if (String(response.id) !== id) return;
      if (response.type === 'complete') finish(resolve, response.product);
      else if (response.type === 'cancelled') abort();
      else if (response.type === 'error') finish(reject, new Error(response.error || '3D product worker failed.'));
    };
    worker.onerror = (event) => finish(reject, new Error(event.message || '3D product worker failed.'));
    worker.postMessage({ ...message, id });
  });
}

export function buildV6ProductInWorker(preparedInput, options = {}) {
  return runWorker({ type: 'build-product', preparedInput }, options);
}

export function buildV6IsosurfaceInWorker(volumeProduct, isoValue, options = {}) {
  return runWorker({ type: 'build-isosurface', volumeProduct, isoValue }, options);
}
