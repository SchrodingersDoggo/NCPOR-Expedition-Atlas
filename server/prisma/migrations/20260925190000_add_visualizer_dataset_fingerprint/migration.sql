-- Visualizer V0: keep a true whole-file SHA-256 separate from the existing
-- MinIO/S3 multipart checksum. Both columns are nullable so every historical
-- dataset and in-progress multipart upload remains valid without backfilling.
ALTER TABLE "dataset_upload_sessions"
ADD COLUMN "whole_file_sha256" TEXT;

ALTER TABLE "content_items"
ADD COLUMN "whole_file_sha256" TEXT;
