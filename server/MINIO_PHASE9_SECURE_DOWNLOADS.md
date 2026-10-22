# Phase 9 — Secure dataset downloads

Phase 9 keeps MinIO scientific objects private and resolves a download only after the existing dataset access rules pass.

## Download endpoint

`GET /api/content/:id/download`

The route uses optional authentication so `open` datasets remain downloadable by guests, while `registered`, `request_required`, and `restricted` datasets continue to follow the portal's existing access policy. Staff and the uploader retain their existing access.

For a new MinIO-backed dataset, the backend returns a short-lived presigned GET URL. The default expiry remains the Phase 2 MinIO service default (15 minutes unless `MINIO_DOWNLOAD_URL_EXPIRY_SECONDS` changes it).

For an existing historical Cloudinary-backed dataset, the same access check runs first and the existing Cloudinary URL is returned. Historical records are not migrated.

## Storage locators are not listing data

Dataset list/archive/detail responses no longer expose a MinIO `objectKey` or a historical dataset `fileUrl`. Dataset-metadata responses also redact those locators from linked content objects. Descriptive/scientific metadata remains available under the same visibility rules as before.

The browser requests a download only when the user clicks the dataset download control. Photos, videos, reports, publications, avatars and Studio media continue to use their existing Cloudinary URLs and routes unchanged.

## Unchanged systems

- MinIO multipart upload, resume and checksum flows
- Phase 4.1 `NoSuchUpload -> HeadObject` recovery
- Cloudinary/Multer `/api/upload`
- Service Worker and IndexedDB offline queues
- low-bandwidth mode
- Studio
- archive visibility/review workflow
- authentication roles and dataset access-request workflow
