-- Phase 7: remember whether a multipart upload was initiated with an
-- additional checksum algorithm. Existing in-progress sessions stay NULL so
-- they remain resumable with their original pre-checksum behavior.
ALTER TABLE "dataset_upload_sessions"
ADD COLUMN "checksum_algorithm" TEXT;
