# Phase 5 — Browser Multipart Dataset Uploader

Phase 5 connects only dataset files routed as `multipart` to the MinIO control-plane API added in Phases 3–4.

## Runtime flow

1. `POST /api/dataset-upload/init`
2. Use the server-returned `partSize` and `totalParts`.
3. For each part, call `POST /api/dataset-upload/part-url`.
4. Slice the browser `File` with `file.slice(start, end)` using the exact server-issued part size.
5. `PUT` that Blob directly to the presigned MinIO URL. File bytes never pass through Express/Multer.
6. After every part succeeds, call `POST /api/dataset-upload/complete`.
7. Attach the completed upload to DatasetMetadata using the completed upload session ID. The server re-loads the completed session and persists its authoritative MinIO object key/file metadata.

Phase 5 uploads parts sequentially. Durable client-side resume/reconnect state is Phase 6.

## Compatibility

- Existing small/legacy dataset uploads still use `/api/upload` -> Multer -> Cloudinary.
- Photos, videos, reports, publications, avatars and Studio are unchanged.
- Multipart datasets are never stored as large Blobs in the existing IndexedDB offline queue.
- Service Worker and low-bandwidth image behavior are unchanged.

## Manual test

With MinIO configured and the Phase 4 migration applied:

```bash
cd server
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

In another terminal:

```bash
cd client
npm install
npm run dev
```

Then sign in as an active researcher/admin/comms officer and choose a dataset that Phase 0 routes to multipart (for example `.nc`, `.h5`, `.grib`, `.zip`, or a dataset larger than 100 MiB). On submit, the Upload page should show direct multipart progress and the browser Network panel should show `PUT` requests going directly to the MinIO endpoint rather than `/api/upload`.
