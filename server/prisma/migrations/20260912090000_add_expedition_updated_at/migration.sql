-- Phase 7: optimistic concurrency needs a server-side "last changed" marker
-- on expeditions. Backfilled from created_at so existing rows are valid.
ALTER TABLE "expeditions"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "expeditions" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
