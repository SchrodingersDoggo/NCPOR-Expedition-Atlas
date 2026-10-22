-- Phase 3 (Location Danger Status): every expedition/location gets a
-- coarse danger level. New alerts escalate it one step at a time (handled
-- in application code, alongside the alert insert); resolving it back down
-- is Phase 5's job.

CREATE TYPE "DangerLevel" AS ENUM ('low', 'moderate', 'high', 'critical');

ALTER TABLE "expeditions" ADD COLUMN "danger_level" "DangerLevel" NOT NULL DEFAULT 'low';
