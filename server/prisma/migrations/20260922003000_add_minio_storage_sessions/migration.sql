-- Phase 4: persist MinIO storage metadata and multipart upload control-plane
-- state. Existing Cloudinary content keeps its current URL and is backfilled
-- through defaults; this migration does not move or rewrite any existing file.

CREATE TYPE "StorageProvider" AS ENUM ('cloudinary', 'minio');
CREATE TYPE "StorageUploadStatus" AS ENUM ('initiated', 'uploading', 'completed', 'aborted', 'failed');

-- MinIO objects are private and use object_key + short-lived download URLs,
-- therefore file_url must be nullable for future MinIO ContentItem records.
ALTER TABLE "content_items"
  ALTER COLUMN "file_url" DROP NOT NULL,
  ADD COLUMN "storage_provider" "StorageProvider" NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN "object_key" TEXT,
  ADD COLUMN "original_file_name" TEXT,
  ADD COLUMN "checksum_sha256" TEXT,
  ADD COLUMN "upload_status" "StorageUploadStatus" NOT NULL DEFAULT 'completed';

CREATE UNIQUE INDEX "content_items_object_key_key" ON "content_items"("object_key");

CREATE TABLE "dataset_upload_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_size" BIGINT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "part_size" BIGINT NOT NULL,
  "status" "StorageUploadStatus" NOT NULL DEFAULT 'initiated',
  "etag" TEXT,
  "checksum_sha256" TEXT,
  "version_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "aborted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dataset_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_upload_sessions_upload_id_key" ON "dataset_upload_sessions"("upload_id");
CREATE UNIQUE INDEX "dataset_upload_sessions_object_key_key" ON "dataset_upload_sessions"("object_key");
CREATE INDEX "dataset_upload_sessions_user_id_status_idx" ON "dataset_upload_sessions"("user_id", "status");
CREATE INDEX "dataset_upload_sessions_created_at_idx" ON "dataset_upload_sessions"("created_at");

ALTER TABLE "dataset_upload_sessions"
  ADD CONSTRAINT "dataset_upload_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
