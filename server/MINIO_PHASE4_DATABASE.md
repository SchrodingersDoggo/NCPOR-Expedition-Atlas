# Phase 4 — Durable MinIO upload state

Phase 4 persists the multipart control plane in PostgreSQL. It does **not** connect the frontend uploader yet and it does not move any existing Cloudinary asset.

## Schema changes

`ContentItem` now has additive storage metadata:

- `storageProvider` (`cloudinary` by default, or `minio`)
- `objectKey` (nullable, unique)
- `originalFileName` (nullable)
- `checksumSha256` (nullable)
- `uploadStatus` (`completed` by default for existing content)
- `fileUrl` is nullable so a private MinIO object never needs a permanent/presigned URL stored in the database

Existing `fileSizeBytes` and `mimeType` fields are reused instead of duplicating them.

A new `DatasetUploadSession` table stores only multipart control-plane state:

- owner (`userId`)
- MinIO `uploadId` and generated `objectKey`
- original file name, file size, MIME type and exact part size
- lifecycle status
- final ETag/checksum/version id
- completion/abort/audit timestamps

No dataset bytes or large Blobs are stored in PostgreSQL.

## API behavior

The signed upload-session token now contains only `sessionId` + `userId`. Every part URL/status/complete/abort request loads the authoritative multipart geometry and MinIO identifiers from PostgreSQL.

Completion still performs the tightened Phase 3 validation: every non-final part must be exactly `session.partSize`, and the final part must be exactly the remaining bytes.

## Apply safely

From `server/`:

```bash
npm install
npx prisma migrate deploy
npx prisma generate
```

`migrate deploy` is recommended here because it applies the checked-in migration without asking Prisma to reset a development database due to drift.

Then start the backend normally:

```bash
npm run dev
```

## Unchanged systems

Phase 4 does not modify `/api/upload`, Multer, Cloudinary, Studio, the client, Service Worker, IndexedDB/offline sync, low-bandwidth behavior, archive behavior, dataset-access rules, or the dataset metadata workflow.
