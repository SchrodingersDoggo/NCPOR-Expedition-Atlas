-- Phase 5 (Danger recovery): who resolved an alert and when. Resolving is
-- always a manual action by an admin/comms_officer — there is no automatic
-- time-based decay, so there is nothing else to add here.

ALTER TABLE "alerts" ADD COLUMN "resolved_by" TEXT;
ALTER TABLE "alerts" ADD COLUMN "resolved_at" TIMESTAMP(3);

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_fkey"
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
