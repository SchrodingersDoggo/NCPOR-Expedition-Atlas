import { Sha256 } from '../utils/incrementalSha256.js';

function digestToBase64(digest) {
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hashPart(blob) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return digestToBase64(digest);
}

async function hashWholeFile(file, chunkSize = 8 * 1024 * 1024) {
  const sha = new Sha256();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const buffer = await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer();
    sha.update(new Uint8Array(buffer));
  }
  return sha.hex();
}

// Phase 7 + Visualizer V0: part checksums remain Base64 SHA-256 for MinIO
// integrity headers. Whole-file fingerprints are a separate incremental hex
// SHA-256 and never load the complete File into memory.
self.onmessage = async (event) => {
  const { id, blob, mode = 'part' } = event.data || {};

  try {
    if (!id || !blob || typeof blob.arrayBuffer !== 'function') {
      throw new Error('A dataset Blob/File is required for SHA-256 hashing.');
    }

    if (mode === 'whole-file') {
      const wholeFileSha256 = await hashWholeFile(blob);
      self.postMessage({ id, wholeFileSha256 });
      return;
    }

    const checksumSHA256 = await hashPart(blob);
    self.postMessage({ id, checksumSHA256 });
  } catch (error) {
    self.postMessage({
      id,
      error: error?.message || 'Unable to calculate dataset checksum.',
    });
  }
};
