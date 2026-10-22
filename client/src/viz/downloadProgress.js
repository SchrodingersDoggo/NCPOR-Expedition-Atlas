// Read a dataset response while reporting download progress, so slow links
// show "12.4 of 42.8 MiB" instead of an unexplained wait. Falls back to
// response.blob() when streaming is unavailable.
export async function readBlobWithProgress(response, { expectedSize = 0, onProgress = null, signal = null } = {}) {
  const headerSize = Number(response?.headers?.get?.('Content-Length') || 0);
  const total = headerSize > 0 ? headerSize : Number(expectedSize) || 0;
  const reader = response?.body?.getReader?.();
  if (!reader) return response.blob();

  const chunks = [];
  let loaded = 0;
  let lastReport = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    onProgress?.({ stage: 'download', loaded, total, percent: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : null });
  };
  report(true);
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Dataset download cancelled.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      report();
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* already closed */ }
    throw error;
  }
  report(true);
  return new Blob(chunks, { type: response.headers?.get?.('Content-Type') || '' });
}
