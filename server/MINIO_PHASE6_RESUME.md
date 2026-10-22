# MinIO Phase 6 — Resume & Recovery

Phase 6 is client-side only. It does not change the MinIO/Express API, Cloudinary,
Multer, Service Worker, the existing offline queue, Studio, or low-bandwidth mode.

## Durable state

IndexedDB database `ncpor-offline` is upgraded from version 4 to 5 and gains the
`datasetMultipartUploads` object store. Records contain only multipart control
metadata (session token/id, file identity, part geometry, committed part numbers,
progress, and object metadata). The dataset File/Blob is never stored there.

## Resume behavior

- While the page remains open, a network failure moves the upload to
  `waiting-network`; reconnect automatically calls `/api/dataset-upload/status`,
  trusts MinIO's ListParts result, and uploads only missing parts.
- Pause aborts only the current part PUT. Already committed parts remain in MinIO.
  Resume obtains a new presigned URL and retries the missing current part.
- After a browser/page restart, the upload session remains in IndexedDB but the
  local File does not. The Upload page shows an interrupted-upload notice. The
  researcher must reselect the same file. Resume is allowed only when name, exact
  size, and `lastModified` all match the persisted file identity.
- A completed MinIO session is kept locally until the DatasetMetadata/DatasetFile
  attachment succeeds. This avoids re-uploading a multi-GB object if that final
  metadata request fails.

## Manual checks

1. Start a multipart dataset upload and wait for at least two parts to finish.
2. Click **Pause**. Confirm progress stops and no large Blob appears in the existing
   `pendingContent` IndexedDB store.
3. Click **Resume**. Confirm upload continues from the current missing part.
4. During another upload, disable the network. Confirm the UI shows
   `waiting-network`. Re-enable it and confirm `/dataset-upload/status` is called
   and previously completed parts are skipped.
5. Refresh the page mid-upload. Confirm the interrupted-upload banner appears.
   Reselect a different file with a different size/lastModified: it must not reuse
   the session. Reselect the original file: Submit should continue missing parts.
