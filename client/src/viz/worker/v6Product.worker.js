import { buildIsosurfaceMesh, buildV6ProductFromPrepared } from '../v6Products.js';

const jobs = new Map();

function transferables(product) {
  const out = [];
  if (ArrayBuffer.isView(product?.positions)) out.push(product.positions.buffer);
  return out;
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  const id = String(message.id || 'default');
  if (message.type === 'cancel') {
    const job = jobs.get(id);
    if (job) job.cancelled = true;
    return;
  }
  if (!['build-product', 'build-isosurface'].includes(message.type)) return;
  const job = { cancelled: false };
  jobs.set(id, job);
  try {
    const isCancelled = () => job.cancelled;
    const product = message.type === 'build-isosurface'
      ? buildIsosurfaceMesh(message.volumeProduct, message.isoValue, { isCancelled })
      : buildV6ProductFromPrepared(message.preparedInput, { isCancelled });
    if (job.cancelled) self.postMessage({ type: 'cancelled', id });
    else self.postMessage({ type: 'complete', id, product }, transferables(product));
  } catch (error) {
    if (job.cancelled || error?.name === 'AbortError') self.postMessage({ type: 'cancelled', id });
    else self.postMessage({ type: 'error', id, error: error?.message || '3D product generation failed.' });
  } finally {
    jobs.delete(id);
  }
});
