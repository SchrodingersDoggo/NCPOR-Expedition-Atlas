# Phase 3 — Authenticated Dataset Multipart API

Phase 3 adds only the backend control-plane API for large scientific dataset uploads.
No dataset file bytes are sent through Express/Node. The browser uploader itself is a later phase.

## Routes

All routes require:
- a valid normal portal JWT (`Authorization: Bearer ...`)
- an active account
- role `researcher`, `comms_officer`, or `admin`

### 1. Initialize
`POST /api/dataset-upload/init`

Body:
```json
{
  "fileName": "antarctic-ctd.nc",
  "fileSize": 4294967296,
  "mimeType": "application/octet-stream"
}
```

The server generates the object key; the client cannot choose it. The response includes a signed `sessionToken`, the MinIO multipart `uploadId`, and the recommended `partSize`.

### 2. Get URL for one part
`POST /api/dataset-upload/part-url`

Body:
```json
{
  "sessionToken": "...",
  "partNumber": 1
}
```

The returned URL is used by the browser to `PUT` that chunk directly to MinIO.

### 3. Resume/status
`GET /api/dataset-upload/status`

Send the session token in the `x-dataset-upload-session` header. It is intentionally not accepted in the query string, so it does not leak into URLs/access logs.

The response comes from MinIO `ListParts`, so it is authoritative even when IndexedDB/local state is stale.

### 4. Complete
`POST /api/dataset-upload/complete`

Body:
```json
{ "sessionToken": "..." }
```

The backend fetches the authoritative part list from MinIO and verifies:
- parts are consecutive starting from 1
- all non-final parts are at least 5 MiB
- uploaded byte total exactly matches the original `fileSize`

Only then does it complete the multipart upload.

### 5. Abort
`DELETE /api/dataset-upload/abort`

Body:
```json
{ "sessionToken": "..." }
```

## Upload-session ownership

There is intentionally no Prisma upload-session table in Phase 3 because database persistence is Phase 4. Instead `/init` returns a signed dataset-upload session token containing the generated MinIO upload id/object key and the initiating user's id. Every later endpoint verifies the token and user id before touching MinIO.

Phase 4 can replace/persist this temporary stateless session with a database upload-session row without changing MinIO itself.

## Environment

Optional:
```env
MINIO_UPLOAD_SESSION_EXPIRES_IN=7d
```

Seven days is deliberately longer than a normal web session because multi-gigabyte scientific uploads can run for a very long time on field connections. Individual part URLs are still short-lived and can be regenerated.

## Unchanged systems

Phase 3 does not modify:
- `/api/upload`
- Multer
- Cloudinary
- Studio
- service worker
- IndexedDB/offline upload queue
- low-bandwidth mode
- Prisma schema/migrations
- existing dataset metadata workflow
