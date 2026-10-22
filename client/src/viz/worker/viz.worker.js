import { preloadReaders, readDataset } from '../registry.js';

const jobs = new Map();

function jobIdFrom(message) {
  return String(message?.id ?? message?.jobId ?? 'default');
}

function transferableBuffers(dataset) {
  const buffers = [];
  const seen = new Set();
  for (const field of dataset?.fields || []) {
    const buffer = ArrayBuffer.isView(field?.values) ? field.values.buffer : null;
    if (buffer && !seen.has(buffer)) {
      seen.add(buffer);
      buffers.push(buffer);
    }
  }
  return buffers;
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  const id = jobIdFrom(message);

  if (message.type === 'warm') {
    try {
      const loaded = await preloadReaders(message.extensions || [], { hdf5: Boolean(message.hdf5) });
      self.postMessage({ type: 'warmed', id, loaded });
    } catch (error) {
      self.postMessage({ type: 'warmed', id, loaded: [], error: error?.message || 'Warm-up failed.' });
    }
    return;
  }

  if (message.type === 'cancel') {
    const job = jobs.get(id);
    if (job) job.cancelled = true;
    return;
  }
  if (message.type !== 'start') return;
  if (jobs.has(id)) {
    self.postMessage({ type: 'error', id, error: 'A visualization parse job with this id is already running.' });
    return;
  }

  const job = { cancelled: false };
  jobs.set(id, job);
  try {
    const dataset = await readDataset(message.source, {
      ...(message.options || {}),
      fileName: message.options?.fileName || message.source?.name || '',
      isCancelled: () => job.cancelled,
      onProgress: (progress) => {
        if (!job.cancelled) self.postMessage({ type: 'progress', id, progress });
      },
    });

    if (job.cancelled) {
      self.postMessage({ type: 'cancelled', id });
      return;
    }
    self.postMessage({ type: 'complete', id, dataset }, transferableBuffers(dataset));
  } catch (error) {
    if (job.cancelled || error?.name === 'AbortError') {
      self.postMessage({ type: 'cancelled', id });
    } else {
      self.postMessage({
        type: 'error',
        id,
        error: error?.message || 'Dataset parsing failed.',
        code: error?.code || null,
      });
    }
  } finally {
    jobs.delete(id);
  }
});
