# Phase 7 — SHA-256 multipart integrity

Phase 7 adds per-part SHA-256 validation to new scientific-dataset multipart uploads.

## What changed

- New multipart sessions are initiated in MinIO with checksum algorithm `SHA256`.
- Each missing part is hashed in `client/src/workers/datasetChecksum.worker.js`.
- The worker receives only the current part Blob (normally 5 MiB), never the full dataset.
- The browser sends the Base64 SHA-256 digest to the authenticated `/part-url` endpoint.
- The checksum is bound to the presigned `UploadPart` request and sent to MinIO as `x-amz-checksum-sha256`.
- MinIO validates the uploaded bytes against that checksum.
- Before completion, the backend requires every part in a checksum-enabled session to have a SHA-256 value reported by `ListParts`.
- The final checksum returned by MinIO is persisted in the existing `checksumSha256` fields.

## Backward compatibility

`DatasetUploadSession.checksumAlgorithm` is nullable. Existing Phase 6 sessions therefore remain `NULL` and continue without the new checksum requirement. New Phase 7 sessions are stored as `SHA256`.

Apply the migration before testing:

```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

No Cloudinary, Multer, `/api/upload`, Service Worker, offline queue, Studio, archive, low-bandwidth, authentication, or restricted-data path is replaced by this phase.
